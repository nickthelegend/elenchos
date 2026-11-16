// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerifyProofAggregation} from "./interfaces/IVerifyProofAggregation.sol";
import {ZkVerifyStatement} from "./ZkVerifyStatement.sol";

/// @title PinnedZkVerifyConsumer
/// @notice A safe base for contracts that act on zkVerify aggregation receipts. It closes the four holes Elenchos
///         looks for:
///         E1  the verification key is pinned at deployment (never taken from the caller);
///         E2  the caller passes the business values, and the contract rebuilds the public inputs from them, so a
///             proof only counts for the action it actually proves;
///         E3  every statement is consumed once (replay);
///         E6  the zkVerify domain is pinned.
///         Inherit it and call `_consume` before any state change (E4: act only after the receipt checks out).
abstract contract PinnedZkVerifyConsumer {
    IVerifyProofAggregation public immutable zkVerify;
    bytes32 public immutable vkHash;
    uint256 public immutable domainId;

    mapping(bytes32 => bool) public consumed;

    error InvalidReceipt();
    error StatementAlreadyUsed(bytes32 statement);

    event StatementConsumed(bytes32 indexed statement, uint256 aggregationId);

    constructor(address zkVerify_, bytes32 vkHash_, uint256 domainId_) {
        zkVerify = IVerifyProofAggregation(zkVerify_);
        vkHash = vkHash_;
        domainId = domainId_;
    }

    /// @param inputs public inputs rebuilt by the inheriting contract from the business values it acts on
    function _consume(
        uint256[] memory inputs,
        uint256 aggregationId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) internal returns (bytes32 statement) {
        statement = ZkVerifyStatement.groth16(vkHash, inputs);
        if (consumed[statement]) revert StatementAlreadyUsed(statement);
        if (!zkVerify.verifyProofAggregation(domainId, aggregationId, statement, merklePath, leafCount, index)) {
            revert InvalidReceipt();
        }
        consumed[statement] = true;
        emit StatementConsumed(statement, aggregationId);
    }
}
