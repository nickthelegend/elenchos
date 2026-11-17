// Runs the Slither-based Elenchos detector (detectors/elenchos_scan.py) and returns its findings as data.
// The Python interpreter is the one that has Slither installed; it is resolved from ELENCHOS_SLITHER_PYTHON,
// then a repo-local default, then plain python3. No findings are invented here — this only shells out and parses.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export type Severity = 'critical' | 'high' | 'medium';
export type Finding = {
  rule: string; severity: Severity; title: string; contract: string; function: string;
  file: string; line: number; evidence: string; fix: string;
};

function python(): string {
  const candidates = [
    process.env.ELENCHOS_SLITHER_PYTHON,
    `${process.env.HOME}/.local/share/uv/tools/slither-analyzer/bin/python`,
  ].filter((p): p is string => Boolean(p) && existsSync(p!));
  return candidates[0] ?? 'python3';
}

/** A file whose imports are remapped (forge-std/, @openzeppelin/...) only compiles inside its Foundry project. */
function projectScope(target: string): string | null {
  const { statSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  const { dirname, join } = require('node:path') as typeof import('node:path');
  try { if (!statSync(target).isFile()) return null; } catch { return null; }
  if (!/import\s+(?:[^'";]*from\s+)?["'](?!\.)/.test(readFileSync(target, 'utf8'))) return null;
  let dir = dirname(target);
  for (let i = 0; i < 8; i++) { if (existsSync(join(dir, 'foundry.toml'))) return dir; const up = dirname(dir); if (up === dir) break; dir = up; }
  return null;
}

/** Scans a .sol file or a project directory. Throws loudly if Slither is missing or the target doesn't parse.
 *  A file with remapped imports is scanned as part of its Foundry project, and only its own findings are returned. */
export async function scan(target: string): Promise<Finding[]> {
  const scope = projectScope(target);
  if (scope) {
    const { realpathSync } = await import('node:fs');
    const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
    const all = await scanRaw(scope);
    return all.filter((f) => real(f.file) === real(target));
  }
  return scanRaw(target);
}

async function scanRaw(target: string): Promise<Finding[]> {
  const script = `${REPO}detectors/elenchos_scan.py`;
  const tmp = `${process.env.TMPDIR ?? '/tmp'}/elenchos-scan-${process.hrtime.bigint()}.json`;
  try {
    await run(python(), ['-I', script, target, '--json', tmp], { maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`Elenchos scan failed: ${(err.stderr || err.message).split('\n').slice(-3).join(' ').slice(0, 400)}`);
  }
  const { readFileSync, rmSync } = await import('node:fs');
  const out = JSON.parse(readFileSync(tmp, 'utf8')) as { findings: Finding[] };
  rmSync(tmp, { force: true });
  return out.findings;
}

export const bySeverity = (f: Finding[]) =>
  [...f].sort((a, b) => ({ critical: 0, high: 1, medium: 2 }[a.severity] - { critical: 0, high: 1, medium: 2 }[b.severity]));
