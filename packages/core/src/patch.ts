// Deterministic patch verification. A patch is only "verified" if, after it is applied to a throwaway copy of the
// target contract, the Solidity still compiles AND the Elenchos scanner reports zero findings on the function(s)
// that were flagged. This is the guarantee the agent relies on: the LLM proposes an edit, this says yes or no.
// No LLM is called here; nothing is faked. A patch that doesn't compile, or doesn't clear the findings, is rejected.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { scan, type Finding } from './scan.ts';

const run = promisify(execFile);

export type PatchResult = {
  verified: boolean;
  compiles: boolean;
  findingsBefore: Finding[];
  findingsAfter: Finding[];
  cleared: string[];      // "rule@line" entries that disappeared
  remaining: Finding[];   // findings still present after the patch
  evaded: string[];       // ways the patch cheated the scanner instead of fixing the bug
  reason: string;
};

// Public/external function names a contract exposes. A genuine fix keeps the same entry points; deleting or renaming
// the vulnerable function makes the scanner go quiet without fixing anything, so we treat that as an evasion.
const EXTERNAL_FN = /function\s+([A-Za-z_]\w*)\s*\([^)]*\)[^{};]*\b(public|external)\b/g;
function externalFns(src: string): Set<string> {
  const out = new Set<string>(); let m: RegExpExecArray | null;
  const re = new RegExp(EXTERNAL_FN); while ((m = re.exec(src))) out.add(m[1]);
  return out;
}
// Does the code still consume a zkVerify receipt at all? A patch that just rips the proof check out is not a fix.
const CONSUMES = /verifyProofAggregation/;

/** Ways a "scanner-clean" patch can be a cheat rather than a fix. Empty = no evasion detected. */
export function evasions(before: string, after: string): string[] {
  const out: string[] = [];
  const b = externalFns(before), a = externalFns(after);
  const dropped = [...b].filter((f) => !a.has(f));
  if (dropped.length) out.push(`removed or renamed public function(s) the scanner keyed on: ${dropped.join(', ')}`);
  if (CONSUMES.test(before) && !CONSUMES.test(after)) out.push('the patch no longer verifies any zkVerify receipt — it removed the feature instead of fixing it');
  return out;
}

/**
 * @param originalPath absolute path to the target .sol file (inside a Foundry project)
 * @param patchedSource the full new source for that file, as proposed by the agent
 */
export async function verifyPatch(originalPath: string, patchedSource: string): Promise<PatchResult> {
  const findingsBefore = await scan(originalPath);
  // Copy the whole Foundry project so imports (lib/, src/) resolve, then overwrite the one file.
  const projectRoot = await foundryRoot(originalPath);
  const work = await mkdtemp(join(tmpdir(), 'elenchos-patch-'));
  try {
    // Copy src and lib only; a test or deploy script that still constructs the OLD signature is not the
    // question "does this fix close the hole" — the agent updates callers separately.
    await cp(projectRoot, work, { recursive: true, filter: (s) => !/\/(out|cache|\.git|node_modules|test|script)(\/|$)/.test(s) });
    const rel = relative(projectRoot, originalPath);
    const target = join(work, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, patchedSource);

    let compiles = true;
    let buildErr = '';
    try {
      await run('forge', ['build', '--root', work], { maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      compiles = false;
      buildErr = String((e as { stderr?: string }).stderr ?? e).split('\n').filter((l) => /error|Error/.test(l)).slice(0, 2).join(' ');
    }
    if (!compiles) {
      return { verified: false, compiles, findingsBefore, findingsAfter: [], cleared: [], remaining: findingsBefore, evaded: [], reason: `patched contract does not compile: ${buildErr}`.slice(0, 300) };
    }
    const findingsAfter = await scan(target);
    const keyOf = (f: Finding) => `${f.rule}@${f.function}`;
    const afterKeys = new Set(findingsAfter.map(keyOf));
    const cleared = findingsBefore.filter((f) => !afterKeys.has(keyOf(f))).map((f) => `${f.rule}@${f.line}`);
    const { readFileSync: rf } = await import('node:fs');
    const evaded = evasions(rf(originalPath, 'utf8'), patchedSource);
    const scannerClean = findingsAfter.length === 0 && findingsBefore.length > 0;
    const verified = scannerClean && evaded.length === 0;
    return {
      verified, compiles, findingsBefore, findingsAfter, cleared, remaining: findingsAfter, evaded,
      reason: verified
        ? `compiles and the scanner is now clean (cleared ${cleared.join(', ')})`
        : findingsBefore.length === 0 ? 'nothing to fix: the target had no findings'
        : evaded.length ? `the scanner is clean but the patch cheated: ${evaded.join('; ')}`
        : `still ${findingsAfter.length} finding(s) after the patch: ${findingsAfter.map(keyOf).join(', ')}`,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function foundryRoot(file: string): Promise<string> {
  const { existsSync } = await import('node:fs');
  let dir = dirname(resolve(file));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'foundry.toml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`no foundry.toml found above ${file}; the target must live in a Foundry project`);
}
