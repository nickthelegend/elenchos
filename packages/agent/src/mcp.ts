// Elenchos as an MCP server (Streamable HTTP, stateless, JSON responses) at POST /mcp. Any MCP client (Claude Code,
// Cursor, Claude's MCP connector) can audit a contract, run the exploit test, verify a fix and get a report link from
// inside the developer's own agent. Each tool calls the same /api endpoints the studio uses, over loopback, so the
// validation, workspaces, limits and real tools are identical. No model runs here: every tool is deterministic.
const TOOLS = [
  { name: 'audit_contract', description: 'Audit one Solidity contract that consumes zkVerify receipts. Runs Slither plus the five Elenchos detectors (E1 vk from caller, E1b leaf from caller, E3 replay, E4 value without a receipt, E6 domain from caller) in a throwaway Foundry workspace. Imports of ../interfaces/IVerifyProofAggregation.sol and forge-std resolve.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'file name, e.g. MyMint.sol' }, source: { type: 'string', description: 'full Solidity source' } }, required: ['name', 'source'] }, path: '/api/scan' },
  { name: 'run_exploit_test', description: 'Run a real Foundry exploit test against the contract on a local EVM, with a real forged Groth16 proof (attacker circuit; vk hash from a zkVerify node). Each test_attack_* asserts the attacker got paid: worked = exploitable, reverted = blocked. Uses a stock test for known claim shapes, or pass your own `test` (see the studio docs for the harness).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string' }, test: { type: 'string', description: 'optional custom exploit test; import the target from "TARGET"' } }, required: ['name', 'source'] }, path: '/api/attack' },
  { name: 'verify_fix', description: 'Verify a fix deterministically: compiles the patched file, re-scans it, and rejects fixes that only hide findings (deleting or renaming the function, removing the receipt check).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, original: { type: 'string' }, patched: { type: 'string' } }, required: ['name', 'original', 'patched'] }, path: '/api/verify' },
  { name: 'audit_github_repo', description: 'Clone a public GitHub repository (owner/repo, optionally /tree/<branch>/<folder>) with its submodules, and audit every contract with imports resolved.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, path: '/api/project/connect' },
  { name: 'audit_deployed_contract', description: 'Load a deployed contract\'s verified source (Sourcify, then Blockscout) with its exact compiler and audit it. Chains: ethereum, sepolia, base, base-sepolia, arbitrum, arbitrum-sepolia, optimism, optimism-sepolia, polygon, gnosis.',
    inputSchema: { type: 'object', properties: { chain: { type: 'string' }, address: { type: 'string' } }, required: ['chain', 'address'] }, path: '/api/address/connect' },
  { name: 'forge_proof', description: 'Make a real Groth16 proof with an attacker circuit that mints 1,000,000, verified locally, and compute the exact leaf zkVerify would aggregate for it. Shows what an E1 hole lets through.',
    inputSchema: { type: 'object', properties: {} }, path: '/api/forge' },
  { name: 'ask_zkverify', description: 'Ask zkVerify\'s real aggregation verifier on Ethereum Sepolia whether a leaf belongs to its latest real aggregation (read-only).',
    inputSchema: { type: 'object', properties: { leaf: { type: 'string', description: '0x + 64 hex, from forge_proof' } }, required: ['leaf'] }, path: '/api/replay' },
  { name: 'create_report', description: 'Create a shareable report: the server re-runs the audit, the exploit test and (with `patched`) the fix check plus the same exploit test against the fix. Returns a link and a README badge.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string' }, patched: { type: 'string' } }, required: ['name', 'source'] }, path: '/api/report' },
] as const;

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
const SITE = process.env.ELENCHOS_SITE ?? 'https://elenchos-studio.vercel.app/';

async function callApi(port: number, path: string, body: unknown, ip: string): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({ error: `HTTP ${r.status}` })) };
}

async function callTool(port: number, name: string, args: any, ip: string): Promise<{ text: string; isError: boolean }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { text: `Unknown tool ${name}.`, isError: true };
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'audit_github_repo' || name === 'audit_deployed_contract') {
    const c = await callApi(port, t.path, a, ip);
    if (!c.ok) return { text: c.data.error, isError: true };
    const s = await callApi(port, '/api/project/scan', { projectId: c.data.id }, ip);
    if (!s.ok) return { text: `Loaded ${c.data.repo} (${c.data.files.length} contracts) but the audit failed: ${s.data.error}`, isError: true };
    return { text: JSON.stringify({ project: c.data.repo, deps: c.data.deps, implementation: c.data.implementation ?? undefined, contracts: c.data.files.map((f: { path: string }) => f.path), findings: s.data.findings, ms: s.data.ms }, null, 1), isError: false };
  }
  const c = await callApi(port, t.path, a, ip);
  if (!c.ok) return { text: c.data.error ?? 'request failed', isError: true };
  if (name === 'create_report') return { text: JSON.stringify({ report: `${SITE}#/r/${c.data.id}`, badge: `${process.env.ELENCHOS_PUBLIC_API ?? ''}/api/badge/${c.data.id}.svg`, ms: c.data.ms }), isError: false };
  if (name === 'run_exploit_test') { const { testSource, ...rest } = c.data; return { text: JSON.stringify(rest, null, 1), isError: false }; }
  return { text: JSON.stringify(c.data, null, 1), isError: false };
}

/** Handle one JSON-RPC message (or batch). Returns the response body, or null for notifications. */
export async function handleMcp(raw: unknown, port: number, ip: string): Promise<unknown | null> {
  if (Array.isArray(raw)) { const out = (await Promise.all(raw.map((m) => handleMcp(m, port, ip)))).filter((x) => x !== null); return out.length ? out : null; }
  const m = raw as Rpc;
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id ?? null, result });
  if (m.id === undefined) return null; // notifications (initialized, cancelled) need no answer
  switch (m.method) {
    case 'initialize':
      return ok({ protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18', capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'elenchos', title: 'Elenchos', version: '0.2.0' },
        instructions: 'Elenchos audits Solidity contracts that consume zkVerify aggregation receipts. Typical flow: audit_contract, then run_exploit_test to prove impact, write a fix, verify_fix, run_exploit_test on the fix, then create_report. All tools are deterministic; nothing is sent on-chain.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ path: _p, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: t.name.startsWith('audit_') || t.name === 'ask_zkverify' } })) });
    case 'tools/call': {
      try { const r = await callTool(port, m.params?.name, m.params?.arguments, ip); return ok({ content: [{ type: 'text', text: r.text }], isError: r.isError }); }
      catch (e) { return ok({ content: [{ type: 'text', text: `Elenchos failed: ${String((e as Error).message ?? e).slice(0, 300)}` }], isError: true }); }
    }
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } };
  }
}
