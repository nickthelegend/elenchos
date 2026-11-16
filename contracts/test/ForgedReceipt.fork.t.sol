// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {VulnerableMint} from "../src/demo/VulnerableMint.sol";
import {PinnedMint} from "../src/demo/PinnedMint.sol";
import {PinnedZkVerifyConsumer} from "../src/PinnedZkVerifyConsumer.sol";

// The real attack, on a Sepolia fork against zkVerify's real aggregation contract.
// fixtures/receipts.json is written by `pnpm --filter @elenchos/forge attack` from two REAL zkVerify receipts:
//   forged: a proof of the attacker circuit (recipient = attacker, amount = 1,000,000)
//   honest: a proof of the claim circuit (amount 500)
// Without that file the suite skips with "Setup required" (no mocked receipts).
contract ForgedReceiptForkTest is Test {
    address constant ZKVERIFY_SEPOLIA = 0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E;

    struct ZkReceipt {
        bytes32 vkHash;
        uint256 domainId;
        uint256 aggregationId;
        uint256[] inputs;
        bytes32[] merklePath;
        uint256 leafCount;
        uint256 index;
    }

    string json;
    bool ready;

    function setUp() public {
        if (block.chainid != 11155111) return;
        try vm.readFile("fixtures/receipts.json") returns (string memory j) {
            json = j;
            ready = true;
        } catch {}
    }

    function _r(string memory k) internal view returns (ZkReceipt memory r) {
        r.vkHash = vm.parseJsonBytes32(json, string.concat(".", k, ".vkHash"));
        r.domainId = vm.parseJsonUint(json, string.concat(".", k, ".domainId"));
        r.aggregationId = vm.parseJsonUint(json, string.concat(".", k, ".aggregationId"));
        r.inputs = vm.parseJsonUintArray(json, string.concat(".", k, ".inputs"));
        r.merklePath = vm.parseJsonBytes32Array(json, string.concat(".", k, ".merklePath"));
        r.leafCount = vm.parseJsonUint(json, string.concat(".", k, ".leafCount"));
        r.index = vm.parseJsonUint(json, string.concat(".", k, ".index"));
    }

    modifier needsReceipts() {
        if (!ready) {
            vm.skip(true); // Setup required: real receipts (run the attack script with a Kurier key)
        }
        _;
    }

    function test_vulnerable_consumer_mints_a_million_to_a_wrong_circuit_proof() public needsReceipts {
        ZkReceipt memory f = _r("forged");
        VulnerableMint target = new VulnerableMint(ZKVERIFY_SEPOLIA);
        target.claim(f.vkHash, f.domainId, f.aggregationId, f.inputs, f.merklePath, f.leafCount, f.index);
        assertEq(target.balanceOf(address(uint160(f.inputs[0]))), 1_000_000, "zkVerify verified the forged proof and the target minted");
        // E3: the same receipt works again
        target.claim(f.vkHash, f.domainId, f.aggregationId, f.inputs, f.merklePath, f.leafCount, f.index);
        assertEq(target.totalSupply(), 2_000_000, "replayed");
    }

    function test_pinned_consumer_rejects_the_forged_proof() public needsReceipts {
        ZkReceipt memory f = _r("forged");
        ZkReceipt memory h = _r("honest");
        PinnedMint fixed_ = new PinnedMint(ZKVERIFY_SEPOLIA, h.vkHash, h.domainId);
        vm.expectRevert(PinnedZkVerifyConsumer.InvalidReceipt.selector);
        fixed_.claim(address(uint160(f.inputs[0])), f.inputs[1], f.inputs[2], f.aggregationId, f.merklePath, f.leafCount, f.index);
    }

    function test_pinned_consumer_accepts_the_honest_claim_once() public needsReceipts {
        ZkReceipt memory h = _r("honest");
        PinnedMint fixed_ = new PinnedMint(ZKVERIFY_SEPOLIA, h.vkHash, h.domainId);
        address to = address(uint160(h.inputs[0]));
        fixed_.claim(to, h.inputs[1], h.inputs[2], h.aggregationId, h.merklePath, h.leafCount, h.index);
        assertEq(fixed_.balanceOf(to), h.inputs[1]);
        vm.expectRevert();
        fixed_.claim(to, h.inputs[1], h.inputs[2], h.aggregationId, h.merklePath, h.leafCount, h.index);
    }
}
