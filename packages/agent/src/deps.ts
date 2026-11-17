// Dependency recovery for connected repositories. Many real repos import libraries they never commit or register as
// submodules (an `lib/openzeppelin-contracts` that is .gitignored, `@openzeppelin/...` with no package.json entry,
// `poseidon-solidity/...`). Elenchos finds the imports that would not resolve and fetches the well-known library at a
// version that fits the code: npm packages with install scripts disabled, or a shallow git clone of the library's own
// repository into the lib/ folder the repo's remappings point at. Anything not on the list stays missing, and the
// audit says which import failed.
import { execFile } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_STD = fileURLToPath(new URL('../../../contracts/lib/forge-std/', import.meta.url));
const SKIP = /(^|\/)(lib|node_modules|out|cache|broadcast|\.git|artifacts|typechain|typechain-types|coverage)(\/|$)/;

type Lib = { prefix: string; npm?: string; git?: string; libDir: string; sub: string; versioned?: boolean; npmLayout?: boolean };
/** Import prefix → where it comes from. `sub` is the folder inside the library that the prefix maps to. */
const LIBS: Lib[] = [
  { prefix: '@openzeppelin/contracts-upgradeable/', npm: '@openzeppelin/contracts-upgradeable', git: 'OpenZeppelin/openzeppelin-contracts-upgradeable', libDir: 'openzeppelin-contracts-upgradeable', sub: 'contracts/', versioned: true },
  { prefix: '@openzeppelin/contracts/', npm: '@openzeppelin/contracts', git: 'OpenZeppelin/openzeppelin-contracts', libDir: 'openzeppelin-contracts', sub: 'contracts/', versioned: true },
  { prefix: 'poseidon-solidity/', npm: 'poseidon-solidity', libDir: 'poseidon-solidity', sub: '', npmLayout: true },
  { prefix: 'solmate/', npm: 'solmate', git: 'transmissions11/solmate', libDir: 'solmate', sub: 'src/' },
  { prefix: 'solady/', npm: 'solady', git: 'Vectorized/solady', libDir: 'solady', sub: 'src/' },
  { prefix: '@chainlink/contracts/', npm: '@chainlink/contracts', libDir: 'chainlink', sub: '' },
  { prefix: 'forge-std/', libDir: 'forge-std', sub: 'src/' },
  { prefix: '@sp1-contracts/', git: 'succinctlabs/sp1-contracts', libDir: 'sp1-contracts', sub: 'contracts/src/' },
];
const GIT_BY_DIR = new Map(LIBS.filter((l) => l.git || l.npmLayout).map((l) => [l.libDir, l]));

const run = (cmd: string, args: string[], cwd: string, timeout = 180_000) => new Promise<void>((ok, fail) =>
  execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', npm_config_ignore_scripts: 'true' } },
    (err, _o, stderr) => (err ? fail(new Error(String(stderr || err.message).split('\n').filter(Boolean).slice(-1)[0] ?? 'failed')) : ok())));

function solFiles(dir: string, base = dir, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n); const rel = relative(base, p);
    if (SKIP.test(rel) || n.startsWith('.')) continue;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) solFiles(p, base, out, depth + 1); else if (n.endsWith('.sol')) out.push(p);
  }
  return out;
}

/** npm packages installed in a scratch folder (so the repo's own package.json, workspaces or lockfile can't break the
 *  install), then copied into <root>/node_modules. Scripts stay disabled. */
async function npmInstall(root: string, pkgs: string[]): Promise<void> {
  const { mkdtemp, rm, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const scratch = await mkdtemp(join(tmpdir(), 'elenchos-npm-'));
  try {
    await writeFile(join(scratch, 'package.json'), '{"private":true}\n');
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps', ...pkgs], scratch);
    await mkdir(join(root, 'node_modules'), { recursive: true });
    for (const name of pkgs.map((p) => p.replace(/(.)@[^/]*$/, '$1'))) {
      await rm(join(root, 'node_modules', name), { recursive: true, force: true });
      await cp(join(scratch, 'node_modules', name), join(root, 'node_modules', name), { recursive: true });
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** The remappings the repo already declares (foundry.toml and remappings.txt), as [prefix, target] pairs. */
export function declaredRemappings(root: string): [string, string][] {
  const out: [string, string][] = [];
  const add = (r: string) => { const m = /^\s*(?:[\w-]+:)?([^=\s]+)=(\S+)\s*$/.exec(r); if (m) out.push([m[1], m[2]]); };
  if (existsSync(join(root, 'remappings.txt'))) readFileSync(join(root, 'remappings.txt'), 'utf8').split('\n').forEach(add);
  if (existsSync(join(root, 'foundry.toml'))) {
    const m = /remappings\s*=\s*\[([\s\S]*?)\]/.exec(readFileSync(join(root, 'foundry.toml'), 'utf8'));
    if (m) for (const s of m[1].matchAll(/["']([^"']+)["']/g)) add(s[1]);
  }
  return out;
}

/** OpenZeppelin 4 or 5: the code tells us (v4-only paths, or a compiler older than 0.8.20). */
function ozMajor(sources: string[], root: string): 4 | 5 {
  const all = sources.join('\n');
  if (/@openzeppelin\/contracts(-upgradeable)?\/(security\/|utils\/Counters\.sol|utils\/cryptography\/draft-|token\/ERC20\/extensions\/draft-)/.test(all)) return 4;
  if (/openzeppelin-contracts(-upgradeable)?\/contracts\/(security\/|utils\/Counters\.sol)/.test(all)) return 4;
  const toml = existsSync(join(root, 'foundry.toml')) ? readFileSync(join(root, 'foundry.toml'), 'utf8') : '';
  const v = /solc(?:_version)?\s*=\s*["']?0\.8\.(\d+)/.exec(toml)?.[1];
  if (v && Number(v) < 20) return 4;
  const pragmas = [...all.matchAll(/pragma\s+solidity\s+([^;]+);/g)].map((m) => m[1]);
  if (pragmas.length && pragmas.every((p) => /^[=\s]*0\.8\.(1\d|[0-9])\b/.test(p.trim()) || /<\s*0\.8\.20/.test(p))) return 4;
  return 5;
}

/** Fetch the well-known libraries that a checkout imports but doesn't contain. Returns what was done, for the log. */
export async function recoverDeps(root: string): Promise<string[]> {
  const files = solFiles(root);
  const sources = await Promise.all(files.map((f) => readFile(f, 'utf8').catch(() => '')));
  const imports = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(/import\s+(?:[^'";]*?from\s+)?["']([^"']+)["']/g)) if (!m[1].startsWith('.')) imports.add(m[1]);
  if (!imports.size) return [];
  const remaps = declaredRemappings(root);
  const oz = ozMajor(sources, root);
  const done: string[] = []; const npmWant = new Set<string>(); const newRemaps: string[] = [];
  const cloneLib = async (lib: Lib) => {
    const dest = join(root, 'lib', lib.libDir);
    if (existsSync(dest) && readdirSync(dest).length) return;
    if (lib.libDir === 'forge-std') { await cp(FORGE_STD, dest, { recursive: true, filter: (s) => !/\/\.git(\/|$)/.test(s) }); done.push('forge-std (bundled copy)'); return; }
    if (lib.npmLayout && lib.npm) { // the import paths follow the npm package's layout, not its git repo's
      await npmInstall(root, [lib.npm]); await cp(join(root, 'node_modules', lib.npm), dest, { recursive: true }); done.push(`npm ${lib.npm} → lib/${lib.libDir}`); return;
    }
    const tag = lib.versioned ? (oz === 4 ? 'v4.9.6' : 'v5.0.2') : null;
    await run('git', ['clone', '-q', '--depth', '1', ...(tag ? ['--branch', tag] : []), `https://github.com/${lib.git}.git`, dest], root);
    done.push(`${lib.git}${tag ? `@${tag}` : ''} → lib/${lib.libDir}`);
  };
  const resolves = (imp: string) => {
    for (const [pre, target] of remaps) if (imp.startsWith(pre) && existsSync(join(root, target, imp.slice(pre.length)))) return true;
    if (existsSync(join(root, imp))) return true; // lib/x/... style, or a path relative to the root
    if (existsSync(join(root, 'node_modules', imp))) return true;
    const first = imp.split('/')[0];
    if (existsSync(join(root, 'lib', first, 'src', imp.slice(first.length + 1)))) return true; // forge auto-remapping
    return false;
  };
  for (const imp of imports) {
    if (resolves(imp)) continue;
    // 1. a direct lib/<dir>/... path whose folder is missing
    const lm = /^lib\/([^/]+)\//.exec(imp);
    if (lm) { const lib = GIT_BY_DIR.get(lm[1]) ?? (lm[1] === 'forge-std' ? LIBS.find((l) => l.libDir === 'forge-std') : undefined); if (lib) await cloneLib(lib).catch((e) => done.push(`could not fetch ${lm[1]}: ${e.message}`)); continue; }
    const lib = LIBS.find((l) => imp.startsWith(l.prefix));
    if (!lib) continue;
    // 2. a remapping the repo declares, pointing into a lib/ folder that is missing
    const decl = remaps.find(([pre]) => imp.startsWith(pre));
    const dm = decl && /^(?:\.\/)?lib\/([^/]+)\//.exec(decl[1]);
    if (dm) { const target = GIT_BY_DIR.get(dm[1]) ?? lib; await cloneLib({ ...target, libDir: dm[1] }).catch((e) => done.push(`could not fetch ${dm[1]}: ${e.message}`)); continue; }
    // 3. no remapping: an npm package (or forge-std), plus a remapping for it
    if (lib.libDir === 'forge-std') { await cloneLib(lib); newRemaps.push(`forge-std/=lib/forge-std/src/`); continue; }
    if (lib.npm) { npmWant.add(lib.versioned ? `${lib.npm}@${oz === 4 ? '4.9.6' : '5.0.2'}` : lib.npm); newRemaps.push(`${lib.prefix}=node_modules/${lib.prefix}`); continue; }
    if (lib.git) { await cloneLib(lib).catch((e) => done.push(`could not fetch ${lib.libDir}: ${e.message}`)); newRemaps.push(`${lib.prefix}=lib/${lib.libDir}/${lib.sub}`); }
  }
  if (npmWant.size) {
    try { await npmInstall(root, [...npmWant]); done.push(`npm ${[...npmWant].join(' ')} (scripts disabled)`); }
    catch (e) { done.push(`npm install failed: ${(e as Error).message}`); }
  }
  // An upgradeable OZ v5 checkout imports @openzeppelin/contracts too.
  if (existsSync(join(root, 'lib', 'openzeppelin-contracts-upgradeable')) && !remaps.some(([p]) => p === '@openzeppelin/contracts/') && !newRemaps.some((r) => r.startsWith('@openzeppelin/contracts/'))) {
    if (!existsSync(join(root, 'lib', 'openzeppelin-contracts'))) await cloneLib(GIT_BY_DIR.get('openzeppelin-contracts')!).catch(() => {});
    if (existsSync(join(root, 'lib', 'openzeppelin-contracts'))) newRemaps.push('@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/');
  }
  const extra = [...new Set(newRemaps)].filter((r) => !remaps.some(([p]) => r.startsWith(`${p}=`)));
  if (extra.length) {
    // Into the remappings array of foundry.toml when it has one (the sanitizer keeps that key), else remappings.txt.
    const toml = join(root, 'foundry.toml');
    const t = existsSync(toml) ? readFileSync(toml, 'utf8') : '';
    if (/remappings\s*=\s*\[/.test(t)) await writeFile(toml, t.replace(/remappings\s*=\s*\[/, (m) => `${m}\n  ${extra.map((r) => JSON.stringify(r)).join(',\n  ')},`));
    else { const file = join(root, 'remappings.txt'); const had = existsSync(file) ? readFileSync(file, 'utf8') : ''; await writeFile(file, `${had}${had && !had.endsWith('\n') ? '\n' : ''}${extra.join('\n')}\n`); }
    done.push(`remappings: ${extra.join(', ')}`);
  }
  return done;
}
