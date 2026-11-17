// The MCP endpoint's protocol surface (tool calls go to the same /api routes the other tests cover).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../src/mcp.ts';

test('initialize, tools/list, notifications and unknown methods', async () => {
  const init = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, 0, '') as any;
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'elenchos');
  assert.equal(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, 0, ''), null);
  const list = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 0, '') as any;
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name).sort(),
    ['ask_zkverify', 'audit_contract', 'audit_deployed_contract', 'audit_github_repo', 'create_report', 'forge_proof', 'run_exploit_test', 'verify_fix']);
  assert.ok(list.result.tools.every((t: { inputSchema: { type: string }; path?: string }) => t.inputSchema.type === 'object' && !t.path));
  const nope = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, 0, '') as any;
  assert.equal(nope.error.code, -32601);
  const bad = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }, 0, '') as any;
  assert.equal(bad.result.isError, true);
});
