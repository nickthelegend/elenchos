// Kurier (zkVerify's REST relayer) client: register a Groth16 VK, submit a proof with an EVM chainId so it gets
// aggregated, then poll the job until it is Aggregated and return the receipt fields a consumer contract needs.
// Fails loudly when the key is missing: no mocks, no fake receipts.
import type { Groth16Proof } from './prove.ts';

export type AggregationReceipt = {
  jobId: string; txHash?: string; aggregationId: number; domainId?: number;
  leaf: `0x${string}`; leafIndex: number; numberOfLeaves: number; merkleProof: `0x${string}`[]; root?: string;
  statuses: { status: string; at: string }[];
};

const API = process.env.KURIER_API_URL ?? 'https://api-testnet.kurier.xyz/api/v1';
function key(): string {
  const k = process.env.KURIER_API_KEY;
  if (!k) throw new Error('Setup required: KURIER_API_KEY (zkVerify Kurier testnet key from https://testnet.kurier.xyz) in elenchos/.env');
  return k;
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Kurier ${path.split('/')[1]} answered HTTP ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Registers a snarkjs Groth16 VK and returns zkVerify's vkHash for it (the hash that goes into statements). */
export async function registerVk(vk: unknown): Promise<string> {
  const res = await call<{ vkHash?: string; meta?: { vkHash?: string } }>(`/register-vk/${key()}`, {
    method: 'POST',
    body: JSON.stringify({ proofType: 'groth16', proofOptions: { library: 'snarkjs', curve: 'bn128' }, vk }),
  });
  const h = res.vkHash ?? res.meta?.vkHash;
  if (!h) throw new Error(`Kurier register-vk returned no vkHash: ${JSON.stringify(res).slice(0, 200)}`);
  return h;
}

export async function submitProof(proof: Groth16Proof, publicSignals: string[], vkHash: string, chainId = 11155111): Promise<string> {
  const res = await call<{ jobId?: string; optimisticVerify?: string }>(`/submit-proof/${key()}`, {
    method: 'POST',
    body: JSON.stringify({
      proofType: 'groth16', vkRegistered: true, chainId,
      proofOptions: { library: 'snarkjs', curve: 'bn128' },
      proofData: { proof, publicSignals, vk: vkHash },
    }),
  });
  if (!res.jobId) throw new Error(`Kurier submit-proof returned no jobId: ${JSON.stringify(res).slice(0, 200)}`);
  if (res.optimisticVerify && res.optimisticVerify !== 'success') throw new Error(`zkVerify optimistic verification: ${res.optimisticVerify}`);
  return res.jobId;
}

/** Polls until Aggregated (or Failed / timeout). `onStatus` streams every new status for the UI. */
export async function waitForAggregation(jobId: string, onStatus?: (s: string) => void, timeoutMs = 20 * 60_000): Promise<AggregationReceipt> {
  const seen: { status: string; at: string }[] = [];
  const end = Date.now() + timeoutMs;
  for (;;) {
    const j = await call<Record<string, any>>(`/job-status/${key()}/${jobId}`);
    if (!seen.length || seen[seen.length - 1].status !== j.status) {
      seen.push({ status: j.status, at: new Date().toISOString() });
      onStatus?.(j.status);
    }
    if (j.status === 'Aggregated') {
      const d = j.aggregationDetails ?? {};
      return {
        jobId, txHash: j.txHash, aggregationId: Number(j.aggregationId), domainId: j.domainId !== undefined ? Number(j.domainId) : undefined,
        leaf: d.leaf, leafIndex: Number(d.leafIndex), numberOfLeaves: Number(d.numberOfLeaves), merkleProof: d.merkleProof ?? [], root: d.root,
        statuses: seen,
      };
    }
    if (/fail|error|reject/i.test(String(j.status))) throw new Error(`zkVerify job ${jobId} ended as ${j.status}: ${JSON.stringify(j).slice(0, 300)}`);
    if (Date.now() > end) throw new Error(`zkVerify job ${jobId} not aggregated after ${timeoutMs / 60000} min (last status ${j.status})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
