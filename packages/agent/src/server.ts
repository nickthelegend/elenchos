// Elenchos local server: serves the case-room UI, lists targets, and streams an investigation over SSE.
// Run: ANTHROPIC_API_KEY=... node --experimental-strip-types src/server.ts   (reads elenchos/.env if present)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { investigate } from './agent.ts';
import { TARGETS, findTarget, source } from './targets.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
try { if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`); } catch {}
const WEB = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/targets') {
    return json(res, 200, { targets: TARGETS.map((t) => ({ id: t.id, title: t.title, language: t.language, blurb: t.blurb, source: source(t) })),
      ready: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY), rpc: Boolean(process.env.SEPOLIA_RPC_URL), kurier: Boolean(process.env.KURIER_API_KEY) } });
  }
  if (req.method === 'POST' && url.pathname === '/api/investigate') {
    const body = await new Promise<string>((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
    const { targetId, prompt } = JSON.parse(body || '{}');
    const t = findTarget(targetId);
    if (!t) return json(res, 404, { error: 'unknown target' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    await investigate({ targetPath: t.path, originalSource: source(t), prompt: prompt || `Investigate ${t.title}. Find every hole, forge a proof to show the impact, read the real verifier, then propose and verify a fix.`, signal: ac.signal }, send);
    res.end();
    return;
  }
  // static web
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = `${WEB}${p}`.replace(/\.\./g, '');
  if (existsSync(file)) {
    const ext = p.split('.').pop() ?? '';
    const ct = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json' }[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct }); res.end(readFileSync(file)); return;
  }
  json(res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log(`Elenchos on http://localhost:${PORT}`));
