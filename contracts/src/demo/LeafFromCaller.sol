// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerifyProofAggregation} from "../interfaces/IVerifyProofAggregation.sol";

/// @title LeafFromCaller (demo target, intentionally unsafe)
/// @notice It even has a replay guard, but the caller hands over the leaf itself (E1b) and `airdrop` moves value
///         with no receipt at all (E4). Elenchos uses it to show the two holes VulnerableMint doesn't have.
contract LeafFromCaller {
    IVerifyProofAggregation public immutable zkVerify;
    uint256 public immutable domainId;
    mapping(bytes32 => bool) public used;
    mapping(address => uint256) public balanceOf;

    constructor(address zkVerify_, uint256 domainId_) {
        zkVerify = IVerifyProofAggregation(zkVerify_);
        domainId = domainId_;
    }

    function claim(bytes32 leaf, address to, uint256 amount, uint256 aggregationId, bytes32[] calldata path, uint256 count, uint256 index) external {
        require(!used[leaf], "used");
        require(zkVerify.verifyProofAggregation(domainId, aggregationId, leaf, path, count, index), "invalid");
        used[leaf] = true;
        balanceOf[to] += amount; // `to` and `amount` are never tied to the leaf
    }

    function airdrop(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}
