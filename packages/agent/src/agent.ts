// The Elenchos agent loop. Claude drives the investigation with real tools; every tool call and its result is
// emitted as an event so the UI can show the work. Streaming manual loop (we need per-event transport and to run
// our own tools), following the SDK's documented shape.
import Anthropic from '@anthropic-ai/sdk';
import { scanTool, forgeTool, replayTool, patchTool, shutdownProver, type ToolEvent } from './tools.ts';
import { reviewPatch } from './review.ts';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; event: ToolEvent }
  | { type: 'review'; status: string; text: string }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };

const MODEL = process.env.ELENCHOS_MODEL ?? 'claude-sonnet-5-5';
const SYSTEM = `You are Elenchos, a red team for smart contracts that trust zkVerify aggregation receipts.
You investigate one target contract through tools and explain what you find in plain language a developer trusts.

The four holes you look for, and the fix for each:
- E1 the verification key comes from the caller -> pin it as an immutable set in the constructor.
- E1b the caller passes the aggregation leaf itself -> rebuild the leaf on-chain from the pinned vk and the inputs.
- E3 a receipt is checked but never recorded -> record the statement hash and reject the second use.
- E4 a function moves balances or supply without checking any receipt -> gate it on a receipt in the same call.
- E6 the zkVerify domain id comes from the caller -> pin it as an immutable.

Work in this order and narrate briefly as you go: scan the target; if there is a critical finding, forge a proof to
show what the hole lets an attacker mint, and read the real zkVerify verifier to show the forged leaf is rejected on
its own; then propose a patched version of the file and call the patch tool, which compiles it and re-scans. Only
claim a fix works after the patch tool verifies it. Never invent a result a tool did not return. Be concise.`;

type Ctx = { targetPath: string; originalSource: string };

const toolDefs: Anthropic.Tool[] = [
  { name: 'scan', description: 'Run the Elenchos static scanner on the target contract. Returns E1/E1b/E3/E4/E6 findings.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'forge', description: 'Prove, locally and for real, a Groth16 forgery that mints an amount to a recipient using an attacker circuit — shows what an E1 hole lets through.', input_schema: { type: 'object', properties: { recipient: { type: 'string', description: 'hex address or decimal' }, amount: { type: 'string', description: 'token amount to forge, e.g. 1000000' } }, required: ['amount'], additionalProperties: false } },
  { name: 'replay', description: 'Read the real zkVerify verifier (on a Sepolia fork) to show that a forged / un-aggregated leaf is rejected on its own.', input_schema: { type: 'object', properties: { leaf: { type: 'string', description: 'a bytes32 leaf, 0x-prefixed' } }, required: ['leaf'], additionalProperties: false } },
  { name: 'patch', description: 'Verify a proposed fix: supply the FULL new source for the target file. It is compiled on a throwaway copy and re-scanned; it is verified only if it compiles and the scanner is clean.', input_schema: { type: 'object', properties: { newSource: { type: 'string', description: 'the complete patched Solidity source for the target file' } }, required: ['newSource'], additionalProperties: false } },
];

async function runTool(name: string, input: any, ctx: Ctx, emit: (e: AgentEvent) => void): Promise<string> {
  if (name === 'scan') { const { findings, event } = await scanTool(ctx.targetPath); emit({ type: 'tool', event }); return JSON.stringify(findings); }
  if (name === 'forge') { const r = await forgeTool(BigInt(input.recipient ?? '0xA11cE'), BigInt(input.amount)); emit({ type: 'tool', event: r.event }); return JSON.stringify(r.event.detail); }
  if (name === 'replay') { const r = await replayTool(input.leaf); emit({ type: 'tool', event: r.event }); return r.event.summary; }
  if (name === 'patch') {
    const r = await patchTool(ctx.targetPath, input.newSource); emit({ type: 'tool', event: r.event });
    const review = await reviewPatch(ctx.originalSource, input.newSource, r.result); emit({ type: 'review', status: review.status, text: review.text });
    return JSON.stringify({ verified: r.result.verified, reason: r.result.reason, secondOpinion: review.text });
  }
  return `unknown tool ${name}`;
}

/** Runs one investigation turn for the given target and user prompt, emitting events as it goes. */
export async function investigate(opts: { targetPath: string; originalSource: string; prompt: string; signal?: AbortSignal }, emit: (e: AgentEvent) => void): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) { emit({ type: 'error', message: 'Setup required: ANTHROPIC_API_KEY for the Elenchos agent' }); return; }
  const client = new Anthropic();
  const ctx: Ctx = { targetPath: opts.targetPath, originalSource: opts.originalSource };
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Target file: ${opts.targetPath}\n\n${opts.prompt}` }];
  try {
    for (let step = 0; step < 12; step++) {
      const stream = client.messages.stream({ model: MODEL, max_tokens: 8000, system: SYSTEM, tools: toolDefs, messages }, { signal: opts.signal });
      stream.on('text', (t) => emit({ type: 'text', text: t }));
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') { emit({ type: 'done', stopReason: 'refusal' }); return; }
      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) { emit({ type: 'done', stopReason: msg.stop_reason }); return; }
      messages.push({ role: 'assistant', content: msg.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try { results.push({ type: 'tool_result', tool_use_id: tu.id, content: await runTool(tu.name, tu.input, ctx, emit) }); }
        catch (e) { results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: String(e).slice(0, 300) }); }
      }
      messages.push({ role: 'user', content: results });
    }
    emit({ type: 'done', stopReason: 'max_steps' });
  } catch (e) {
    emit({ type: 'error', message: String(e).slice(0, 300) });
  } finally {
    await shutdownProver().catch(() => {});
  }
}
