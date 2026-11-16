export type Turn = { role: 'user' | 'assistant'; text: string };
export type Ready = { anthropic: boolean; openai: boolean; rpc: boolean; kurier: boolean };
export type Target = { id: string; title: string; language: string; blurb: string; source: string };
export type ToolEvent = { tool: 'scan' | 'forge' | 'replay' | 'patch'; status: 'running' | 'ok' | 'setup' | 'error'; summary: string; detail?: any };
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; event: ToolEvent }
  | { type: 'review'; status: string; text: string }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };

const UNREACHABLE = "Can't reach the Elenchos server. Start it with `node --experimental-strip-types packages/agent/src/server.ts` (or the Docker image) and try again.";

export async function getTargets(): Promise<{ targets: Target[]; ready: Ready }> {
  let r: Response;
  try { r = await fetch('/api/targets'); } catch { throw new Error(UNREACHABLE); }
  if (!r.ok) throw new Error(`The server answered ${r.status} for the target list.`);
  return r.json();
}

/** Streams an investigation. Returns an abort function. */
export function investigate(targetId: string, prompt: string, history: Turn[], onEvent: (e: AgentEvent) => void, onClose: () => void): () => void {
  const ac = new AbortController();
  (async () => {
    try {
      const r = await fetch('/api/investigate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId, prompt, history }), signal: ac.signal,
      });
      if (!r.ok || !r.body) { let msg = `server ${r.status}`; try { msg = (await r.json()).error ?? msg; } catch {} onEvent({ type: 'error', message: msg }); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data: '));
          if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch {} }
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) onEvent({ type: 'error', message: e instanceof TypeError ? UNREACHABLE : String(e) });
    } finally { onClose(); }
  })();
  return () => ac.abort();
}
