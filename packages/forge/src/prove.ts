// Real Groth16 proofs for the two demo circuits (built by scripts/build-circuits.sh into ../../build).
// Proofs are generated with snarkjs and verified locally before anything is sent anywhere.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error snarkjs ships no types
import * as snarkjs from 'snarkjs';

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));
export type Circuit = 'claim' | 'attacker' | 'audit';
export type Groth16Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string };
export type ProofResult = { circuit: Circuit; proof: Groth16Proof; publicSignals: string[]; vk: unknown; ms: number; verifiedLocally: boolean };

const artifact = (c: Circuit) => ({
  wasm: `${BUILD}${c}_js/${c}.wasm`,
  zkey: `${BUILD}${c}.zkey`,
  vk: JSON.parse(readFileSync(`${BUILD}${c}_vk.json`, 'utf8')),
});

async function prove(circuit: Circuit, input: Record<string, string>): Promise<ProofResult> {
  const a = artifact(circuit);
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, a.wasm, a.zkey);
  const ms = Math.round(performance.now() - t0);
  const verifiedLocally = await snarkjs.groth16.verify(a.vk, publicSignals, proof);
  if (!verifiedLocally) throw new Error(`${circuit} proof failed local verification`);
  return { circuit, proof, publicSignals, vk: a.vk, ms, verifiedLocally };
}

/** The honest claim: knows `secret`, mints `amount` (≤ 1,000) to `recipient`. Nullifier = Poseidon(secret). */
export async function proveClaim(recipient: bigint, amount: bigint, secret: bigint, nullifier: bigint) {
  return prove('claim', { recipient: recipient.toString(), amount: amount.toString(), nullifier: nullifier.toString(), secret: secret.toString() });
}

/** The forged claim: a valid proof of the attacker circuit with any recipient, amount and nullifier. */
export async function proveForgery(recipient: bigint, amount: bigint, nullifier: bigint) {
  return prove('attacker', { recipient: recipient.toString(), amount: amount.toString(), nullifier: nullifier.toString() });
}

/** Proof of audit: the report digest (two 128-bit halves of its sha256) and verdict, from the holder of `secret`. */
export async function proveAudit(digestHex: string, verdict: number, secret: bigint, auditor: bigint) {
  const d = BigInt(`0x${digestHex}`);
  return prove('audit', { digestHi: (d >> 128n).toString(), digestLo: (d & ((1n << 128n) - 1n)).toString(), verdict: String(verdict), auditor: auditor.toString(), secret: secret.toString() });
}

/** The claim nullifier: Poseidon(secret), the same hash the circuit enforces. */
export async function poseidon1(secret: bigint): Promise<bigint> {
  // @ts-expect-error circomlibjs ships no types
  const { buildPoseidon } = await import('circomlibjs');
  const p = await buildPoseidon();
  return p.F.toObject(p([secret])) as bigint;
}

/** snarkjs keeps its bn128 worker threads alive after proving; call this when a process is done with proofs. */
export async function shutdownProver(): Promise<void> {
  const g = globalThis as { curve_bn128?: { terminate(): Promise<void> } };
  if (g.curve_bn128) await g.curve_bn128.terminate();
}
