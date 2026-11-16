# Testing

Every test runs real code: real Slither analysis, real Groth16 proofs with snarkjs, real Foundry compilation, and a
real read of the zkVerify verifier on Ethereum Sepolia. No mocked clients, no stub RPCs on any test that touches a
chain. Run everything with `pnpm -r test` (plus `cd contracts && forge test`).

| Suite | Tests | What it proves |
|---|---:|---|
| `contracts` (Foundry) — `StatementParity.t.sol` | 2 | the zkVerify statement hash computed in Solidity matches the one computed in TypeScript, for the honest and the forged inputs |
| `contracts` (Foundry) — `ForgedReceipt.fork.t.sol` | 3 (skipped until `KURIER_API_KEY`) | on a Sepolia fork against the real verifier: the vulnerable contract mints 1,000,000 twice from a forged receipt; the pinned contract rejects the forged receipt; the pinned contract accepts an honest receipt once |
| `@elenchos/forge` | 3 | a real honest proof and a real forged proof generate and verify locally; the statement hash is stable |
| `@elenchos/core` | 3 | the scanner finds E1/E3 in `VulnerableMint` and nothing in `PinnedMint`; a pinned-and-guarded patch is verified; a cosmetic patch and a non-compiling patch are rejected |
| `@elenchos/arena` (Steal the VFY) | 9 | HMAC over raw bytes (hex / base64 / prefixed), 401 on bad signatures, signed preflight, a real policy proof the official VK accepts, identical retries, HOLD without amount, a wrong salt cannot prove, missing config fails loudly |
| `@elenchos/agent` | 4 | the scan / forge / patch / replay tools each do real work offline, and replay reports Setup required with no RPC |

**Totals: 21 passing, 3 skipped.** The 3 skips are the forged-receipt fork tests, which need a real aggregated
receipt from zkVerify (Kurier). They are marked Setup required, never faked. To run them:

```bash
# set KURIER_API_KEY and SEPOLIA_RPC_URL in elenchos/.env, then:
node packages/forge/src/attack.ts                       # registers the VKs, proves, aggregates, writes the receipts
cd contracts && forge test --match-contract ForgedReceiptFork --fork-url $SEPOLIA_RPC_URL
```

The full agent loop (Claude streaming + the four tools) was additionally smoke-tested against the live Anthropic API.
