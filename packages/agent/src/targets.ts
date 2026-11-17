// The demo targets the agent can investigate. Real files in the repo; the agent reads and patches them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const demo = fileURLToPath(new URL('../../../contracts/src/demo/', import.meta.url));
export type Target = { id: string; title: string; path: string; language: 'solidity'; blurb: string };

export const TARGETS: Target[] = [
  { id: 'vulnerable-mint', title: 'VulnerableMint.sol', path: `${demo}VulnerableMint.sol`, language: 'solidity',
    blurb: 'A claim token that mints to whoever brings a zkVerify receipt. Takes the verification key from the caller and never records a statement.' },
  { id: 'leaf-from-caller', title: 'LeafFromCaller.sol', path: `${demo}LeafFromCaller.sol`, language: 'solidity',
    blurb: 'Has a replay guard, yet takes the leaf itself from the caller and has an airdrop that checks no receipt at all.' },
  { id: 'pinned-mint', title: 'PinnedMint.sol', path: `${demo}PinnedMint.sol`, language: 'solidity',
    blurb: 'The fixed version: pins the vk and domain, rebuilds the leaf on-chain, and consumes each statement once.' },
];

export const source = (t: Target) => readFileSync(t.path, 'utf8');
export const findTarget = (id: string) => TARGETS.find((t) => t.id === id);
