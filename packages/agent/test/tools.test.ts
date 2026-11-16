// Tests for the agent's tools: real scan, real local forgery proof, real zkVerify node (vk_hash), real Sepolia verifier
// read, real patch verification. No API key needed; the network calls are keyless reads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { scanTool, forgeTool, patchTool, replayTool, shutdownProver } from '../src/tools.ts';
import { TARGETS, source } from '../src/targets.ts';

after(async () => { await shutdownProver().catch(() => {}); });
const vuln = TARGETS.find((t) => t.id === 'vulnerable-mint')!;

test('scan tool returns the critical E1 finding on VulnerableMint', async () => {
  const { findings, event } = await scanTool(vuln.path);
  assert.ok(findings.some((f) => f.rule === 'E1' && f.severity === 'critical'));
  assert.equal(event.tool, 'scan');
  assert.match(event.summary, /critical/);
});

let forgedLeaf: `0x${string}`;
test('forge tool produces a real, locally-verified Groth16 proof and its real zkVerify leaf', async () => {
  const { event, leaf } = await forgeTool(0xA11cEn, 1_000_000n);
  assert.equal(event.status, 'ok', event.summary);
  assert.equal((event.detail as any).verifiedLocally, true);
  assert.match((event.detail as any).attackerVkHash, /^0x[0-9a-f]{64}$/);
  assert.match(leaf!, /^0x[0-9a-f]{64}$/);
  assert.match(event.summary, /forged a valid proof minting 1000000/);
  forgedLeaf = leaf!;
});

test('replay asks the real Sepolia verifier about the forged leaf in a real aggregation: not accepted', async () => {
  const { event } = await replayTool(forgedLeaf);
  assert.equal(event.status, 'ok', event.summary);
  const d = event.detail as any;
  assert.equal(d.accepted, false);
  assert.ok(d.aggregationId >= 270047, `aggregation ${d.aggregationId}`);
  assert.match(d.aggregationRoot, /^0x[0-9a-f]{64}$/);
  assert.equal(d.leaf, forgedLeaf);
});

test('patch tool verifies a pinned fix and rejects a cosmetic one', async () => {
  const good = source(vuln)
    .replace('constructor(address zkVerify_) {', 'bytes32 public immutable vkHash; uint256 public immutable domainId; mapping(bytes32 => bool) public consumed;\n    constructor(address zkVerify_, bytes32 vk_, uint256 d_) { vkHash = vk_; domainId = d_;')
    .replace('bytes32 vkHash,\n        uint256 domainId,\n        ', '')
    .replace('bytes32 leaf = ZkVerifyStatement.groth16(vkHash, inputs);',
             'bytes32 leaf = ZkVerifyStatement.groth16(vkHash, inputs);\n        require(!consumed[leaf], "replayed"); consumed[leaf] = true;');
  const ok = await patchTool(vuln.path, good);
  assert.equal(ok.event.status, 'ok', ok.event.summary);
  assert.equal(ok.result.verified, true, ok.result.reason);

  const bad = await patchTool(vuln.path, source(vuln).replace(/amount/g, 'amt'));
  assert.equal(bad.result.verified, false);
});

test('replay tool reports Setup required without an RPC', async () => {
  const saved = process.env.SEPOLIA_RPC_URL; process.env.SEPOLIA_RPC_URL = '';
  const { event } = await replayTool('0x' + '11'.repeat(32) as `0x${string}`);
  assert.equal(event.status, 'setup');
  if (saved === undefined) delete process.env.SEPOLIA_RPC_URL; else process.env.SEPOLIA_RPC_URL = saved;
});
