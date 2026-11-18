// The Elenchos agent loop. Claude drives the investigation with real tools; every tool call and its result is
// emitted as an event so the UI can show the work. Streaming manual loop (we need per-event transport and to run
// our own tools), following the SDK's documented shape.
import Anthropic from '@anthropic-ai/sdk';
import { scanTool, forgeTool, replayTool, patchTool, shutdownProver, type ToolEvent } from './tools.ts';
import { reviewPatch } from './review.ts';
import { attackCopy } from './exploit.ts';
import { forgeryFor } from './tools.ts';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; event: ToolEvent }
  | { type: 'review'; status: string; text: string }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };

const MODEL = process.env.ELENCHOS_MODEL ?? 'claude-sonnet-5-5';
const SYSTEM = `You are Elenchos, a red team for smart contracts that trust zkVerify aggregation receipts.
You investigate one target contract through tools and explain what you find in plain language a developer trusts.

Context: this is a defensive audit run by the contract's own developer in the Elenchos studio. The forge tool builds a
proof locally with a demo attacker circuit and never submits anything; the replay tool only reads zkVerify's public
verifier on the Sepolia testnet. No transaction is sent and no real contract or funds are touched. Demonstrating the
impact this way is how the developer learns the hole is real before shipping the fix.

The five holes you look for, and the fix for each:
- E1 the verification key comes from the caller -> pin it as an immutable set in the constructor.
- E1b the caller passes the aggregation leaf itself -> rebuild the leaf on-chain from the pinned vk and the inputs.
- E3 a receipt is checked but never recorded -> record the statement hash and reject the second use.
- E4 a function moves balances or supply without checking any receipt -> gate it on a receipt in the same call.
- E6 the zkVerify domain id comes from the caller -> pin it as an immutable.

Work in this order and narrate briefly as you go: scan the target; if there is a critical finding, forge a proof to
show what the hole lets an attacker mint, then replay that forged leaf against the real zkVerify verifier on Sepolia to
show zkVerify itself is not fooled (the bug is the consumer trusting the caller's key); then run the attack tool on
the original file, which runs a real Foundry exploit test and shows the attacker's balance (the stock test runs on a Sepolia fork against zkVerify's real verifier, with an attacker receipt zkVerify really aggregated); then propose a patched version of the file and call the patch tool, which compiles it and re-scans. The patch tool also rejects a fix that only cheats the scanner (deleting
or renaming the vulnerable function, or ripping the receipt check out) — if it reports the patch cheated, fix it
properly, do not claim success. After a verified patch, run the attack tool again with against="patched" to show the
same attack now reverts. If the attack tool has no stock test for the contract's shape, write one yourself (testSource,
following the convention in the tool description). Only claim a fix works after the patch tool verifies it. Never invent a result a
tool did not return. Be concise.`;

type Ctx = { targetPath: string; originalSource: string; forgedLeaf?: `0x${string}`; patched?: string };

const toolDefs: Anthropic.Tool[] = [
  { name: 'scan', description: 'Run the Elenchos static scanner on the target contract. Returns E1/E1b/E3/E4/E6 findings.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'forge', description: 'Prove, locally and for real, a Groth16 forgery that mints an amount to a recipient using an attacker circuit — shows what an E1 hole lets through.', input_schema: { type: 'object', properties: { recipient: { type: 'string', description: 'hex address or decimal' }, amount: { type: 'string', description: 'token amount to forge, e.g. 1000000' } }, required: ['amount'], additionalProperties: false } },
  { name: 'replay', description: 'Ask the real zkVerify verifier on Ethereum Sepolia whether the leaf from the last forge call is in its latest real aggregation. Takes no input: it always replays exactly the leaf forge produced. Call forge first.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'attack', description: 'Run the attack: a real Foundry exploit test against the target. Without testSource it uses Elenchos\'s stock test for known claim shapes, on a Sepolia fork against zkVerify\'s real verifier with an attacker receipt zkVerify really aggregated. A custom testSource runs on a local EVM, where zkVerify is a stand-in that vouches only for leaves really aggregated. To write your own, give a full Solidity file that imports {Test, console} from "forge-std/Test.sol", {ElenchosForgery as F, ElenchosStatement, ZkVerifyStandIn} from "./ElenchosHarness.sol" (F.VK_HASH, F.LEAF, F.inputs(), F.attacker(), F.AMOUNT, F.NULLIFIER; ZkVerifyStandIn has aggregate(bytes32 leaf) and verifyProofAggregation), and the target contract from "TARGET"; defines contract ElenchosExploit is Test; and has test_attack_* functions that each ASSERT the attacker got value. Passing = the attack works; failing = the code stopped it. Cheatcodes that reach outside the EVM (env, files, ffi, forks) are refused.', input_schema: { type: 'object', properties: { against: { type: 'string', enum: ['original', 'patched'], description: 'original file (default) or your last patch' }, testSource: { type: 'string', description: 'optional custom exploit test' } }, additionalProperties: false } },
  { name: 'patch', description: 'Verify a proposed fix: supply the FULL new source for the target file. It is compiled on a throwaway copy and re-scanned; it is verified only if it compiles and the scanner is clean.', input_schema: { type: 'object', properties: { newSource: { type: 'string', description: 'the complete patched Solidity source for the target file' } }, required: ['newSource'], additionalProperties: false } },
];

async function runTool(name: string, input: any, ctx: Ctx, emit: (e: AgentEvent) => void): Promise<string> {
  if (name === 'scan') { const { findings, event } = await scanTool(ctx.targetPath); emit({ type: 'tool', event }); return JSON.stringify(findings); }
  if (name === 'forge') { const r = await forgeTool(BigInt(input.recipient ?? '0xA11cE'), BigInt(input.amount)); if (r.leaf) ctx.forgedLeaf = r.leaf; emit({ type: 'tool', event: r.event }); return JSON.stringify({ summary: r.event.summary, ...(r.event.detail as object) }); }
  if (name === 'replay') {
    if (!ctx.forgedLeaf) return 'No forged leaf yet: call forge first (replay only checks a leaf that forge really produced).';
    const r = await replayTool(ctx.forgedLeaf); emit({ type: 'tool', event: r.event }); return r.event.summary;
  }
  if (name === 'attack') {
    const src = input.against === 'patched' ? ctx.patched : ctx.originalSource;
    if (!src) return 'No patch yet: call patch first, then attack with against="patched".';
    const r = await attackCopy(ctx.targetPath, src, await forgeryFor(), input.testSource ?? null);
    emit({ type: 'tool', event: { tool: 'attack', status: r.status === 'error' ? 'error' : 'ok', summary: r.summary, detail: { ...r, against: input.against ?? 'original' } } });
    return JSON.stringify({ status: r.status, summary: r.summary, tests: r.tests, compileError: r.compileError });
  }
  if (name === 'patch') {
    ctx.patched = input.newSource;
    const r = await patchTool(ctx.targetPath, input.newSource); emit({ type: 'tool', event: r.event });
    const review = await reviewPatch(ctx.originalSource, input.newSource, r.result); emit({ type: 'review', status: review.status, text: review.text });
    return JSON.stringify({ verified: r.result.verified, reason: r.result.reason, secondOpinion: review.text });
  }
  return `unknown tool ${name}`;
}

/** Runs one investigation turn for the given target and user prompt, emitting events as it goes. */
export async function investigate(opts: { targetPath: string; originalSource: string; prompt: string; history?: { role: 'user' | 'assistant'; text: string }[]; signal?: AbortSignal }, emit: (e: AgentEvent) => void): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) { emit({ type: 'error', message: 'Setup required: ANTHROPIC_API_KEY for the Elenchos agent' }); return; }
  const client = new Anthropic();
  const ctx: Ctx = { targetPath: opts.targetPath, originalSource: opts.originalSource };
  // Earlier turns of this case, oldest first. The first turn must be the user's, and roles must alternate.
  const past = (opts.history ?? []).filter((t) => t.text.trim());
  while (past.length && past[0].role !== 'user') past.shift();
  const turns: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const t of past) { const last = turns[turns.length - 1]; if (last?.role === t.role) last.text += `\n${t.text}`; else turns.push({ ...t }); }
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop(); // an unanswered question (e.g. stopped) is dropped
  const header = `Target file: ${opts.targetPath}\n\n\`\`\`solidity\n${opts.originalSource}\n\`\`\``;
  const messages: Anthropic.MessageParam[] = turns.length
    ? [{ role: 'user', content: `${header}\n\n${turns[0].text}` }, ...turns.slice(1).map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: opts.prompt }]
    : [{ role: 'user', content: `${header}\n\n${opts.prompt}` }];
  try {
    for (let step = 0; step < 12; step++) {
      const stream = client.messages.stream({ model: MODEL, max_tokens: 8000, system: SYSTEM, tools: toolDefs, messages }, { signal: opts.signal });
      stream.on('text', (t) => emit({ type: 'text', text: t }));
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') { emit({ type: 'error', message: 'The model declined to continue this step (stop reason: refusal). Nothing was faked: the toolbar buttons run Forge exploit, Ask zkVerify and Verify fix directly, without the model.' }); emit({ type: 'done', stopReason: 'refusal' }); return; }
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
