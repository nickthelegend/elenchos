// Elenchos local server: serves the case-room UI, lists targets, and streams an investigation over SSE.
// Run: ANTHROPIC_API_KEY=... node --experimental-strip-types src/server.ts   (reads elenchos/.env if present)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { investigate } from './agent.ts';
import { TARGETS, findTarget, source } from './targets.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
try { if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`); } catch {}
const WEB = resolve(fileURLToPath(new URL('../../web/dist/', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8787);
const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };

const MAX_BODY = 16 * 1024;
class TooLarge extends Error {}
const readBody = (req: any) => new Promise<string>((ok, fail) => {
  let d = ''; let over = Number(req.headers['content-length'] ?? 0) > MAX_BODY;
  req.on('data', (c: Buffer) => { if (!over) { d += c; over = d.length > MAX_BODY; } });
  req.on('end', () => (over ? fail(new TooLarge()) : ok(d))); req.on('error', fail);
});

const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error('request failed:', String(e).slice(0, 200));
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    else res.end();
  });
});

async function route(req: any, res: any) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/targets') {
    return json(res, 200, { targets: TARGETS.map((t) => ({ id: t.id, title: t.title, language: t.language, blurb: t.blurb, source: source(t) })),
      ready: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY), rpc: true /* built-in public read-only node; override with SEPOLIA_RPC_URL */, kurier: Boolean(process.env.KURIER_API_KEY) } });
  }
  if (req.method === 'POST' && url.pathname === '/api/investigate') {
    let parsed: { targetId?: unknown; prompt?: unknown };
    try { parsed = JSON.parse((await readBody(req)) || '{}'); }
    catch (e) { return e instanceof TooLarge ? json(res, 413, { error: `request body over ${MAX_BODY} bytes` }) : json(res, 400, { error: 'request body must be JSON: {"targetId": "...", "prompt": "..."}' }); }
    if (!parsed || typeof parsed !== 'object') return json(res, 400, { error: 'request body must be a JSON object' });
    const { targetId, prompt, history = [] } = parsed as { targetId?: string; prompt?: string; history?: unknown };
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 4000)) return json(res, 400, { error: 'prompt must be a string of at most 4000 characters' });
    const turnsOk = Array.isArray(history) && history.length <= 20 && history.every((h) =>
      h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.length <= 8000);
    if (!turnsOk) return json(res, 400, { error: 'history must be at most 20 {role: "user"|"assistant", text} turns' });
    const t = findTarget(targetId);
    if (!t) return json(res, 404, { error: 'unknown target' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    await investigate({ targetPath: t.path, originalSource: source(t), history: history as { role: 'user' | 'assistant'; text: string }[], prompt: prompt || `Investigate ${t.title}. Find every hole, forge a proof to show the impact, read the real verifier, then propose and verify a fix.`, signal: ac.signal }, send);
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
  const ct = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json' }[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct }); res.end(readFileSync(file));
}
server.listen(PORT, () => console.log(`Elenchos on http://localhost:${PORT}`));
