// The agent's tools. Each one does real work — scan with Slither, prove a forgery with snarkjs, read the live
// zkVerify verifier on a fork, verify a patch by compiling and re-scanning. Nothing here fabricates a result; a
// tool that cannot run (missing RPC, missing Kurier key) returns a "Setup required" status, never a fake success.
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { scan as coreScan, bySeverity, type Finding } from '@elenchos/core/src/scan.ts';
import { verifyPatch, type PatchResult } from '@elenchos/core/src/patch.ts';
import { proveForgery, poseidon1, proveClaim, shutdownProver } from '@elenchos/forge/src/prove.ts';
import { groth16Statement } from '@elenchos/forge/src/statement.ts';
import { zkVerifyVkHash } from '@elenchos/forge/src/vkhash.ts';

export type ToolEvent = { tool: string; status: 'running' | 'ok' | 'setup' | 'error'; summary: string; detail?: unknown };

const ZKVERIFY = (process.env.ZKVERIFY_SEPOLIA ?? '0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E') as Hex;
const abi = parseAbi(['function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns (bool)']);

/** E1/E3/E4/E6 scan of one .sol file or a project. */
export async function scanTool(path: string): Promise<{ findings: Finding[]; event: ToolEvent }> {
  const findings = bySeverity(await coreScan(path));
  const crit = findings.filter((f) => f.severity === 'critical').length;
  return { findings, event: { tool: 'scan', status: findings.length ? 'ok' : 'ok',
    summary: findings.length ? `${findings.length} finding(s), ${crit} critical` : 'no findings', detail: findings } };
}

/** Prove, locally and for real, a Groth16 forgery that mints `amount` to `recipient` with the attacker circuit, then
 *  compute the exact leaf zkVerify would aggregate for it: the attacker key's hash comes from a real zkVerify node. */
export async function forgeTool(recipient: bigint, amount: bigint): Promise<{ leaf: Hex | null; event: ToolEvent; proof: unknown }> {
  const forged = await proveForgery(recipient, amount, BigInt(Date.now()));
  const base = { publicSignals: forged.publicSignals, ms: forged.ms, verifiedLocally: forged.verifiedLocally };
  const who = `0x${recipient.toString(16).slice(0, 8)}…`;
  try {
    const vkHash = await zkVerifyVkHash(forged.vk);
    const leaf = groth16Statement(vkHash, forged.publicSignals.map(BigInt));
    return { leaf, proof: forged.proof, event: { tool: 'forge', status: 'ok',
      summary: `forged a valid proof minting ${amount} to ${who} in ${forged.ms} ms (verified locally); its zkVerify leaf is ${leaf.slice(0, 10)}…`,
      detail: { ...base, attackerVkHash: vkHash, leaf } } };
  } catch (e) {
    return { leaf: null, proof: forged.proof, event: { tool: 'forge', status: 'error',
      summary: `forged a valid proof minting ${amount} to ${who} (verified locally), but could not get its zkVerify leaf: ${String(e).slice(0, 140)}`, detail: base } };
  }
}

const RECEIPT_EVENT = '0x431e1446261f5ed64f6fcd5c8a75fe76dcc7c2c207555eeb6cf27749e78ca226'; // the verifier's new-aggregation event

/** The most recent real aggregation posted to zkVerify's Sepolia verifier, read from its own events. */
async function latestAggregation(client: ReturnType<typeof createPublicClient>) {
  // Public nodes are load-balanced: the backend answering getLogs can trail the one that reported the head, and it
  // refuses a range that reaches past its own tip. Stay 32 blocks behind, and retry a chunk once if it still fails.
  const head = (await client.getBlockNumber()) - 32n;
  const chunk = async (from: bigint, to: bigint) => {
    try { return await client.getLogs({ address: ZKVERIFY, fromBlock: from, toBlock: to } as never); }
    catch { await new Promise((r) => setTimeout(r, 400)); return client.getLogs({ address: ZKVERIFY, fromBlock: from, toBlock: to } as never); }
  };
  for (let to = head; to > head - 200_000n; to -= 10_000n) {
    const logs = await chunk(to - 9_999n, to) as unknown as { topics: Hex[]; blockNumber: bigint }[];
    const hits = logs.filter((l) => l.topics[0] === RECEIPT_EVENT);
    if (hits.length) { const l = hits[hits.length - 1]; return { domainId: BigInt(l.topics[1]), aggregationId: BigInt(l.topics[2]), root: l.topics[3], block: l.blockNumber }; }
  }
  throw new Error('no aggregation found on the verifier in the last 200,000 blocks');
}

/** Ask the REAL zkVerify verifier on Sepolia whether the forged leaf belongs to its latest real aggregation. */
export async function replayTool(leaf: Hex): Promise<{ event: ToolEvent }> {
  // A public read-only node is the default; set SEPOLIA_RPC_URL to override, or to '' to require your own. This only
  // reads (getLogs + the verifyProofAggregation view), never sends a transaction.
  const env = process.env.SEPOLIA_RPC_URL;
  const RPC = env === '' ? '' : (env ?? 'https://ethereum-sepolia-rpc.publicnode.com');
  if (!RPC) return { event: { tool: 'replay', status: 'setup', summary: 'Setup required: SEPOLIA_RPC_URL to read the zkVerify verifier' } };
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
  try {
    const agg = await latestAggregation(client);
    const ok = await client.readContract({ address: ZKVERIFY, abi, functionName: 'verifyProofAggregation',
      args: [agg.domainId, agg.aggregationId, leaf, [], 1n, 0n] });
    return { event: { tool: 'replay', status: 'ok',
      summary: ok ? `the verifier ACCEPTED ${leaf.slice(0, 10)}… in aggregation ${agg.aggregationId} (unexpected)`
        : `zkVerify's verifier says no: the forged leaf ${leaf.slice(0, 10)}… is not in real aggregation #${agg.aggregationId} (domain ${agg.domainId}, block ${agg.block}). zkVerify isn't fooled; only a consumer that trusts the wrong key is.`,
      detail: { accepted: ok, verifier: ZKVERIFY, domainId: Number(agg.domainId), aggregationId: Number(agg.aggregationId), aggregationRoot: agg.root, block: Number(agg.block), leaf } } };
  } catch (e) {
    return { event: { tool: 'replay', status: 'error', summary: `verifier read failed: ${String(e).slice(0, 160)}` } };
  }
}

/** Apply a proposed fix to a throwaway copy, compile it, and re-scan. Verified only if it compiles and is clean. */
export async function patchTool(path: string, newSource: string): Promise<{ result: PatchResult; event: ToolEvent }> {
  const result = await verifyPatch(path, newSource);
  return { result, event: { tool: 'patch', status: result.verified ? 'ok' : 'error', summary: result.reason, detail: {
    verified: result.verified, compiles: result.compiles, cleared: result.cleared, remaining: result.remaining.map((f) => `${f.rule} ${f.function}`), evaded: result.evaded, patchedSource: newSource } } };
}

export { shutdownProver, poseidon1, proveClaim, groth16Statement };
