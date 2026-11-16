// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PinnedZkVerifyConsumer} from "../PinnedZkVerifyConsumer.sol";

/// @title PinnedMint
/// @notice VulnerableMint after Elenchos's patch: same claim, but on PinnedZkVerifyConsumer. The key and domain are
///         pinned, the inputs are rebuilt from the values the contract acts on, and each statement is used once.
contract PinnedMint is PinnedZkVerifyConsumer {
    string public constant name = "Demo Claim (pinned)";
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event Minted(address indexed to, uint256 amount);

    constructor(address zkVerify_, bytes32 vkHash_, uint256 domainId_)
        PinnedZkVerifyConsumer(zkVerify_, vkHash_, domainId_)
    {}

    function claim(
        address to,
        uint256 amount,
        uint256 nullifier,
        uint256 aggregationId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external {
        uint256[] memory inputs = new uint256[](3);
        inputs[0] = uint256(uint160(to));
        inputs[1] = amount;
        inputs[2] = nullifier;
        _consume(inputs, aggregationId, merklePath, leafCount, index);
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Minted(to, amount);
    }
}
