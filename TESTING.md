# Testing

Every test runs real code: real Slither analysis, real Groth16 proofs with snarkjs, real Foundry compilation, and a
real read of the zkVerify verifier on Ethereum Sepolia. No mocked clients, no stub RPCs on any test that touches a
chain. Run everything with `pnpm -r test` (plus `cd contracts && forge test`).

| Suite | Tests | What it proves |
|---|---:|---|
| `contracts` (Foundry) — `StatementParity.t.sol` | 2 | the zkVerify statement hash computed in Solidity matches the one computed in TypeScript, for the honest and the forged inputs |
| `contracts` (Foundry) — `AttackHolds.t.sol` | 3 | dynamic proof with no testnet key (a faithful mock that vouches only for statements an attacker could really aggregate): the forgery mints on `VulnerableMint` and reverts on `PinnedMint` with no value moved; the honest claim mints once then rejects a replay |
| `contracts` (Foundry) — `ForgedReceipt.fork.t.sol` | 3 (skipped until `KURIER_API_KEY`) | the on-chain version of the above, on a Sepolia fork against the real verifier, using two real zkVerify receipts |
| `@elenchos/forge` | 3 | a real honest proof and a real forged proof generate and verify locally; the statement hash is stable |
| `@elenchos/core` | 5 | the scanner finds E1/E3 in `VulnerableMint` and nothing in `PinnedMint`; a pinned-and-guarded patch is verified; a cosmetic, a non-compiling, a function-deleting and a proof-check-removing patch are each rejected |
| `@elenchos/arena` (Steal the VFY) | 9 | HMAC over raw bytes (hex / base64 / prefixed), 401 on bad signatures, signed preflight, a real policy proof the official VK accepts, identical retries, HOLD without amount, a wrong salt cannot prove, missing config fails loudly |
| `@elenchos/arena` (Proof Gatekeeper) | 11 | every trap in the event's list: a valid condition approves and each of the five arithmetic traps rejects, each with a real gatekeeper proof the official VK accepts; a reused proof reference is rejected and an identical retry gets the same answer; fail closed when the replay store is down; malformed, out-of-range and expired tasks reject; signed transport; a live round-trip against the real Vercel Blob seen-set |
| `@elenchos/agent` | 4 | the scan / forge / patch / replay tools each do real work offline, and replay reports Setup required with no RPC |

**Totals: 37 passing, 3 skipped.** The 3 skips are the forged-receipt fork tests, which need a real aggregated
receipt from zkVerify (Kurier). They are marked Setup required, never faked. To run them:

```bash
# set KURIER_API_KEY and SEPOLIA_RPC_URL in elenchos/.env, then:
node packages/forge/src/attack.ts                       # registers the VKs, proves, aggregates, writes the receipts
cd contracts && forge test --match-contract ForgedReceiptFork --fork-url $SEPOLIA_RPC_URL
```

The full agent loop (Claude streaming + the four tools) was additionally smoke-tested against the live Anthropic API.
