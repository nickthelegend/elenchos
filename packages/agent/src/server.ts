// Elenchos server: serves the landing page and the studio, audits contracts, runs the pipeline steps and streams agent
// investigations over SSE. Run: ANTHROPIC_API_KEY=... node --experimental-strip-types src/server.ts (reads elenchos/.env)
//
// Every audit endpoint takes one of three subjects:
//   {targetId}                          a demo target in this repo
//   {name, source}                      a pasted file, audited in a throwaway copy of the repo's Foundry project
//   {projectId, path, edits?}           a file of a connected GitHub project, audited in a throwaway copy of it
import { createServer } from 'node:http';
import { readFileSync, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { investigate } from './agent.ts';
import { TARGETS, findTarget, source } from './targets.ts';
import { badSource, limited, overBudget, withWorkspace } from './workspace.ts';
import { forgeTool, patchTool, replayTool, scanTool } from './tools.ts';
import { CHAINS, connectAddress, connectRepo, getProject, summary, withProjectCopy } from './project.ts';
import { runAttack, deniedCheatcode } from './exploit.ts';
import { forgeryFor } from './tools.ts';
import { badge, getReport, saveReport, sha256 } from './report.ts';
import { handleMcp } from './mcp.ts';
import { anchorReady, auditor, canonical, checkAnchor, resumeAnchors, startAnchor } from './anchor.ts';
import { writeFile } from 'node:fs/promises';
import { scan as coreScan, bySeverity } from '@elenchos/core/src/scan.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
try { if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`); } catch {}
const WEB = resolve(fileURLToPath(new URL('../../web/dist/', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8787);
const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/\/[^\s'"]*elenchos-(ws|projects)[^\s'"]*?\/(repo\/)?/g, '').slice(0, 600);

const MAX_BODY = 1024 * 1024;
class TooLarge extends Error {}
class BadRequest extends Error {}
const readBody = (req: any) => new Promise<string>((ok, fail) => {
  let d = ''; let over = Number(req.headers['content-length'] ?? 0) > MAX_BODY;
  req.on('data', (c: Buffer) => { if (!over) { d += c; over = d.length > MAX_BODY; } });
  req.on('end', () => (over ? fail(new TooLarge()) : ok(d))); req.on('error', fail);
});
async function body(req: any): Promise<Record<string, unknown>> {
  let b: unknown;
  try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) { throw e instanceof TooLarge ? e : new BadRequest('request body must be JSON'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequest('request body must be a JSON object');
  return b as Record<string, unknown>;
}

function foundryRootOf(path: string): string {
  let dir = dirname(path);
  for (let i = 0; i < 10; i++) { if (existsSync(join(dir, 'foundry.toml'))) return dir; const up = dirname(dir); if (up === dir) break; dir = up; }
  return dirname(path);
}
// When a contract won't compile, say why in solc's own words (the scanner only knows "compilation failed").
async function compileError(path: string): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  const root = foundryRootOf(path);
  return new Promise((ok) => execFile('forge', ['build', '--root', root], { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
    if (!err) return ok(null);
    const text = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = text.split('\n').filter((l) => /Error|error\[|-->/.test(l)).slice(0, 4).map((l) => l.split(root + '/').join('').trim());
    ok(lines.length ? `The contract does not compile: ${lines.join(' ')}` : 'The contract does not compile.');
  }));
}

/** Resolve the subject of a request and run `fn` on a real file path for it. */
async function withSubject<T>(b: Record<string, unknown>, fn: (path: string, original: string, title: string) => Promise<T>, opts: { originalKey?: string } = {}): Promise<T> {
  if (typeof b.projectId === 'string') {
    const p = getProject(b.projectId);
    if (!p) throw new BadRequest('That project expired (projects are kept for two hours). Connect it again.');
    const path = typeof b.path === 'string' ? b.path : '';
    const file = p.files.find((f) => f.path === path);
    if (!file) throw new BadRequest(`${path} is not a file of ${p.repo}`);
    const edits = (b.edits && typeof b.edits === 'object' ? b.edits : {}) as Record<string, string>;
    for (const v of Object.values(edits)) if (typeof v !== 'string' || v.length > 256 * 1024) throw new BadRequest('edits must map file paths to source strings');
    const original = typeof b[opts.originalKey ?? ''] === 'string' ? (b[opts.originalKey!] as string) : (edits[path] ?? file.source);
    return limited(() => withProjectCopy(p, { ...edits, [path]: original }, (root) => fn(join(root, path), original, `${p.repo}/${path}`)));
  }
  if (typeof b.targetId === 'string' && b.source === undefined && b.original === undefined) {
    const t = findTarget(b.targetId); if (!t) throw new BadRequest('unknown target');
    return fn(t.path, source(t), t.title);
  }
  const src = (opts.originalKey ? b[opts.originalKey] : b.source) as unknown;
  const bad = badSource(b.name, src); if (bad) throw new BadRequest(bad);
  return withWorkspace(b.name as string, src as string, (path) => fn(path, src as string, b.name as string));
}

function enableViaIr(root: string): boolean {
  const toml = join(root, 'foundry.toml');
  if (!existsSync(toml)) return false;
  const t = readFileSync(toml, 'utf8');
  if (/^\s*via_ir\s*=\s*true/m.test(t)) return false;
  writeFileSync(toml, /\[profile\.default\]/.test(t) ? t.replace(/\[profile\.default\]/, '[profile.default]\nvia_ir = true') : `${t}\n[profile.default]\nvia_ir = true\n`);
  return true;
}

const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    if (e instanceof TooLarge) return json(res, 413, { error: `request body over ${MAX_BODY / 1024} KB` });
    if (e instanceof BadRequest) return json(res, 400, { error: e.message });
    console.error('request failed:', String(e).slice(0, 200));
    if (!res.headersSent) json(res, 422, { error: clean(e) });
    else res.end();
  });
});

async function route(req: any, res: any) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, authorization', 'access-control-max-age': '86400' }); res.end(); return; }
  if (req.method === 'GET' && url.pathname === '/api/targets') {
    return json(res, 200, { targets: TARGETS.map((t) => ({ id: t.id, title: t.title, language: t.language, blurb: t.blurb, source: source(t) })),
      ready: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY), rpc: true /* built-in public read-only nodes; override with SEPOLIA_RPC_URL */, kurier: Boolean(process.env.KURIER_API_KEY), anchor: !anchorReady() },
      auditor: await auditor(),
      chains: Object.entries(CHAINS).map(([id, c]) => ({ id, name: c.name })), model: process.env.ELENCHOS_MODEL ?? 'claude-sonnet-5-5', agentRunsPerHour: Number(process.env.ELENCHOS_INVESTIGATIONS_PER_HOUR ?? 0) || null });
  }
  // MCP (Streamable HTTP, stateless): POST JSON-RPC, get JSON back. There is no server-to-client stream, so GET is 405.
  if (url.pathname === '/mcp') {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', 'access-control-allow-origin': '*' }); res.end(); return; }
    let msg: unknown;
    try { msg = JSON.parse(await readBody(req)); } catch (e) { if (e instanceof TooLarge) throw e; return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const out = await handleMcp(msg, PORT, ip);
    if (out === null) { res.writeHead(202, { 'access-control-allow-origin': '*' }); res.end(); return; }
    return json(res, 200, out);
  }
  const rep = /^\/api\/report\/([A-Za-z0-9_-]{8})$/.exec(url.pathname);
  if (req.method === 'GET' && rep) { const r = getReport(rep[1]); return r ? json(res, 200, r) : json(res, 404, { error: 'No report with that id on this server.' }); }
  // Proof of audit: the exact bytes that are anchored, a fresh check against zkVerify's verifier on Sepolia, and (POST)
  // anchoring a report made before anchoring existed. New reports are anchored as soon as they are made.
  const can = /^\/api\/report\/([A-Za-z0-9_-]{8})\/canonical$/.exec(url.pathname);
  if (req.method === 'GET' && can) { const r = getReport(can[1]); if (!r) return json(res, 404, { error: 'No report with that id on this server.' }); res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(canonical(r)); return; }
  const chk = /^\/api\/report\/([A-Za-z0-9_-]{8})\/check$/.exec(url.pathname);
  if (req.method === 'GET' && chk) { try { return json(res, 200, await checkAnchor(chk[1])); } catch (e) { return json(res, 400, { error: clean(e) }); } }
  const anc = /^\/api\/report\/([A-Za-z0-9_-]{8})\/anchor$/.exec(url.pathname);
  if (req.method === 'POST' && anc) {
    if (overBudget('anchor:global', 30)) return json(res, 429, { error: 'This server anchors at most 30 reports an hour on zkVerify.' });
    try { return json(res, 200, { anchor: await startAnchor(anc[1]) }); } catch (e) { return json(res, 400, { error: clean(e) }); }
  }
  const bdg = /^\/api\/badge\/([A-Za-z0-9_-]{8})\.svg$/.exec(url.pathname);
  if (req.method === 'GET' && bdg) { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=300', 'access-control-allow-origin': '*' }); res.end(badge(getReport(bdg[1]))); return; }
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  const b = await body(req);

  // Connect a public GitHub repository: clone, list its contracts.
  if (url.pathname === '/api/project/connect') {
    const started = Date.now();
    const p = await connectRepo(b.url);
    return json(res, 200, { ...summary(p), ms: Date.now() - started });
  }
  // Load a deployed contract's verified source (Sourcify, then Blockscout) as a project.
  if (url.pathname === '/api/address/connect') {
    const started = Date.now();
    const p = await connectAddress(b.chain, b.address);
    return json(res, 200, { ...summary(p), from: p.from, chain: p.chain, address: p.address, explorer: p.explorer, implementation: p.implementation, ms: Date.now() - started });
  }
  // Audit a whole connected project at once.
  if (url.pathname === '/api/project/scan') {
    const p = getProject(b.projectId); if (!p) throw new BadRequest('That project expired (projects are kept for two hours). Connect it again.');
    const edits = (b.edits && typeof b.edits === 'object' ? b.edits : {}) as Record<string, string>;
    const started = Date.now();
    const once = () => limited(() => withProjectCopy(p, edits, async (root) => {
      try { const real = realpathSync(root); return bySeverity(await coreScan(root)).map((f) => ({ ...f, file: relative(real, realpathSync(f.file)).split(sep).join('/') })); }
      catch (e) { throw new Error((await compileError(join(root, 'foundry.toml'))) ?? String((e as Error).message ?? e)); }
    }));
    let findings;
    try { findings = await once(); }
    catch (e) {
      // "Stack too deep": the repo needs the IR pipeline (its own config often sets it per profile). Retry once with it.
      if (!/Stack too deep/i.test(String((e as Error).message)) || !enableViaIr(p.root)) throw e;
      findings = await once();
    }
    return json(res, 200, { findings, ms: Date.now() - started });
  }
  // Deterministic audit of one file: Slither + the five Elenchos detectors. No model involved.
  if (url.pathname === '/api/scan') {
    const started = Date.now();
    const { findings } = await withSubject(b, async (path) => {
      try { return await scanTool(path); }
      catch (e) { throw new Error(await compileError(path) ?? String((e as Error).message ?? e)); }
    });
    return json(res, 200, { findings, ms: Date.now() - started });
  }
  // The pipeline steps without the model: snarkjs, the Sepolia verifier, Foundry + Slither.
  if (url.pathname === '/api/forge') {
    const amount = typeof b.amount === 'string' && /^[0-9]{1,30}$/.test(b.amount) ? BigInt(b.amount) : 1_000_000n;
    const recipient = typeof b.recipient === 'string' && /^0x[0-9a-fA-F]{1,40}$/.test(b.recipient) ? BigInt(b.recipient) : 0xA11cEn;
    const r = await forgeTool(recipient, amount);
    return json(res, 200, { event: r.event, leaf: r.leaf });
  }
  if (url.pathname === '/api/replay') {
    if (typeof b.leaf !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(b.leaf)) throw new BadRequest('leaf must be the 32-byte hex leaf a forge call returned');
    return json(res, 200, { event: (await replayTool(b.leaf as `0x${string}`)).event });
  }
  if (url.pathname === '/api/verify') {
    if (typeof b.patched !== 'string' || !b.patched.trim()) throw new BadRequest('patched must be the full edited source');
    const r = await withSubject(b, (path) => patchTool(path, b.patched as string), { originalKey: 'original' });
    return json(res, 200, { event: r.event });
  }
  // Run the attack: a real Foundry exploit test on a local EVM, with a real forged proof (see exploit.ts).
  if (url.pathname === '/api/attack') {
    if (b.test !== undefined && (typeof b.test !== 'string' || b.test.length > 64 * 1024)) throw new BadRequest('test must be Solidity source of at most 64 KB');
    if (typeof b.test === 'string') { const d = deniedCheatcode(b.test); if (d) throw new BadRequest(`Refused: the exploit test calls vm.${d}(), which reaches outside the EVM.`); }
    const forgery = await forgeryFor();
    const subj = typeof b.targetId === 'string' && b.projectId === undefined && b.source === undefined
      ? (() => { const t = findTarget(b.targetId as string); if (!t) throw new BadRequest('unknown target'); return { name: t.title, source: source(t) }; })()
      : b;
    const r = await withSubject(subj, (path, original) => runAttack(foundryRootOf(path), path, original, forgery, (b.test as string) ?? null));
    return json(res, 200, { ...r, forgery });
  }
  // A shareable report. The server produces every result in it: scan, exploit test, and (with a fix) verification
  // plus the same exploit test against the fix. The browser only sends the source.
  if (url.pathname === '/api/report') {
    for (const k of ['patched', 'test', 'fixTest'] as const) if (b[k] !== undefined && (typeof b[k] !== 'string' || (b[k] as string).length > 64 * 1024)) throw new BadRequest(`${k} must be Solidity source of at most 64 KB`);
    for (const k of ['test', 'fixTest'] as const) if (typeof b[k] === 'string') { const d = deniedCheatcode(b[k] as string); if (d) throw new BadRequest(`Refused: the exploit test calls vm.${d}(), which reaches outside the EVM.`); }
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (overBudget(`report:${ip}`, 30)) return json(res, 429, { error: 'This server makes at most 30 reports an hour per visitor.' });
    const forgery = await forgeryFor();
    const subj = typeof b.targetId === 'string' && b.projectId === undefined && b.source === undefined
      ? (() => { const t = findTarget(b.targetId as string); if (!t) throw new BadRequest('unknown target'); return { name: t.title, source: source(t) }; })()
      : b;
    const p = typeof b.projectId === 'string' ? getProject(b.projectId) : null;
    const patched = typeof b.patched === 'string' ? b.patched : null;
    const test = typeof b.test === 'string' ? b.test : null;
    const fixTest = typeof b.fixTest === 'string' ? b.fixTest : null; // the fix may change claim(), so it can have its own test
    const started = Date.now();
    const report = await withSubject(subj, async (path, original, title) => {
      let findings: Awaited<ReturnType<typeof scanTool>>['findings'] = []; let failed: string | null = null;
      try { findings = (await scanTool(path)).findings; } catch (e) { failed = (await compileError(path)) ?? String((e as Error).message ?? e); }
      let fix = null;
      const fixVerify = patched && patched !== original ? (await patchTool(path, patched)).result : null;
      const root = foundryRootOf(path);
      const attack = failed ? null : await runAttack(root, path, original, forgery, test);
      if (fixVerify && patched) {
        await writeFile(path, patched);
        const fixAttack = fixVerify.compiles ? await runAttack(root, path, patched, forgery, fixTest) : null;
        fix = { source: patched, sha256: sha256(patched), verified: fixVerify.verified, compiles: fixVerify.compiles, reason: fixVerify.reason,
          remaining: fixVerify.remaining.map((f) => `${f.rule} ${f.function}`), evaded: fixVerify.evaded, attack: fixAttack };
      }
      return saveReport({ title, source: original, sha256: sha256(original), repo: p ? { repo: p.repo, sha: p.sha, path: String(b.path), explorer: p.explorer ?? null } : null,
        findings, compileError: failed, attack, forgery, fix, engine: 'Slither + the five Elenchos detectors · Foundry exploit test · deterministic fix verifier' });
    });
    // Anchor it on zkVerify in the background (the report page shows the progress); skipped with "Setup required".
    if (!anchorReady() && !overBudget('anchor:global', 30)) await startAnchor(report.id).catch(() => {});
    return json(res, 200, { id: report.id, ms: Date.now() - started });
  }
  if (url.pathname === '/api/investigate') {
    const { prompt, history = [] } = b as { prompt?: unknown; history?: unknown };
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 4000)) throw new BadRequest('prompt must be a string of at most 4000 characters');
    const turnsOk = Array.isArray(history) && history.length <= 20 && history.every((h) =>
      h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.length <= 20000);
    if (!turnsOk) throw new BadRequest('history must be at most 20 {role: "user"|"assistant", text} turns');
    if (b.projectId === undefined && b.source === undefined && !findTarget(b.targetId as string)) throw new BadRequest('unknown target');
    if (b.source !== undefined) { const bad = badSource(b.name, b.source); if (bad) throw new BadRequest(bad); }
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (overBudget(ip)) return json(res, 429, { error: 'This public studio allows a few agent investigations per hour per visitor. Run audit, Forge, Ask zkVerify and Verify fix still work without the agent.' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', 'access-control-allow-origin': '*' });
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    try {
      await withSubject(b, (path, original, title) => investigate({ targetPath: path, originalSource: original, history: history as { role: 'user' | 'assistant'; text: string }[],
        prompt: (prompt as string) || `Investigate ${title}. Find every hole, forge a proof to show the impact, read the real verifier, then propose and verify a fix.`, signal: ac.signal }, send));
    } catch (e) { send({ type: 'error', message: clean(e) }); send({ type: 'done', stopReason: 'error' }); }
    res.end();
    return;
  }
  return json(res, 404, { error: 'not found' });
}

function serveStatic(req: any, res: any, url: URL) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { error: 'not found' });
  let p: string;
  try { p = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); } catch { return json(res, 400, { error: 'bad path' }); }
  const file = resolve(WEB, `.${p}`);
  if (!file.startsWith(WEB + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  const ext = file.split('.').pop() ?? '';
  const ct = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' }[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct }); res.end(readFileSync(file));
}
server.listen(PORT, () => { console.log(`Elenchos on http://localhost:${PORT}`); resumeAnchors(); });
