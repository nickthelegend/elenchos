// The studio talks to the Elenchos server on the same origin by default; VITE_ELENCHOS_API points it elsewhere.
export const API_BASE = ((import.meta as any).env?.VITE_ELENCHOS_API ?? '').replace(/\/$/, '');
export type Turn = { role: 'user' | 'assistant'; text: string };
export type Ready = { anthropic: boolean; openai: boolean; rpc: boolean; kurier: boolean };
export type ServerInfo = { targets: Target[]; ready: Ready; model?: string; agentRunsPerHour?: number | null };
export type Target = { id: string; title: string; language: string; blurb: string; source: string };
export type ToolEvent = { tool: 'scan' | 'forge' | 'replay' | 'patch' | 'attack'; status: 'running' | 'ok' | 'setup' | 'error'; summary: string; detail?: any };
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; event: ToolEvent }
  | { type: 'review'; status: string; text: string }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; message: string };

const UNREACHABLE = "Can't reach the Elenchos server. Start it with `node --experimental-strip-types packages/agent/src/server.ts` (or the Docker image) and try again.";

export async function getTargets(): Promise<ServerInfo> {
  let r: Response;
  try { r = await fetch(`${API_BASE}/api/targets`); } catch { throw new Error(UNREACHABLE); }
  if (r.status === 404) throw new Error('No Elenchos server is running behind this address yet.');
  if (!r.ok) throw new Error(`The server answered ${r.status} for the target list.`);
  return r.json();
}

export type Finding = { rule: string; severity: 'critical' | 'high' | 'medium'; title: string; contract: string; function: string; file: string; line: number; evidence: string; fix: string };


async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try { r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error(UNREACHABLE); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? `The server answered ${r.status}.`);
  return out as T;
}
/** The pipeline steps without the model. */
export const forgeExploit = () => post<{ event: ToolEvent; leaf: string | null }>('/api/forge', {});
export const askZkVerify = (leaf: string) => post<{ event: ToolEvent }>('/api/replay', { leaf });
export type AttackTest = { name: string; worked: boolean; reason: string | null; logs: string[]; gas: number | null };
export type AttackResult = { status: 'exploitable' | 'blocked' | 'error'; summary: string; template: string | null; contract: string | null; tests: AttackTest[]; ms: number; compileError?: string; testSource: string; forgery?: { vkHash: string; leaf: string; inputs: string[] } };
/** Run the exploit test: a real Foundry test on a local EVM with a real forged proof (no model). */
export const runAttack = (subject: Subject) => post<AttackResult>('/api/attack', subject);
export type Report = {
  id: string; createdAt: string; title: string; source: string; sha256: string; repo: { repo: string; sha: string; path: string } | null;
  findings: Finding[]; compileError: string | null; attack: AttackResult | null; forgery: { vkHash: string; leaf: string; inputs: string[] } | null;
  fix: null | { source: string; sha256: string; verified: boolean; compiles: boolean; reason: string; remaining: string[]; evaded: string[]; attack: AttackResult | null };
  engine: string;
};
/** Ask the server to build a shareable report (it re-runs scan, exploit test and fix verification itself). */
export const createReport = (subject: Subject, patched: string | null, test: string | null) =>
  post<{ id: string; ms: number }>('/api/report', { ...subject, ...(patched ? { patched } : {}), ...(test ? { test } : {}) });
export async function getReport(id: string): Promise<Report> {
  let r: Response;
  try { r = await fetch(`${API_BASE}/api/report/${encodeURIComponent(id)}`); } catch { throw new Error(UNREACHABLE); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? `The server answered ${r.status}.`);
  return out as Report;
}
/** Deterministic audit of one file: Slither + the five Elenchos detectors, no model. */
export const scanFile = (subject: Subject) => post<{ findings: Finding[]; ms: number }>('/api/scan', subject);
/** Compile + re-scan + anti-cheat of an edited file against its original. */
export const verifyFix = (subject: Subject, original: string, patched: string) => post<{ event: ToolEvent }>('/api/verify', { ...subject, original, patched });

export type ProjectFile = { path: string; source: string };
export type ProjectInfo = { id: string; repo: string; ref: string | null; sha: string; kind: 'foundry' | 'hardhat' | 'plain'; deps: string; files: ProjectFile[]; expiresAt: number; ms: number };
/** Clone a public GitHub repository on the server and list its contracts. */
export const connectProject = (url: string) => post<ProjectInfo>('/api/project/connect', { url });
/** Audit every contract of a connected project at once (file paths come back relative to the project). */
export const scanProject = (projectId: string, edits: Record<string, string>) => post<{ findings: Finding[]; ms: number }>('/api/project/scan', { projectId, edits });

/** One file from GitHub, fetched straight from the browser: github.com/o/r/blob/ref/path.sol or a raw URL. */
export async function fetchGithubFile(url: string): Promise<{ name: string; source: string; from: string }> {
  const m = /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.trim());
  const raw = m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : /^https:\/\/raw\.githubusercontent\.com\//.test(url.trim()) ? url.trim() : null;
  if (!raw || !/\.sol(\?.*)?$/.test(raw)) throw new Error('Paste the GitHub link of one .sol file (…/blob/<branch>/path/File.sol), or connect the whole repository.');
  let r: Response;
  try { r = await fetch(raw); } catch { throw new Error('Could not reach GitHub from this browser.'); }
  if (!r.ok) throw new Error(r.status === 404 ? 'GitHub says that file does not exist (or the repository is private).' : `GitHub answered ${r.status}.`);
  const source = await r.text();
  if (source.length > 64 * 1024) throw new Error('That file is over 64 KB.');
  const name = decodeURIComponent(raw.split('?')[0].split('/').pop() ?? 'Imported.sol').replace(/[^A-Za-z0-9_.]/g, '_');
  return { name, source, from: url.trim() };
}

/** What an audit is about: a demo target by id, a pasted file, or a file of a connected project. */
export type Subject = { targetId: string } | { name: string; source: string } | { projectId: string; path: string; edits: Record<string, string> };

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
