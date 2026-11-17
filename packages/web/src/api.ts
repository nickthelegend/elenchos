// The studio talks to the Elenchos server on the same origin by default; VITE_ELENCHOS_API points it elsewhere.
const API_BASE = ((import.meta as any).env?.VITE_ELENCHOS_API ?? '').replace(/\/$/, '');
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
  try { r = await fetch(`${API_BASE}/api/targets`); } catch { throw new Error(UNREACHABLE); }
  if (r.status === 404) throw new Error('No Elenchos server is running behind this address yet.');
  if (!r.ok) throw new Error(`The server answered ${r.status} for the target list.`);
  return r.json();
}

export type Finding = { rule: string; severity: 'critical' | 'high' | 'medium'; title: string; contract: string; function: string; file: string; line: number; evidence: string; fix: string };

/** Deterministic audit of any contract source: Slither + the five Elenchos detectors, no model. */
export async function scanSource(name: string, source: string): Promise<{ findings: Finding[]; ms: number }> {
  let r: Response;
  try { r = await fetch(`${API_BASE}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, source }) }); }
  catch { throw new Error(UNREACHABLE); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `The server answered ${r.status}.`);
  return body;
}

/** What the agent investigates: a repo target by id, or any pasted source by file name. */
export type Subject = { targetId: string } | { name: string; source: string };

/** Streams an investigation. Returns an abort function. */
export function investigate(subject: Subject | string, prompt: string, history: Turn[], onEvent: (e: AgentEvent) => void, onClose: () => void): () => void {
  const subj: Subject = typeof subject === 'string' ? { targetId: subject } : subject;
  const ac = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${API_BASE}/api/investigate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...subj, prompt, history }), signal: ac.signal,
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
