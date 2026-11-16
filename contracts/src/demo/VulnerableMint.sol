// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerifyProofAggregation} from "../interfaces/IVerifyProofAggregation.sol";
import {ZkVerifyStatement} from "../ZkVerifyStatement.sol";

/// @title VulnerableMint (demo target, intentionally unsafe)
/// @notice A claim token that mints to whoever brings a zkVerify receipt. It follows the shape of public zkVerify
///         consumers in the wild: the verification key arrives as an argument (E1) and statements can be replayed
///         (E3). Elenchos uses it as the on-camera target. Never deploy this.
contract VulnerableMint {
    IVerifyProofAggregation public immutable zkVerify;
    string public constant name = "Demo Claim";
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event Minted(address indexed to, uint256 amount);

    constructor(address zkVerify_) {
        zkVerify = IVerifyProofAggregation(zkVerify_);
    }

    /// @dev inputs = [recipient, amount, nullifier] as the claim circuit's public signals
    function claim(
        bytes32 vkHash,
        uint256 domainId,
        uint256 aggregationId,
        uint256[] calldata inputs,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external {
        bytes32 leaf = ZkVerifyStatement.groth16(vkHash, inputs);
        require(
            zkVerify.verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index),
            "invalid proof"
        );
        address to = address(uint160(inputs[0]));
        uint256 amount = inputs[1];
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Minted(to, amount);
    }
}
