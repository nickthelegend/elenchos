// The studio's pasted-contract path: a throwaway Foundry workspace, the real Slither scan, and readable refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { badSource, overBudget, withWorkspace } from '../src/workspace.ts';
import { scanTool } from '../src/tools.ts';

const demo = (f: string) => readFileSync(fileURLToPath(new URL(`../../../contracts/src/demo/${f}`, import.meta.url)), 'utf8');

test('a pasted copy of VulnerableMint scans exactly like the repo file, and the workspace is removed', async () => {
  let seenPath = '';
  const { findings } = await withWorkspace('Pasted.sol', demo('VulnerableMint.sol'), async (path) => { seenPath = path; return scanTool(path); });
  assert.deepEqual(findings.map((f) => `${f.rule}@${f.line}`).sort(), ['E1@25', 'E3@24', 'E6@26']);
  assert.ok(seenPath.endsWith('/src/user/Pasted.sol'));
  assert.equal(existsSync(seenPath), false, 'the throwaway workspace is deleted afterwards');
});

test('LeafFromCaller: the caller-supplied leaf (E1b) and the receipt-free airdrop (E4)', async () => {
  const { findings } = await withWorkspace('Leaf.sol', demo('LeafFromCaller.sol'), (path) => scanTool(path));
  assert.deepEqual(findings.map((f) => f.rule).sort(), ['E1b', 'E4']);
});

test('HelperMint: calls through zkVerify\'s own verify() helper still get E1, E3 and E6', async () => {
  const { findings } = await withWorkspace('Helper.sol', demo('HelperMint.sol'), (path) => scanTool(path));
  assert.deepEqual(findings.map((f) => f.rule).sort(), ['E1', 'E3', 'E6']);
});

test('a public view checker (like zkVerify\'s helpers) is not a consumer: no findings', async () => {
  const src = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IVerifyProofAggregation} from "../interfaces/IVerifyProofAggregation.sol";
contract Checker {
    IVerifyProofAggregation immutable zk;
    constructor(address z) { zk = IVerifyProofAggregation(z); }
    function verify(bytes32 leaf, uint256 domainId, uint256 aggregationId, bytes32[] calldata path, uint256 count, uint256 index) external view returns (bool) {
        return zk.verifyProofAggregation(domainId, aggregationId, leaf, path, count, index);
    }
}`;
  const { findings } = await withWorkspace('Checker.sol', src, (path) => scanTool(path));
  assert.equal(findings.length, 0);
});

test('the fixed contract comes back clean', async () => {
  const { findings } = await withWorkspace('Pinned.sol', demo('PinnedMint.sol'), (path) => scanTool(path));
  assert.equal(findings.length, 0);
});

test('bad names and sources are refused with a readable reason, before anything runs', () => {
  assert.match(badSource('../x.sol', 'pragma solidity ^0.8.0;')!, /name must look like/);
  assert.match(badSource('X.txt', 'pragma solidity ^0.8.0;')!, /name must look like/);
  assert.match(badSource('X.sol', '')!, /non-empty/);
  assert.match(badSource('X.sol', 'contract A {}')!, /pragma solidity/);
  assert.match(badSource('X.sol', `pragma solidity ^0.8.0;${' '.repeat(70_000)}`)!, /over 64 KB/);
  assert.equal(badSource('My_Vault2.sol', 'pragma solidity ^0.8.20; contract A {}'), null);
});

test('the per-visitor budget only applies when configured', () => {
  assert.equal(overBudget('1.2.3.4', 0), false);
  assert.equal(overBudget('5.6.7.8', 2), false);
  assert.equal(overBudget('5.6.7.8', 2), false);
  assert.equal(overBudget('5.6.7.8', 2), true);
});
