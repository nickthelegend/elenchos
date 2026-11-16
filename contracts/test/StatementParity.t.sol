// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ZkVerifyStatement} from "../src/ZkVerifyStatement.sol";

/// The Solidity statement hash must equal the TypeScript one (packages/forge/src/statement.ts) on the same inputs,
/// or every receipt Elenchos computes would miss. Fixture written by packages/forge/test/proofs.test.ts.
contract StatementParityTest is Test {
    function test_matches_typescript_fixture() public view {
        string memory json = vm.readFile("fixtures/statements.json");
        for (uint256 c = 0; c < 3; c++) {
            string memory base = string.concat(".cases[", vm.toString(c), "]");
            bytes32 vkHash = vm.parseJsonBytes32(json, string.concat(base, ".vkHash"));
            string[] memory raw = vm.parseJsonStringArray(json, string.concat(base, ".inputs"));
            uint256[] memory inputs = new uint256[](raw.length);
            for (uint256 i = 0; i < raw.length; i++) inputs[i] = vm.parseUint(raw[i]);
            bytes32 expected = vm.parseJsonBytes32(json, string.concat(base, ".statement"));
            assertEq(ZkVerifyStatement.groth16(vkHash, inputs), expected, "statement hash differs from TypeScript");
        }
    }

    function test_little_endian_word() public pure {
        assertEq(ZkVerifyStatement.littleEndian(1), bytes32(uint256(1) << 248));
        assertEq(ZkVerifyStatement.littleEndian(0x0102), bytes32((uint256(0x02) << 248) | (uint256(0x01) << 240)));
    }
}
