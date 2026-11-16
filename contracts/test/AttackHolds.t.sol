// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {VulnerableMint} from "../src/demo/VulnerableMint.sol";
import {PinnedMint} from "../src/demo/PinnedMint.sol";
import {PinnedZkVerifyConsumer} from "../src/PinnedZkVerifyConsumer.sol";
import {IVerifyProofAggregation} from "../src/interfaces/IVerifyProofAggregation.sol";
import {ZkVerifyStatement} from "../src/ZkVerifyStatement.sol";

/// @notice A faithful stand-in for zkVerify: it vouches for exactly the leaves that were actually aggregated, and
///         nothing else. An attacker can get their OWN circuit's statement aggregated (register it here), but they
///         can never make it vouch for a statement built from a verification key they don't control. This is what
///         lets the test prove a fix dynamically — "the attack fails on the patched contract" — without any testnet
///         key: the mock only ever says yes to a leaf someone could really have obtained.
contract MockAggregator is IVerifyProofAggregation {
    mapping(bytes32 => bool) public aggregated;

    function aggregate(bytes32 leaf) external {
        aggregated[leaf] = true;
    }

    function verifyProofAggregation(uint256, uint256, bytes32 leaf, bytes32[] calldata, uint256, uint256)
        external
        view
        returns (bool)
    {
        return aggregated[leaf];
    }
}

/// Dynamic proof that the Elenchos fix holds: the forgery that mints on the vulnerable contract reverts on the
/// pinned one. Runs with no testnet key — this is the "attack demonstrably fails" evidence behind the static scan.
contract AttackHoldsTest is Test {
    MockAggregator zk;
    bytes32 constant PINNED_VK = keccak256("the real claim circuit vk (pinned at deploy)");
    bytes32 constant ATTACKER_VK = keccak256("a circuit the attacker wrote and registered");
    uint256 constant DOMAIN = 1;
    address attacker = address(0xA11CE);
    address honestUser = address(0xB0B);

    function setUp() public {
        zk = new MockAggregator();
    }

    function _inputs(address to, uint256 amount, uint256 nullifier) internal pure returns (uint256[] memory a) {
        a = new uint256[](3);
        a[0] = uint256(uint160(to));
        a[1] = amount;
        a[2] = nullifier;
    }

    // The hole: VulnerableMint takes the vk from the caller, so the attacker brings a REAL receipt for their OWN
    // circuit and mints 1,000,000 to themselves.
    function test_forgery_mints_on_vulnerable() public {
        VulnerableMint vuln = new VulnerableMint(address(zk));
        uint256[] memory inputs = _inputs(attacker, 1_000_000, 42);
        bytes32 forgedLeaf = ZkVerifyStatement.groth16(ATTACKER_VK, inputs);
        zk.aggregate(forgedLeaf); // the attacker really did get their own circuit's statement aggregated

        bytes32[] memory path = new bytes32[](0);
        vm.prank(attacker);
        vuln.claim(ATTACKER_VK, DOMAIN, 1, inputs, path, 1, 0);
        assertEq(vuln.balanceOf(attacker), 1_000_000, "vulnerable contract minted from a forged-circuit receipt");
    }

    // The fix: PinnedMint rebuilds the leaf from its OWN pinned vk, so the attacker's aggregated leaf never matches.
    // The exact same forgery now reverts. No value moves.
    function test_forgery_reverts_on_pinned() public {
        PinnedMint pinned = new PinnedMint(address(zk), PINNED_VK, DOMAIN);
        uint256[] memory inputs = _inputs(attacker, 1_000_000, 42);
        bytes32 forgedLeaf = ZkVerifyStatement.groth16(ATTACKER_VK, inputs);
        zk.aggregate(forgedLeaf); // same real attacker receipt as above

        bytes32[] memory path = new bytes32[](0);
        vm.prank(attacker);
        vm.expectRevert(PinnedZkVerifyConsumer.InvalidReceipt.selector);
        pinned.claim(attacker, 1_000_000, 42, 1, path, 1, 0);
        assertEq(pinned.balanceOf(attacker), 0, "no value moved on the pinned contract");
    }

    // The honest path still works on the fix: a receipt for the PINNED circuit mints once.
    function test_honest_claim_works_once_on_pinned() public {
        PinnedMint pinned = new PinnedMint(address(zk), PINNED_VK, DOMAIN);
        uint256[] memory inputs = _inputs(honestUser, 500, 7);
        bytes32 honestLeaf = ZkVerifyStatement.groth16(PINNED_VK, inputs); // built with the pinned vk
        zk.aggregate(honestLeaf);

        bytes32[] memory path = new bytes32[](0);
        pinned.claim(honestUser, 500, 7, 1, path, 1, 0);
        assertEq(pinned.balanceOf(honestUser), 500, "honest claim mints");

        // replay the same receipt -> rejected (statement consumed once)
        vm.expectRevert(abi.encodeWithSelector(PinnedZkVerifyConsumer.StatementAlreadyUsed.selector, honestLeaf));
        pinned.claim(honestUser, 500, 7, 1, path, 1, 0);
    }
}
