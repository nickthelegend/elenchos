// Connect a public GitHub repository to the studio: a shallow clone on the server, its Solidity files listed for the
// editor, and whole-project scans (so remapped imports like forge-std or @openzeppelin resolve). The clone is
// untrusted, so its foundry.toml is replaced by one we write (no solc path, no ffi, no fs permissions), dependencies
// install with scripts disabled, and every project expires after two hours.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { recoverDeps } from './deps.ts';

const ROOT = join(tmpdir(), 'elenchos-projects');
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PROJECTS = 8;
const MAX_FILES = 80;
const MAX_FILE = 64 * 1024;
const MAX_REPO_MB = 400;
const SKIP = /(^|\/)(lib|node_modules|out|cache|broadcast|\.git|artifacts|typechain|typechain-types|coverage)(\/|$)/;

export type ProjectFile = { path: string; source: string };
export type Project = { id: string; repo: string; ref: string | null; sha: string; kind: 'foundry' | 'hardhat' | 'plain'; root: string; dir: string; files: ProjectFile[]; deps: string; createdAt: number; explorer?: string };
const projects = new Map<string, Project>();

const run = (cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}) => new Promise<{ stdout: string; stderr: string }>((ok, fail) =>
  execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout ?? 120_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } },
    (err, stdout, stderr) => (err ? fail(Object.assign(err, { stderr })) : ok({ stdout, stderr }))));

/** github.com/owner/repo[/tree/ref[/subdir]] → its parts, or null. */
export function parseRepo(url: unknown): { owner: string; repo: string; ref: string | null; subdir: string | null } | null {
  if (typeof url !== 'string') return null;
  url = url.trim();
  if (!/^(https?:\/\/)?(www\.)?github\.com\//i.test(url) && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}(\/tree\/.*)?$/.test(url)) url = `github.com/${url}`;
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:\/tree\/([A-Za-z0-9._\/-]{1,120}))?\/?$/.exec(url.trim())
    ?? /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(url.trim());
  if (!m) return null;
  let ref: string | null = null; let subdir: string | null = null;
  if (m[3]) { const [r, ...rest] = m[3].split('/'); ref = r; subdir = rest.length ? rest.join('/') : null; }
  if (subdir && (subdir.includes('..') || subdir.startsWith('/'))) return null;
  return { owner: m[1], repo: m[2], ref, subdir };
}

function walk(dir: string, base: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name); const rel = relative(base, p);
    if (SKIP.test(rel)) continue;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isSymbolicLink?.()) continue;
    if (st.isDirectory()) walk(p, base, out, depth + 1);
    else if (name.endsWith('.sol') && !/\.(t|s)\.sol$/.test(name)) out.push(rel);
  }
  return out;
}

function findRoot(dir: string): string {
  const q: [string, number][] = [[dir, 0]];
  while (q.length) {
    const [d, n] = q.shift()!;
    if (existsSync(join(d, 'foundry.toml'))) return d;
    if (n >= 3) continue;
    for (const name of readdirSync(d)) {
      if (SKIP.test(name) || name.startsWith('.')) continue;
      const p = join(d, name); try { if (statSync(p).isDirectory()) q.push([p, n + 1]); } catch {}
    }
  }
  return dir;
}

/** The checkout's foundry.toml with every key that could run or reach something removed: ffi, fs_permissions, a solc
 *  that is a path rather than a version, output and cache paths. A repo without one gets a minimal config. */
const DROP = /^\s*(ffi|fs_permissions|solc|solc_version|solc_path|build_info_path|out|cache_path|broadcast|script|test|allow_paths|include_paths)\s*=/;
export function safeFoundryToml(root: string): string {
  const file = join(root, 'foundry.toml');
  if (!existsSync(file)) {
    // The folder that actually holds the Solidity (a Next.js app also has a src/, with no contracts in it).
    const hasSol = (d: string) => existsSync(join(root, d)) && walk(join(root, d), join(root, d)).length > 0;
    const hh = ['hardhat.config.ts', 'hardhat.config.js', 'hardhat.config.cjs'].map((f) => join(root, f)).find(existsSync);
    const hhSources = hh ? /sources\s*:\s*["'`]\.?\/?([\w./-]+)["'`]/.exec(readFileSync(hh, 'utf8'))?.[1] : undefined;
    const src = hhSources && hasSol(hhSources) ? hhSources : hasSol('contracts') && !hasSol('src') ? 'contracts' : hasSol('src') ? 'src' : hasSol('contracts') ? 'contracts' : '.';
    const libs = ['lib', 'node_modules'].filter((l) => existsSync(join(root, l)));
    return `# Written by Elenchos: this checkout has no foundry.toml.\n[profile.default]\nsrc = "${src}"\nlibs = [${(libs.length ? libs : ['lib']).map((l) => `"${l}"`).join(', ')}]\nauto_detect_solc = true\n`;
  }
  const out: string[] = ['# Sanitized by Elenchos: ffi, fs_permissions, solc paths and output paths were removed.'];
  let skipping = false; let depth = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (skipping) { depth += (line.match(/\[/g) ?? []).length - (line.match(/\]/g) ?? []).length; if (depth <= 0) skipping = false; continue; }
    const m = DROP.exec(line);
    if (m) {
      const val = line.split('=').slice(1).join('=').trim();
      if ((m[1] === 'solc' || m[1] === 'solc_version') && /^["']?\d+\.\d+\.\d+["']?$/.test(val)) { out.push(line); continue; }
      depth = (val.match(/\[/g) ?? []).length - (val.match(/\]/g) ?? []).length; skipping = depth > 0;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function evict() {
  const now = Date.now();
  for (const [id, p] of projects) if (now - p.createdAt > TTL_MS) { projects.delete(id); rm(p.dir, { recursive: true, force: true }).catch(() => {}); }
  while (projects.size >= MAX_PROJECTS) { const [id, p] = projects.entries().next().value as [string, Project]; projects.delete(id); rm(p.dir, { recursive: true, force: true }).catch(() => {}); }
}

export async function connectRepo(url: unknown): Promise<Project> {
  const r = parseRepo(url);
  if (!r) throw new Error('Paste a public GitHub repository, like https://github.com/owner/repo or owner/repo (optionally /tree/<branch>/<folder>).');
  evict();
  const id = randomBytes(8).toString('hex');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(ROOT, { recursive: true });
  const dir = join(ROOT, id);
  const clone = join(dir, 'repo');
  try {
    // Submodules are often declared with SSH URLs (git@github.com:...); the server has no SSH key, so read them over HTTPS.
    // GitHub fetches of big submodules fail now and then, so one retry.
    const args = ['-c', 'url.https://github.com/.insteadOf=git@github.com:', '-c', 'url.https://github.com/.insteadOf=ssh://git@github.com/', 'clone', '--depth', '1',
      '--single-branch', '--no-tags', '--recurse-submodules', '--shallow-submodules', ...(r.ref ? ['--branch', r.ref] : []), `https://github.com/${r.owner}/${r.repo}.git`, clone];
    try { await run('git', args, { timeout: 150_000 }); }
    catch (first) {
      if (/not found|could not read Username|Authentication/i.test(String((first as { stderr?: string }).stderr ?? ''))) throw first;
      await rm(clone, { recursive: true, force: true });
      await run('git', args, { timeout: 150_000 });
    }
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    const msg = String((e as { stderr?: string }).stderr ?? e);
    throw new Error(/submodule/i.test(msg) ? `Cloned ${r.owner}/${r.repo}, but one of its submodules could not be fetched: ${msg.split('\n').filter(Boolean).slice(-1)[0]?.replace(/^fatal: /, '').slice(0, 160) ?? 'unknown error'}` : /not found|could not read|Authentication|terminal prompts/i.test(msg) ? `Couldn't clone ${r.owner}/${r.repo}${r.ref ? ` at ${r.ref}` : ''}: it's private, renamed or doesn't exist. Only public repositories can be connected.` : `Clone failed: ${msg.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200)}`);
  }
  const { stdout: du } = await run('du', ['-sm', clone]);
  if (Number(du.split(/\s/)[0]) > MAX_REPO_MB) { await rm(dir, { recursive: true, force: true }); throw new Error(`${r.owner}/${r.repo} is over ${MAX_REPO_MB} MB with its submodules, the studio's limit. Paste its contracts as files instead.`); }
  const sha = (await run('git', ['-C', clone, 'rev-parse', 'HEAD'])).stdout.trim();
  const base = r.subdir ? resolve(clone, r.subdir) : clone;
  if (!base.startsWith(clone) || !existsSync(base)) { await rm(dir, { recursive: true, force: true }); throw new Error(`No folder ${r.subdir} in ${r.owner}/${r.repo}.`); }
  const root = findRoot(base);
  const kind: Project['kind'] = existsSync(join(root, 'foundry.toml')) ? 'foundry'
    : ['hardhat.config.ts', 'hardhat.config.js', 'hardhat.config.cjs'].some((f) => existsSync(join(root, f))) ? 'hardhat' : 'plain';
  let deps = 'none needed';
  if (existsSync(join(root, 'package.json')) && !existsSync(join(root, 'node_modules'))) {
    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    if (/@openzeppelin|solmate|solady|@chainlink|@uniswap|@zkverify/.test(pkg)) {
      try { await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps'], { cwd: root, timeout: 180_000 }); deps = 'npm packages installed (scripts disabled)'; }
      catch { deps = 'npm install failed: remapped imports may not resolve'; }
    }
  }
  // Libraries the repo imports but doesn't contain (gitignored lib/, missing package.json entries).
  const recovered = await recoverDeps(root).catch((e) => [`dependency recovery failed: ${String((e as Error).message ?? e).slice(0, 120)}`]);
  if (recovered.length) deps = `${deps === 'none needed' ? '' : `${deps}; `}fetched ${recovered.join('; ')}`;
  await writeFile(join(root, 'foundry.toml'), safeFoundryToml(root));
  const files: ProjectFile[] = [];
  for (const rel of walk(root, root).sort()) {
    if (files.length >= MAX_FILES) break;
    const p = join(root, rel);
    if (statSync(p).size > MAX_FILE) continue;
    files.push({ path: rel.split(sep).join('/'), source: readFileSync(p, 'utf8') });
  }
  if (!files.length) { await rm(dir, { recursive: true, force: true }); throw new Error(`No Solidity contracts found in ${r.owner}/${r.repo}${r.subdir ? `/${r.subdir}` : ''} (tests, scripts and libraries are skipped).`); }
  const p: Project = { id, repo: `${r.owner}/${r.repo}`, ref: r.ref, sha, kind, root, dir, files, deps, createdAt: Date.now() };
  projects.set(id, p);
  return p;
}

// ---- Deployed contracts: verified source from Sourcify, or from Blockscout when Sourcify doesn't have it. ----
export const CHAINS: Record<string, { id: number; name: string; blockscout: string | null; explorer: string }> = {
  ethereum: { id: 1, name: 'Ethereum', blockscout: 'https://eth.blockscout.com', explorer: 'https://etherscan.io/address/' },
  sepolia: { id: 11155111, name: 'Sepolia', blockscout: 'https://eth-sepolia.blockscout.com', explorer: 'https://sepolia.etherscan.io/address/' },
  base: { id: 8453, name: 'Base', blockscout: 'https://base.blockscout.com', explorer: 'https://basescan.org/address/' },
  'base-sepolia': { id: 84532, name: 'Base Sepolia', blockscout: 'https://base-sepolia.blockscout.com', explorer: 'https://sepolia.basescan.org/address/' },
  arbitrum: { id: 42161, name: 'Arbitrum One', blockscout: 'https://arbitrum.blockscout.com', explorer: 'https://arbiscan.io/address/' },
  'arbitrum-sepolia': { id: 421614, name: 'Arbitrum Sepolia', blockscout: 'https://arbitrum-sepolia.blockscout.com', explorer: 'https://sepolia.arbiscan.io/address/' },
  optimism: { id: 10, name: 'OP Mainnet', blockscout: 'https://optimism.blockscout.com', explorer: 'https://optimistic.etherscan.io/address/' },
  'optimism-sepolia': { id: 11155420, name: 'OP Sepolia', blockscout: 'https://optimism-sepolia.blockscout.com', explorer: 'https://sepolia-optimism.etherscan.io/address/' },
  polygon: { id: 137, name: 'Polygon', blockscout: 'https://polygon.blockscout.com', explorer: 'https://polygonscan.com/address/' },
  gnosis: { id: 100, name: 'Gnosis', blockscout: 'https://gnosis.blockscout.com', explorer: 'https://gnosisscan.io/address/' },
};

type Fetched = { name: string; compiler: string; sources: Record<string, string>; remappings: string[]; evmVersion: string | null; from: 'Sourcify' | 'Blockscout'; implementation: { address: string; name: string | null } | null };
const getJson = async (url: string) => { const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }); return { status: r.status, body: await r.json().catch(() => null) as any }; };

async function fromSourcify(chainId: number, address: string): Promise<Fetched | null> {
  const { status, body } = await getJson(`https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=sources,compilation,proxyResolution`);
  if (status !== 200 || !body?.sources || !body.compilation) return null;
  const sources: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.sources as Record<string, { content: string }>)) sources[k] = v.content;
  const impl = body.proxyResolution?.implementations?.[0];
  return { name: body.compilation.name, compiler: body.compilation.compilerVersion, sources, remappings: body.compilation.compilerSettings?.remappings ?? [],
    evmVersion: body.compilation.compilerSettings?.evmVersion ?? null, from: 'Sourcify', implementation: impl ? { address: impl.address, name: impl.name ?? null } : null };
}
async function fromBlockscout(base: string, address: string): Promise<Fetched | null> {
  const { status, body } = await getJson(`${base}/api/v2/smart-contracts/${address}`);
  if (status !== 200 || !body?.source_code || body.language && !/solidity/i.test(body.language)) return null;
  const main = body.file_path || `${body.name ?? 'Contract'}.sol`;
  const sources: Record<string, string> = { [main]: body.source_code };
  for (const a of body.additional_sources ?? []) sources[a.file_path] = a.source_code;
  const impl = body.implementations?.[0];
  return { name: body.name, compiler: body.compiler_version, sources, remappings: body.compiler_settings?.remappings ?? [],
    evmVersion: body.evm_version && body.evm_version !== 'default' ? body.evm_version : body.compiler_settings?.evmVersion ?? null, from: 'Blockscout',
    implementation: impl ? { address: impl.address_hash ?? impl.address, name: impl.name ?? null } : null };
}

/** Load a deployed contract's verified source as a project (one Foundry project with the exact compiler it used). */
export async function connectAddress(chain: unknown, address: unknown): Promise<Project & { from: string; chain: string; address: string; explorer: string; implementation: Fetched['implementation'] }> {
  const c = typeof chain === 'string' ? CHAINS[chain] : undefined;
  if (!c) throw new Error(`Pick a chain: ${Object.keys(CHAINS).join(', ')}.`);
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())) throw new Error('Paste a contract address: 0x followed by 40 hex characters.');
  const addr = address.trim();
  const got = (await fromSourcify(c.id, addr).catch(() => null)) ?? (c.blockscout ? await fromBlockscout(c.blockscout, addr).catch(() => null) : null);
  if (!got) throw new Error(`No verified source for ${addr} on ${c.name}: neither Sourcify nor Blockscout has it. Only verified contracts can be audited by address.`);
  const version = /(\d+\.\d+\.\d+)/.exec(got.compiler ?? '')?.[1];
  if (!version) throw new Error(`Unknown compiler version "${got.compiler}" for ${addr}.`);
  if (Object.keys(got.sources).length > 400) throw new Error('That contract has over 400 source files, the studio\'s limit.');
  evict();
  const id = randomBytes(8).toString('hex');
  const dir = join(ROOT, id); const root = join(dir, 'repo');
  const { mkdir } = await import('node:fs/promises');
  for (const [k, v] of Object.entries(got.sources)) {
    const rel = k.replace(/^\/+/, '').replace(/^[A-Za-z]:\//, '');
    if (!rel || rel.split('/').includes('..') || typeof v !== 'string') continue;
    const target = resolve(root, rel);
    if (!target.startsWith(root + sep)) continue;
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, v);
  }
  // Every source unit lives at its own name under the root, so the root is the base path and imports resolve as solc saw them.
  const remaps = got.remappings.filter((r) => typeof r === 'string' && !r.includes('..') && !/=\s*\//.test(r) && /^[^=]+=[^=]*$/.test(r));
  await writeFile(join(root, 'foundry.toml'), `# Written by Elenchos for ${addr} on ${c.name} (source from ${got.from}).\n[profile.default]\nsrc = "."\nlibs = []\nsolc_version = "${version}"\n${got.evmVersion ? `evm_version = "${got.evmVersion}"\n` : ''}${remaps.length ? `remappings = [${remaps.map((r) => JSON.stringify(r)).join(', ')}]\n` : ''}`);
  const files: ProjectFile[] = [];
  const isLib = (p: string) => /^(@|lib\/|node_modules\/|\.deps\/)/.test(p) || /(^|\/)(openzeppelin|forge-std|solmate|solady)(-[\w.-]+)?\//i.test(p);
  const paths = walk(root, root).map((r) => r.split(sep).join('/')).sort((a, b) => Number(isLib(a)) - Number(isLib(b)) || a.localeCompare(b));
  for (const rel of paths) {
    if (files.length >= MAX_FILES) break;
    if (isLib(rel) && files.length) continue;
    const p = join(root, rel); if (statSync(p).size > MAX_FILE) continue;
    files.push({ path: rel, source: readFileSync(p, 'utf8') });
  }
  if (!files.length) { await rm(dir, { recursive: true, force: true }); throw new Error(`The verified source of ${addr} has no Solidity files Elenchos can read.`); }
  const p: Project = { id, repo: `${c.name} · ${got.name ?? 'contract'} ${addr.slice(0, 6)}…${addr.slice(-4)}`, ref: null, sha: addr, kind: 'foundry', root, dir, files,
    deps: `${Object.keys(got.sources).length} source files from ${got.from}, solc ${version}`, createdAt: Date.now(), explorer: `${c.explorer}${addr}` };
  projects.set(id, p);
  return { ...p, from: got.from, chain: c.name, address: addr, explorer: `${c.explorer}${addr}`, implementation: got.implementation };
}

export const getProject = (id: unknown) => (typeof id === 'string' ? projects.get(id) : undefined);

/** A throwaway copy of a connected project with the editor's edits applied; `fn` gets the copy's root. */
export async function withProjectCopy<T>(p: Project, edits: Record<string, string>, fn: (root: string) => Promise<T>): Promise<T> {
  const known = new Set(p.files.map((f) => f.path));
  for (const k of Object.keys(edits)) if (!known.has(k)) throw new Error(`${k} is not a file of ${p.repo}`);
  const work = await mkdtemp(join(tmpdir(), 'elenchos-ws-'));
  try {
    // node_modules is read-only for a build and can be hundreds of MB, so the copy links to it instead of duplicating it.
    await cp(p.root, work, { recursive: true, filter: (s) => { const rel = s.slice(p.root.length); return !/\/(out|cache|\.git)(\/|$)/.test(rel) && !/^\/(test|script|node_modules)(\/|$)/.test(rel); } });
    if (existsSync(join(p.root, 'node_modules'))) await symlink(join(p.root, 'node_modules'), join(work, 'node_modules'), 'dir');
    for (const [k, v] of Object.entries(edits)) await writeFile(join(work, k), v);
    return await fn(work);
  } finally { await rm(work, { recursive: true, force: true }); }
}

export const summary = (p: Project) => ({ id: p.id, repo: p.repo, ref: p.ref, sha: p.sha, kind: p.kind, deps: p.deps, files: p.files, explorer: p.explorer ?? null, expiresAt: p.createdAt + TTL_MS });
