// Elenchos local server: serves the case-room UI, lists targets, and streams an investigation over SSE.
// Run: ANTHROPIC_API_KEY=... node --experimental-strip-types src/server.ts   (reads elenchos/.env if present)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { investigate } from './agent.ts';
import { TARGETS, findTarget, source } from './targets.ts';
import { badSource, overBudget, withWorkspace } from './workspace.ts';
import { scanTool } from './tools.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
try { if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`); } catch {}
const WEB = resolve(fileURLToPath(new URL('../../web/dist/', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8787);
const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };

const MAX_BODY = 256 * 1024;
class TooLarge extends Error {}
const readBody = (req: any) => new Promise<string>((ok, fail) => {
  let d = ''; let over = Number(req.headers['content-length'] ?? 0) > MAX_BODY;
  req.on('data', (c: Buffer) => { if (!over) { d += c; over = d.length > MAX_BODY; } });
  req.on('end', () => (over ? fail(new TooLarge()) : ok(d))); req.on('error', fail);
});

// When a pasted contract won't compile, say why in solc's own words (the scanner only knows "compilation failed").
async function compileError(path: string): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  const root = path.slice(0, path.indexOf('/src/user/'));
  return new Promise((ok) => execFile('forge', ['build', '--root', root], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (!err) return ok(null);
    const text = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = text.split('\n').filter((l) => /Error|error\[|-->/.test(l)).slice(0, 4).map((l) => l.replace(root, '').trim());
    ok(lines.length ? `The contract does not compile: ${lines.join(' ')}` : 'The contract does not compile.');
  }));
}

const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error('request failed:', String(e).slice(0, 200));
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    else res.end();
  });
});

async function route(req: any, res: any) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); res.end(); return; }
  if (req.method === 'GET' && url.pathname === '/api/targets') {
    return json(res, 200, { targets: TARGETS.map((t) => ({ id: t.id, title: t.title, language: t.language, blurb: t.blurb, source: source(t) })),
      ready: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY), rpc: true /* built-in public read-only node; override with SEPOLIA_RPC_URL */, kurier: Boolean(process.env.KURIER_API_KEY) } });
  }
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    // Deterministic audit of any pasted contract: Slither + the five Elenchos detectors. No model involved.
    let b: { name?: unknown; source?: unknown };
    try { b = JSON.parse((await readBody(req)) || '{}'); }
    catch (e) { return e instanceof TooLarge ? json(res, 413, { error: `request body over ${MAX_BODY} bytes` }) : json(res, 400, { error: 'request body must be JSON: {"name": "X.sol", "source": "..."}' }); }
    const bad = badSource(b?.name, b?.source);
    if (bad) return json(res, 400, { error: bad });
    const started = Date.now();
    try {
      const { findings } = await withWorkspace(b.name as string, b.source as string, async (path) => {
        try { return await scanTool(path); }
        catch (e) { throw new Error(await compileError(path) ?? String((e as Error).message ?? e)); }
      });
      return json(res, 200, { findings, ms: Date.now() - started });
    } catch (e) {
      return json(res, 422, { error: String((e as Error).message ?? e).replace(/\/[^\s'"]*elenchos-ws-[^/\s]*/g, '').slice(0, 600) });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/investigate') {
    let parsed: { targetId?: unknown; prompt?: unknown };
    try { parsed = JSON.parse((await readBody(req)) || '{}'); }
    catch (e) { return e instanceof TooLarge ? json(res, 413, { error: `request body over ${MAX_BODY} bytes` }) : json(res, 400, { error: 'request body must be JSON: {"targetId": "...", "prompt": "..."}' }); }
    if (!parsed || typeof parsed !== 'object') return json(res, 400, { error: 'request body must be a JSON object' });
    const { targetId, prompt, history = [] } = parsed as { targetId?: string; prompt?: string; history?: unknown };
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 4000)) return json(res, 400, { error: 'prompt must be a string of at most 4000 characters' });
    const turnsOk = Array.isArray(history) && history.length <= 20 && history.every((h) =>
      h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.length <= 20000);
    if (!turnsOk) return json(res, 400, { error: 'history must be at most 20 {role: "user"|"assistant", text} turns' });
    const custom = (parsed as { source?: unknown }).source !== undefined;
    const t = custom ? null : findTarget(targetId);
    if (!custom && !t) return json(res, 404, { error: 'unknown target' });
    const { name: cname, source: csrc } = parsed as { name?: unknown; source?: unknown };
    if (custom) { const bad = badSource(cname, csrc); if (bad) return json(res, 400, { error: bad }); }
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (overBudget(ip)) return json(res, 429, { error: 'This public studio allows a few agent investigations per hour per visitor. The scan button still works, or run Elenchos locally with your own key.' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    const title = custom ? (cname as string) : t!.title;
    const run = (path: string, original: string) => investigate({ targetPath: path, originalSource: original, history: history as { role: 'user' | 'assistant'; text: string }[], prompt: prompt || `Investigate ${title}. Find every hole, forge a proof to show the impact, read the real verifier, then propose and verify a fix.`, signal: ac.signal }, send);
    try {
      if (custom) await withWorkspace(cname as string, csrc as string, (path) => run(path, csrc as string));
      else await run(t!.path, source(t!));
    } catch (e) { send({ type: 'error', message: String((e as Error).message ?? e).slice(0, 400) }); }
    res.end();
    return;
  }
  // static web
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { error: 'not found' });
  let p: string;
  try { p = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); } catch { return json(res, 400, { error: 'bad path' }); }
  const file = resolve(WEB, `.${p}`);
  if (!file.startsWith(WEB + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  const ext = file.split('.').pop() ?? '';
  const ct = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2', woff: 'font/woff' }[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct }); res.end(readFileSync(file));
}
server.listen(PORT, () => console.log(`Elenchos on http://localhost:${PORT}`));
