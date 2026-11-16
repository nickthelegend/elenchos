import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/scan.ts';
import { verifyPatch } from '../src/patch.ts';

const demo = fileURLToPath(new URL('../../../contracts/src/demo/', import.meta.url));

test('the scanner finds the known holes in VulnerableMint and none in PinnedMint', async () => {
  const vuln = await scan(`${demo}VulnerableMint.sol`);
  assert.ok(vuln.some((f) => f.rule === 'E1'), 'E1 (vk from caller)');
  assert.ok(vuln.some((f) => f.rule === 'E3'), 'E3 (no replay guard)');
  const pinned = await scan(`${demo}PinnedMint.sol`);
  assert.equal(pinned.length, 0, `PinnedMint should be clean, got ${JSON.stringify(pinned)}`);
});

test('a pinned-and-guarded patch of VulnerableMint is verified; a cosmetic one is rejected', async () => {
  const path = `${demo}VulnerableMint.sol`;
  const good = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IVerifyProofAggregation} from "../interfaces/IVerifyProofAggregation.sol";
import {ZkVerifyStatement} from "../ZkVerifyStatement.sol";
contract VulnerableMint {
    IVerifyProofAggregation public immutable zkVerify;
    bytes32 public immutable vkHash;
    uint256 public immutable domainId;
    mapping(address => uint256) public balanceOf;
    mapping(bytes32 => bool) public consumed;
    uint256 public totalSupply;
    event Minted(address indexed to, uint256 amount);
    constructor(address z, bytes32 vk, uint256 d) { zkVerify = IVerifyProofAggregation(z); vkHash = vk; domainId = d; }
    function claim(uint256 aggregationId, uint256[] calldata inputs, bytes32[] calldata merklePath, uint256 leafCount, uint256 index) external {
        bytes32 leaf = ZkVerifyStatement.groth16(vkHash, inputs);
        require(!consumed[leaf], "replayed");
        require(zkVerify.verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index), "invalid proof");
        consumed[leaf] = true;
        balanceOf[address(uint160(inputs[0]))] += inputs[1];
        totalSupply += inputs[1];
        emit Minted(address(uint160(inputs[0])), inputs[1]);
    }
}
`;
  const ok = await verifyPatch(path, good);
  assert.equal(ok.compiles, true, ok.reason);
  assert.equal(ok.verified, true, ok.reason);
  assert.ok(ok.cleared.length >= 2);

  // A patch that only renames a variable keeps every finding: must be rejected.
  const cosmetic = readFileSync(path, 'utf8').replace(/amount/g, 'amt');
  const bad = await verifyPatch(path, cosmetic);
  assert.equal(bad.verified, false);
  assert.ok(bad.remaining.some((f) => f.rule === 'E1'));
});

test('a patch that does not compile is rejected, loudly', async () => {
  const r = await verifyPatch(`${demo}VulnerableMint.sol`, 'pragma solidity ^0.8.20; contract Broken { function f() { ');
  assert.equal(r.compiles, false);
  assert.equal(r.verified, false);
  assert.match(r.reason, /does not compile/);
});

test('a patch that deletes the vulnerable function is rejected even though the scanner is clean', async () => {
  const path = `${demo}VulnerableMint.sol`;
  // Compiles, and the scanner finds nothing because `claim` is gone — but the entry point was removed, not fixed.
  const gutted = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IVerifyProofAggregation} from "../interfaces/IVerifyProofAggregation.sol";
contract VulnerableMint {
    IVerifyProofAggregation public immutable zkVerify;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    constructor(address z) { zkVerify = IVerifyProofAggregation(z); }
}
`;
  const r = await verifyPatch(path, gutted);
  assert.equal(r.compiles, true, r.reason);
  assert.equal(r.findingsAfter.length, 0, 'scanner is quiet because the function is gone');
  assert.equal(r.verified, false, 'but deleting the entry point is not a fix');
  assert.ok(r.evaded.some((e) => /removed or renamed/.test(e)), r.reason);
});

test('a patch that rips the receipt check out entirely is rejected', async () => {
  const path = `${demo}VulnerableMint.sol`;
  const noProof = readFileSync(path, 'utf8')
    .replace(/bytes32 leaf = ZkVerifyStatement[\s\S]*?"invalid proof"\s*\);/, '// proof check removed');
  const r = await verifyPatch(path, noProof);
  if (r.compiles) { assert.equal(r.verified, false); assert.ok(r.evaded.length > 0 || r.remaining.length > 0, r.reason); }
});
