// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The verify() entry point of zkVerify's Groth16 helper contract (ZkVerifyGroth16), which builds the statement
///         and calls verifyProofAggregation for you.
interface IZkVerifyGroth16 {
    function verify(
        bytes32 vkHash,
        uint256[] memory inputs,
        uint256 domainId,
        uint256 aggregationId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external view returns (bool);
}
