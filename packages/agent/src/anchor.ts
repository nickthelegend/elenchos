// Proof of audit. Each report is anchored on zkVerify: the server proves, with the audit circuit, "the Elenchos auditor
// published a report whose canonical JSON has this sha256, with this verdict", submits the proof to zkVerify through
// Kurier with Ethereum Sepolia as the destination, and stores the aggregation receipt in the report. Anyone can then
// recompute the report's sha256, rebuild the statement leaf and ask zkVerify's verifier contract on Sepolia whether the
// leaf is in that aggregation. Without KURIER_API_KEY and ELENCHOS_AUDITOR_SECRET this says "Setup required"; it never
// stores a receipt it did not get from zkVerify.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, fallback, http, parseAbi, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { registerVk, submitProof, waitForAggregation } from '@elenchos/forge/src/kurier.ts';
import { poseidon1, proveAudit, shutdownProver } from '@elenchos/forge/src/prove.ts';
import { groth16Statement } from '@elenchos/forge/src/statement.ts';
import { getReport, sha256, writeReport, type Report } from './report.ts';

export type Anchor = {
  status: 'proving' | 'submitted' | 'aggregated' | 'failed';
  digest: string; verdict: number; verdictLabel: string; auditor: string; vkHash: string | null; inputs: string[];
  leaf: string | null; jobId: string | null; txHash: string | null; statuses: { status: string; at: string }[];
  aggregationId: number | null; domainId: number | null; merklePath: string[]; leafCount: number | null; index: number | null;
  verifier: string; chain: 'sepolia'; error: string | null; startedAt: string; aggregatedAt: string | null;
};

export const VERDICTS = ['no holes found', 'findings', 'exploit proven', 'fix verified'] as const;
const ZKVERIFY = (process.env.ZKVERIFY_SEPOLIA ?? '0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E') as Hex;
const abi = parseAbi(['function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns (bool)']);
const RPCS = process.env.SEPOLIA_RPC_URL ? [process.env.SEPOLIA_RPC_URL] : ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://0xrpc.io/sep'];
const client = () => createPublicClient({ chain: sepolia, transport: fallback(RPCS.map((u) => http(u, { retryCount: 1 }))) });
const DATA = () => process.env.ELENCHOS_DATA ?? join(process.cwd(), '.data');

/** The exact bytes whose sha256 is anchored: the stored report without its anchor. */
export function canonical(r: Report): string { const { anchor: _a, ...rest } = r; return JSON.stringify(rest); }

export function verdictOf(r: Report): number {
  if (r.fix?.verified && r.fix.attack?.status !== 'exploitable') return 3;
  if (r.attack?.status === 'exploitable') return 2;
  return r.findings.length ? 1 : 0;
}

export function anchorReady(): string | null {
  if (!process.env.KURIER_API_KEY) return 'Setup required: KURIER_API_KEY (zkVerify Kurier testnet key) on the server';
  if (!/^[0-9]{20,}$/.test(process.env.ELENCHOS_AUDITOR_SECRET ?? '')) return 'Setup required: ELENCHOS_AUDITOR_SECRET (a large random integer) on the server';
  return null;
}

let auditorId: bigint | null = null;
export async function auditor(): Promise<string | null> {
  if (anchorReady()) return null;
  auditorId ??= await poseidon1(BigInt(process.env.ELENCHOS_AUDITOR_SECRET!));
  return `0x${auditorId.toString(16).padStart(64, '0')}`;
}

/** zkVerify's hash for the audit circuit's key, registered once per server and cached in the data folder. */
async function auditVkHash(vk: unknown): Promise<string> {
  const f = join(DATA(), 'audit-vkhash.json');
  const vkSha = sha256(JSON.stringify(vk));
  if (existsSync(f)) { const c = JSON.parse(readFileSync(f, 'utf8')); if (c.vkSha === vkSha) return c.vkHash; }
  const vkHash = await registerVk(vk);
  await mkdir(DATA(), { recursive: true });
  await writeFile(f, JSON.stringify({ vkSha, vkHash }));
  return vkHash;
}

async function save(id: string, patch: Partial<Anchor>) {
  const r = getReport(id); if (!r?.anchor) return;
  r.anchor = { ...r.anchor, ...patch };
  await writeReport(r);
}

async function domainFor(aggregationId: number, leaf: Hex, path: Hex[], count: number, index: number, hint?: number): Promise<number | null> {
  for (const d of [...new Set([hint, 0, 1, 2].filter((x): x is number => x !== undefined))]) {
    const ok = await client().readContract({ address: ZKVERIFY, abi, functionName: 'verifyProofAggregation', args: [BigInt(d), BigInt(aggregationId), leaf, path, BigInt(count), BigInt(index)] });
    if (ok) return d;
  }
  return null;
}

const running = new Set<string>();
/** Start anchoring a report (no-op if it is anchored or anchoring). Returns the anchor as first stored. */
export async function startAnchor(id: string): Promise<Anchor> {
  const r = getReport(id);
  if (!r) throw new Error('No report with that id on this server.');
  if (r.anchor && r.anchor.status !== 'failed') return r.anchor;
  const setup = anchorReady(); if (setup) throw new Error(setup);
  const digest = sha256(canonical(r)); const verdict = verdictOf(r);
  r.anchor = { status: 'proving', digest, verdict, verdictLabel: VERDICTS[verdict], auditor: (await auditor())!, vkHash: null, inputs: [], leaf: null,
    jobId: null, txHash: null, statuses: [], aggregationId: null, domainId: null, merklePath: [], leafCount: null, index: null,
    verifier: ZKVERIFY, chain: 'sepolia', error: null, startedAt: new Date().toISOString(), aggregatedAt: null };
  await writeReport(r);
  void run(id);
  return r.anchor;
}

async function run(id: string) {
  if (running.has(id)) return; running.add(id);
  try {
    let a = getReport(id)!.anchor!;
    if (!a.jobId) {
      const p = await proveAudit(a.digest, a.verdict, BigInt(process.env.ELENCHOS_AUDITOR_SECRET!), BigInt(a.auditor));
      await shutdownProver();
      const vkHash = await auditVkHash(p.vk);
      const leaf = groth16Statement(vkHash as Hex, p.publicSignals.map(BigInt));
      const jobId = await submitProof(p.proof, p.publicSignals, vkHash);
      await save(id, { status: 'submitted', vkHash, inputs: p.publicSignals, leaf, jobId });
      a = getReport(id)!.anchor!;
    }
    const rec = await waitForAggregation(a.jobId!, (s) => { a.statuses.push({ status: s, at: new Date().toISOString() }); void save(id, { statuses: a.statuses }); }, 40 * 60_000);
    if (rec.leaf && rec.leaf.toLowerCase() !== a.leaf!.toLowerCase()) throw new Error(`zkVerify's leaf ${rec.leaf} differs from the statement Elenchos computed ${a.leaf}`);
    // The aggregation reaches Sepolia shortly after zkVerify reports it; wait until the verifier contract agrees.
    let domainId: number | null = null;
    for (let i = 0; i < 60 && domainId === null; i++) {
      domainId = await domainFor(rec.aggregationId, a.leaf as Hex, rec.merkleProof, rec.numberOfLeaves, rec.leafIndex, rec.domainId).catch(() => null);
      if (domainId === null) await new Promise((ok) => setTimeout(ok, 20_000));
    }
    if (domainId === null) throw new Error(`aggregation ${rec.aggregationId} is not readable on zkVerify's Sepolia verifier after 20 minutes`);
    await save(id, { status: 'aggregated', txHash: rec.txHash ?? null, aggregationId: rec.aggregationId, domainId, merklePath: rec.merkleProof,
      leafCount: rec.numberOfLeaves, index: rec.leafIndex, aggregatedAt: new Date().toISOString() });
  } catch (e) {
    await save(id, { status: 'failed', error: String((e as Error).message ?? e).slice(0, 400) });
  } finally { running.delete(id); }
}

/** Resume anchors a restart interrupted. */
export function resumeAnchors() {
  if (anchorReady()) return;
  const dir = join(DATA(), 'reports'); if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Report;
    if (r.anchor && (r.anchor.status === 'submitted' || r.anchor.status === 'proving')) void run(r.id);
  }
}

/** Check an anchor from scratch: recompute the digest and the leaf, then ask zkVerify's verifier on Sepolia. */
export async function checkAnchor(id: string) {
  const r = getReport(id); if (!r) throw new Error('No report with that id on this server.');
  const a = r.anchor; if (!a || a.status !== 'aggregated') throw new Error('This report is not anchored yet.');
  const digest = sha256(canonical(r));
  const d = BigInt(`0x${digest}`);
  const inputs = [d >> 128n, d & ((1n << 128n) - 1n), BigInt(verdictOf(r)), BigInt(a.auditor)];
  const leaf = groth16Statement(a.vkHash as Hex, inputs);
  const accepted = await client().readContract({ address: ZKVERIFY, abi, functionName: 'verifyProofAggregation',
    args: [BigInt(a.domainId!), BigInt(a.aggregationId!), leaf, a.merklePath as Hex[], BigInt(a.leafCount!), BigInt(a.index!)] });
  return { accepted, digest, digestMatches: digest === a.digest, leaf, leafMatches: leaf.toLowerCase() === a.leaf?.toLowerCase(),
    verifier: ZKVERIFY, chain: 'sepolia', domainId: a.domainId, aggregationId: a.aggregationId, checkedAt: new Date().toISOString() };
}
