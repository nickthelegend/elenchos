// Real proofs for both circuits, local verification, and the statement-hash fixture for the Foundry parity test.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keccak256, toBytes } from 'viem';
import { poseidon1, proveClaim, proveForgery, shutdownProver } from '../src/prove.ts';
import { groth16Statement } from '../src/statement.ts';

after(shutdownProver);
const FIXTURES = fileURLToPath(new URL('../../../contracts/fixtures/', import.meta.url));

test('honest claim proof verifies and respects the 1,000 cap', async () => {
  const secret = 123456789n;
  const nullifier = await poseidon1(secret);
  const r = await proveClaim(0xbeefn, 500n, secret, nullifier);
  assert.equal(r.verifiedLocally, true);
  assert.deepEqual(r.publicSignals, ['48879', '500', nullifier.toString()]);
  await assert.rejects(proveClaim(0xbeefn, 1_000_000n, secret, nullifier), 'the claim circuit refuses an amount over the cap');
  await assert.rejects(proveClaim(0xbeefn, 500n, secret + 1n, nullifier), 'and a wrong secret');
});

test('the attacker circuit "proves" a million-token mint with the same public interface', async () => {
  const attacker = 0xa11ce00000000000000000000000000000000a11cen;
  const r = await proveForgery(attacker, 1_000_000n, 42n);
  assert.equal(r.verifiedLocally, true);
  assert.deepEqual(r.publicSignals, [attacker.toString(), '1000000', '42']);
  console.log(`  forged proof generated and verified locally in ${r.ms} ms`);
});

test('statement-hash fixture for the Solidity parity test', () => {
  const vkHash = keccak256(toBytes('elenchos-parity-vk'));
  const cases = [[1n, 2n, 3n], [0xa11cen, 1_000_000n, 42n], [2n ** 253n + 7n, 0n, 999n]].map((inputs) => ({
    vkHash, inputs: inputs.map(String), statement: groth16Statement(vkHash, inputs),
  }));
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(`${FIXTURES}statements.json`, JSON.stringify({ cases }, null, 2));
  assert.equal(cases.length, 3);
});
