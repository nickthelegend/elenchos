// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IZkVerifyGroth16} from "../interfaces/IZkVerifyGroth16.sol";

/// @title HelperMint (demo target, intentionally unsafe)
/// @notice Uses zkVerify's official Groth16 helper, which builds the leaf correctly. The holes are still in the
///         consumer: the vk and the domain come from the caller (E1, E6) and nothing is recorded (E3).
contract HelperMint {
    IZkVerifyGroth16 public immutable helper;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    constructor(address helper_) {
        helper = IZkVerifyGroth16(helper_);
    }

    /// @dev inputs = [recipient, amount, nullifier]
    function claim(
        bytes32 vkHash,
        uint256[] calldata inputs,
        uint256 domainId,
        uint256 aggregationId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external {
        require(helper.verify(vkHash, inputs, domainId, aggregationId, merklePath, leafCount, index), "invalid proof");
        address to = address(uint160(inputs[0]));
        balanceOf[to] += inputs[1];
        totalSupply += inputs[1];
    }
}
