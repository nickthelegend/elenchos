// zkVerify aggregation leaf for a proof ("statement hash"):
//   keccak256(provingSystemId ‖ vkHash ‖ versionHash ‖ keccak256(publicInputs as 32-byte little-endian words))
// Must match contracts/src/ZkVerifyStatement.sol byte for byte (checked by a Foundry parity test).
import { concat, keccak256, sha256, toBytes, toHex, type Hex } from 'viem';

export const PROVING_SYSTEM = {
  groth16: keccak256(toBytes('groth16')),
  ultraplonk: keccak256(toBytes('ultraplonk')),
} as const;
export const NO_VERSION_HASH: Hex = sha256(new Uint8Array());

/** A field element as 32 bytes in little-endian order. */
export function littleEndianWord(value: bigint): Hex {
  const be = toBytes(toHex(value, { size: 32 }));
  return toHex(be.reverse());
}

export function statementHash(provingSystemId: Hex, vkHash: Hex, inputs: bigint[], versionHash: Hex = NO_VERSION_HASH): Hex {
  const encoded = inputs.length ? concat(inputs.map(littleEndianWord)) : '0x';
  return keccak256(concat([provingSystemId, vkHash, versionHash, keccak256(encoded)]));
}

export const groth16Statement = (vkHash: Hex, inputs: bigint[]) => statementHash(PROVING_SYSTEM.groth16, vkHash, inputs);
