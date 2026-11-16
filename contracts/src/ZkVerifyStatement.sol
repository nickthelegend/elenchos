// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ZkVerifyStatement
/// @notice The statement hash zkVerify puts in an aggregation leaf:
///         keccak256(provingSystemId ‖ vkHash ‖ versionHash ‖ keccak256(publicInputs)),
///         where each public input is a 32-byte word in little-endian byte order.
///         Written from the zkVerify docs and the published aggregation format (not copied from the helper repo).
library ZkVerifyStatement {
    bytes32 internal constant GROTH16 = keccak256(abi.encodePacked("groth16"));
    bytes32 internal constant ULTRAPLONK = keccak256(abi.encodePacked("ultraplonk"));
    bytes32 internal constant NO_VERSION = sha256(abi.encodePacked(""));

    function hash(bytes32 provingSystemId, bytes32 vkHash, bytes32 versionHash, uint256[] memory inputs)
        internal
        pure
        returns (bytes32)
    {
        bytes32[] memory words = new bytes32[](inputs.length);
        for (uint256 i = 0; i < inputs.length; i++) words[i] = littleEndian(inputs[i]);
        return keccak256(abi.encodePacked(provingSystemId, vkHash, versionHash, keccak256(abi.encodePacked(words))));
    }

    function groth16(bytes32 vkHash, uint256[] memory inputs) internal pure returns (bytes32) {
        return hash(GROTH16, vkHash, NO_VERSION, inputs);
    }

    /// @notice Reverses the 32 bytes of a word (big-endian uint256 -> little-endian bytes32).
    function littleEndian(uint256 input) internal pure returns (bytes32 out) {
        uint256 v = input;
        uint256 r;
        for (uint256 i = 0; i < 32; i++) {
            r = (r << 8) | (v & 0xff);
            v >>= 8;
        }
        out = bytes32(r);
    }
}
