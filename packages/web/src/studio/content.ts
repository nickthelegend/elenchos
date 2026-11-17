export const HOLES_REF = [
  { r: 'E1', sev: 'critical', obj: 'forged-key', t: 'The caller picks the verification key, so an attacker proves anything with their own circuit.', f: 'Pin vkHash as an immutable set at deploy.' },
  { r: 'E1b', sev: 'critical', obj: 'merkle', t: 'The caller hands over the leaf, so any leaf anyone ever got aggregated can be replayed for a different action.', f: 'Rebuild the leaf on-chain from the pinned key and the values you act on.' },
  { r: 'E3', sev: 'high', obj: 'receipt', t: 'The receipt is checked but never recorded, so one receipt claims twice.', f: 'Store the statement hash and reject it the second time.' },
  { r: 'E4', sev: 'critical', obj: 'cracked', t: 'Value moves in a function that checks no receipt at all.', f: 'Gate every value move on a receipt checked in the same call.' },
  { r: 'E6', sev: 'medium', obj: 'gate', t: 'The caller picks the zkVerify domain, so a receipt from a domain they control counts.', f: 'Pin the domain id.' },
] as const;

// A new file starts as a small zkVerify consumer, so the first audit has something real to say.
export const NEW_FILE_TEMPLATE = (name: string) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerifyProofAggregation} from "../interfaces/IVerifyProofAggregation.sol";

/// @title ${name}
/// @notice Paste your zkVerify consumer here, or edit this one, then press Run audit.
contract ${name} {
    IVerifyProofAggregation public immutable zkVerify;
    mapping(address => uint256) public balanceOf;

    constructor(address zkVerify_) {
        zkVerify = IVerifyProofAggregation(zkVerify_);
    }

    function claim(bytes32 vkHash, uint256 domainId, uint256 aggregationId, bytes32 leaf, bytes32[] calldata path, uint256 count, uint256 index, uint256 amount) external {
        require(zkVerify.verifyProofAggregation(domainId, aggregationId, leaf, path, count, index), "invalid receipt");
        vkHash; // TODO: is the key ever checked?
        balanceOf[msg.sender] += amount;
    }
}
`;
