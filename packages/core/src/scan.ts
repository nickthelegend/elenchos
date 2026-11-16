// Runs the Slither-based Elenchos detector (detectors/elenchos_scan.py) and returns its findings as data.
// The Python interpreter is the one that has Slither installed; it is resolved from ELENCHOS_SLITHER_PYTHON,
// then a repo-local default, then plain python3. No findings are invented here — this only shells out and parses.
import { execFile } from 'node:child_process';
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

/** Scans a .sol file or a project directory. Throws loudly if Slither is missing or the target doesn't parse. */
export async function scan(target: string): Promise<Finding[]> {
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
