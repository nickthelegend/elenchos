// A throwaway Foundry workspace for a contract someone pasted into the studio. The repo's contracts project is copied
// (src + lib, so `../interfaces/...` and forge-std imports resolve), the file lands in src/user/, and the whole copy is
// deleted afterwards. Nothing a visitor sends ever touches the repo itself.
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACTS = fileURLToPath(new URL('../../../contracts/', import.meta.url));
export const MAX_SOURCE = 64 * 1024;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,47}\.sol$/;

/** Returns null when the file is acceptable, else a readable reason. */
export function badSource(name: unknown, source: unknown): string | null {
  if (typeof name !== 'string' || !NAME.test(name)) return 'name must look like MyContract.sol (letters, digits, underscore; at most 48 characters)';
  if (typeof source !== 'string' || !source.trim()) return 'source must be a non-empty string of Solidity';
  if (source.length > MAX_SOURCE) return `source is over ${MAX_SOURCE / 1024} KB`;
  if (!/\bpragma\s+solidity\b/.test(source)) return 'source needs a `pragma solidity` line';
  return null;
}

// At most two workspaces at once: compiles and Slither runs are heavy, and a public studio must not fall over.
let active = 0;
const waiters: (() => void)[] = [];
async function slot() { if (active < 2) { active++; return; } await new Promise<void>((ok) => waiters.push(ok)); active++; }
function release() { active--; waiters.shift()?.(); }
/** Run `fn` in one of the two compile/scan slots. */
export async function limited<T>(fn: () => Promise<T>): Promise<T> { await slot(); try { return await fn(); } finally { release(); } }

export async function withWorkspace<T>(name: string, source: string, fn: (path: string) => Promise<T>): Promise<T> {
  return limited(() => inWorkspace(name, source, fn));
}
async function inWorkspace<T>(name: string, source: string, fn: (path: string) => Promise<T>): Promise<T> {
  const work = await mkdtemp(join(tmpdir(), 'elenchos-ws-'));
  try {
    await cp(CONTRACTS, work, { recursive: true, filter: (s) => !/\/(out|cache|\.git|node_modules|test|script|broadcast)(\/|$)/.test(s.slice(CONTRACTS.length - 1)) });
    const path = join(work, 'src', 'user', name);
    await mkdir(join(work, 'src', 'user'), { recursive: true });
    await writeFile(path, source);
    return await fn(path);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** A small per-IP budget for the paid model, so an open studio can't run up a bill. */
const hits = new Map<string, number[]>();
export function overBudget(ip: string, perHour = Number(process.env.ELENCHOS_INVESTIGATIONS_PER_HOUR ?? 0)): boolean {
  if (!perHour) return false; // 0 = unlimited (local use)
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= perHour) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  return false;
}
