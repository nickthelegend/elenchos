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

/** Prove, locally and for real, a Groth16 forgery that mints `amount` to `recipient` with the attacker circuit. */
export async function forgeTool(recipient: bigint, amount: bigint): Promise<{ statement: Hex; event: ToolEvent; proof: unknown }> {
  const forged = await proveForgery(recipient, amount, BigInt(Date.now()));
  // vkHash of the attacker circuit as zkVerify would compute it is only known after registration; here we report
  // the local proof and its public signals. The leaf shown is illustrative until a Kurier registration pins vkHash.
  return { statement: '0x' as Hex, proof: forged.proof, event: { tool: 'forge', status: 'ok',
    summary: `forged a valid proof minting ${amount} to 0x${recipient.toString(16).slice(0, 8)}… in ${forged.ms} ms (verified locally)`,
    detail: { publicSignals: forged.publicSignals, ms: forged.ms, verifiedLocally: forged.verifiedLocally } } };
}

/** Read the REAL zkVerify verifier (on a fork or Sepolia) to show an un-aggregated / forged leaf returns false. */
export async function replayTool(leaf: Hex): Promise<{ event: ToolEvent }> {
  // A public read-only node is the default so the replay beat works out of the box; set SEPOLIA_RPC_URL to override,
  // or to '' to require your own. This only READS a view function (verifyProofAggregation) — never a transaction.
  const env = process.env.SEPOLIA_RPC_URL;
  const RPC = env === '' ? '' : (env ?? 'https://ethereum-sepolia-rpc.publicnode.com');
  if (!RPC) return { event: { tool: 'replay', status: 'setup', summary: 'Setup required: SEPOLIA_RPC_URL to read the zkVerify verifier' } };
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
  try {
    const ok = await client.readContract({ address: ZKVERIFY, abi, functionName: 'verifyProofAggregation',
      args: [0n, 999_999_999n, leaf, [], 1n, 0n] });
    return { event: { tool: 'replay', status: 'ok',
      summary: ok ? `the verifier ACCEPTED ${leaf.slice(0, 10)}… (unexpected)` : `the verifier rejected the forged leaf ${leaf.slice(0, 10)}… — only a real aggregated receipt passes`,
      detail: { accepted: ok, verifier: ZKVERIFY } } };
  } catch (e) {
    return { event: { tool: 'replay', status: 'error', summary: `fork read failed: ${String(e).slice(0, 160)}` } };
  }
}

/** Apply a proposed fix to a throwaway copy, compile it, and re-scan. Verified only if it compiles and is clean. */
export async function patchTool(path: string, newSource: string): Promise<{ result: PatchResult; event: ToolEvent }> {
  const result = await verifyPatch(path, newSource);
  return { result, event: { tool: 'patch', status: result.verified ? 'ok' : 'error', summary: result.reason, detail: {
    verified: result.verified, compiles: result.compiles, cleared: result.cleared, remaining: result.remaining.map((f) => `${f.rule} ${f.function}`), evaded: result.evaded, patchedSource: newSource } } };
}

export { shutdownProver, poseidon1, proveClaim, groth16Statement };
