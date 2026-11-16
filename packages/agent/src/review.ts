// Second opinion on a verified patch from an independent model (OpenAI). The verdict that counts stays
// deterministic — verifyPatch already compiled and re-scanned. This only adds a human-readable review, and is
// skipped with a clear "Setup required" when OPENAI_API_KEY is absent. No fake review is ever produced.
import OpenAI from 'openai';
import type { PatchResult } from '@elenchos/core/src/patch.ts';

export async function reviewPatch(originalSource: string, patchedSource: string, result: PatchResult): Promise<{ status: 'ok' | 'setup' | 'error'; text: string }> {
  if (!process.env.OPENAI_API_KEY) return { status: 'setup', text: 'Setup required: OPENAI_API_KEY for an independent second opinion. The deterministic check (compile + re-scan) already ran and said: ' + result.reason };
  const client = new OpenAI();
  const model = process.env.ELENCHOS_OPENAI_MODEL ?? 'gpt-5';
  try {
    const r = await client.chat.completions.create({
      model, max_completion_tokens: 600,
      messages: [
        { role: 'system', content: 'You are a Solidity security reviewer. Elenchos has already compiled the patch and re-run its static scanner. Say in 3-5 sentences whether the patch genuinely closes the zkVerify receipt-consumer holes (pinned vk, pinned domain, replay guard, gated action) or introduces a new problem. Be specific and do not restate the diff.' },
        { role: 'user', content: `Scanner verdict: ${result.reason}\nCleared: ${result.cleared.join(', ') || 'none'}\nRemaining: ${result.remaining.map((f) => f.rule).join(', ') || 'none'}\n\n--- before ---\n${originalSource.slice(0, 4000)}\n\n--- after ---\n${patchedSource.slice(0, 4000)}` },
      ],
    });
    return { status: 'ok', text: r.choices[0]?.message?.content?.trim() || '(no review returned)' };
  } catch (e) {
    return { status: 'error', text: `second-opinion model error: ${String(e).slice(0, 200)}` };
  }
}
