// The zkVerify VK hash comes from a real zkVerify node. Ground truth: the two Groth16 keys the Agent Games organisers
// registered on zkVerify mainnet and publish at agentgames.zkverify.io/api/circuit-info.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zkVerifyVkHash } from '../src/vkhash.ts';

const vk = (f: string) => JSON.parse(readFileSync(new URL(`../../arena/artifacts/${f}`, import.meta.url), 'utf8'));

test('vk_hash of the organisers\' registered keys matches what zkVerify mainnet recorded', async () => {
  assert.equal(await zkVerifyVkHash(vk('gatekeeper_vk.json')), '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0');
  assert.equal(await zkVerifyVkHash(vk('vfy-policy_vk.json')), '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047');
});

test('a malformed key fails loudly instead of being sent', async () => {
  const good = vk('gatekeeper_vk.json');
  await assert.rejects(zkVerifyVkHash({ ...good, IC: [] }), /no IC points/);
  await assert.rejects(zkVerifyVkHash({ ...good, vk_alpha_1: ['21888242871839275222246405745257275088696311157297823662689037894645226208583', '1', '1'] }), /base-field/);
  await assert.rejects(zkVerifyVkHash({ ...good, curve: 'bls12381' }), /BN254/);
});
