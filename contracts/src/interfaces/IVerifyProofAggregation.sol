// SPDX-License-Identifier: Apache-2.0
// Interface copied from zkVerify/zkv-attestation-contracts (Apache-2.0):
// https://github.com/zkVerify/zkv-attestation-contracts/blob/main/contracts/interfaces/IVerifyProofAggregation.sol
pragma solidity ^0.8.20;

interface IVerifyProofAggregation {
    function verifyProofAggregation(
        uint256 _domainId,
        uint256 _aggregationId,
        bytes32 _leaf,
        bytes32[] calldata _merklePath,
        uint256 _leafCount,
        uint256 _index
    ) external view returns (bool);
}
