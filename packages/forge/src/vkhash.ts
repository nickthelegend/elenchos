// The zkVerify hash of a Groth16 verification key, computed by a real zkVerify node (vk_hash_groth16 RPC), the same
// value zkVerify uses inside every aggregation leaf. Checked against the two keys the Agent Games organisers
// registered on zkVerify mainnet (gatekeeper 0x6b79…77b0, vfy-policy 0x6c56…e047) — see test/vkhash.test.ts.
// Read-only and keyless. Fails loudly if the node can't be reached; nothing is computed locally as a stand-in.
import type { Hex } from 'viem';

export const ZKVERIFY_RPC = process.env.ZKVERIFY_RPC ?? 'https://zkverify-rpc.zkverify.io';

// snarkjs points are decimal strings; zkVerify wants each BN254 coordinate as 32 little-endian bytes.
const FQ = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
const le = (v: string | bigint) => {
  const n = BigInt(v);
  if (n < 0n || n >= FQ) throw new Error(`not a BN254 base-field element: ${String(v).slice(0, 20)}…`);
  return n.toString(16).padStart(64, '0').match(/../g)!.reverse().join('');
};
const g1 = (p: string[]) => `0x${le(p[0])}${le(p[1])}`;
const g2 = (p: string[][]) => `0x${le(p[0][0])}${le(p[0][1])}${le(p[1][0])}${le(p[1][1])}`;

type SnarkjsVk = { curve?: string; vk_alpha_1: string[]; vk_beta_2: string[][]; vk_gamma_2: string[][]; vk_delta_2: string[][]; IC: string[][] };

export function zkVerifyVk(vk: SnarkjsVk) {
  if (vk.curve && !/^bn(128|254)$/i.test(vk.curve)) throw new Error(`only BN254 Groth16 keys are supported, got ${vk.curve}`);
  if (!Array.isArray(vk.IC) || vk.IC.length < 1) throw new Error('verification key has no IC points');
  return { curve: 'Bn254', alphaG1: g1(vk.vk_alpha_1), betaG2: g2(vk.vk_beta_2), gammaG2: g2(vk.vk_gamma_2), deltaG2: g2(vk.vk_delta_2), gammaAbcG1: vk.IC.map(g1) };
}

export async function zkVerifyVkHash(vk: unknown, rpc = ZKVERIFY_RPC): Promise<Hex> {
  const r = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'vk_hash_groth16', params: [zkVerifyVk(vk as SnarkjsVk)] }),
  });
  if (!r.ok) throw new Error(`zkVerify node ${rpc} answered HTTP ${r.status}`);
  const j = (await r.json()) as { result?: string; error?: { message: string; data?: string } };
  if (!j.result || !/^0x[0-9a-f]{64}$/i.test(j.result)) throw new Error(`zkVerify vk_hash failed: ${j.error?.message ?? 'no result'} ${j.error?.data ?? ''}`.trim());
  return j.result as Hex;
}
