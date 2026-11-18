# Testing

Every test runs real code: real Slither analysis, real Groth16 proofs with snarkjs, real Foundry compilation, and a
real read of the zkVerify verifier on Ethereum Sepolia. No mocked clients, no stub RPCs on any test that touches a
chain. Run everything with `pnpm -r test` (plus `cd contracts && forge test`).

| Suite | Tests | What it proves |
|---|---:|---|
| `contracts` (Foundry) — `StatementParity.t.sol` | 2 | the zkVerify statement hash computed in Solidity matches the one computed in TypeScript, for the honest and the forged inputs |
| `contracts` (Foundry) — `AttackHolds.t.sol` | 3 | dynamic proof with no testnet key (a faithful mock that vouches only for statements an attacker could really aggregate): the forgery mints on `VulnerableMint` and reverts on `PinnedMint` with no value moved; the honest claim mints once then rejects a replay |
| `contracts` (Foundry) — `ForgedReceipt.fork.t.sol` | 3 (run with `--fork-url`) | the on-chain version of the above, on a Sepolia fork against zkVerify's real verifier, with two real receipts zkVerify aggregated (aggregation 270049, `contracts/fixtures/receipts.json`): the attacker-circuit proof mints 1,000,000 on `VulnerableMint` and is rejected by `PinnedMint`; the honest claim works once |
| `@elenchos/forge` | 6 | a real honest proof and a real forged proof generate and verify locally; a proof of audit binds the report digest and verdict to the auditor key and refuses a wrong key; the statement hash is stable; a real zkVerify node's `vk_hash` matches the two keys the organisers registered on mainnet; a malformed key is refused before it is sent |
| `@elenchos/core` | 5 | the scanner finds E1/E3 in `VulnerableMint` and nothing in `PinnedMint`; a pinned-and-guarded patch is verified; a cosmetic, a non-compiling, a function-deleting and a proof-check-removing patch are each rejected |
| `@elenchos/arena` (Steal the VFY + Proof Gatekeeper) | 23 in all | HMAC over raw bytes (hex / base64 / prefixed), 401 on bad signatures, signed preflight, a real policy proof the official VK accepts, identical retries, HOLD without amount, a wrong salt cannot prove, missing config fails loudly |
| ↳ Proof Gatekeeper |  | every trap in the event's list: a valid condition approves and each of the five arithmetic traps rejects, each with a real gatekeeper proof the official VK accepts; a reused proof reference is rejected and an identical retry gets the same answer; fail closed when the replay store is down; malformed, out-of-range and expired tasks reject; signed transport; a live round-trip against the real Vercel Blob seen-set |
| `@elenchos/agent` — tools | 5 | scan finds E1; forge proves a real forgery and gets its real zkVerify leaf; replay asks the real Sepolia verifier about that leaf in a real aggregation (not accepted); patch verifies a pinned fix and rejects a cosmetic one; replay says Setup required with no RPC |
| `@elenchos/agent` — workspace | 7 | pasted files are audited in a throwaway Foundry copy: E1/E3/E6 on VulnerableMint, E1b/E4 on LeafFromCaller, E1/E3/E6 through zkVerify's own verify() helper (HelperMint), no findings on a public view checker or the fixed contract, bad input refused, per-visitor budget |
| `@elenchos/agent` — exploit test | 4 | real `forge test` runs: the stock attacks fit the four claim shapes and nothing else; cheatcodes that reach outside the EVM are refused; on a local EVM the attacks work on VulnerableMint, LeafFromCaller and HelperMint and revert on PinnedMint with InvalidReceipt and StatementAlreadyUsed; on a Sepolia fork against zkVerify's real verifier, with the real aggregated receipts, VulnerableMint pays the attacker and PinnedMint stops both attacks |
| `@elenchos/agent` — proof of audit | 3 | a report this server anchored on zkVerify through Kurier: its digest is the sha256 of the canonical report; zkVerify's verifier on Sepolia accepts the rebuilt leaf; a report with one finding deleted no longer matches and the verifier says false |
| `@elenchos/agent` — dependency recovery | 3 | unresolved imports are detected; well-known libraries are fetched at a matching version; remappings are added |
| `@elenchos/agent` — projects | 4 | GitHub URL parsing, the foundry.toml sanitizer, and a deployed contract loaded live from Sourcify with its compiler (zkVerify's Sepolia aggregation contract) |
| `@elenchos/agent` — reports, MCP | 3 | the report headline follows the strongest evidence; the badge SVG; MCP initialize, tools/list, notifications and errors |

**Totals: 73 passing, 0 skipped** (contracts 8 with `--fork-url`, forge 6, core 5, arena 23, agent 31). Without a
fork URL the 3 Sepolia fork tests skip. The real receipts they use came from Kurier (zkVerify testnet); to make fresh ones:

```bash
# set KURIER_API_KEY (and optionally SEPOLIA_RPC_URL) in elenchos/.env, then:
node packages/forge/src/attack.ts                       # registers the VKs, proves, aggregates, writes the receipts
cd contracts && forge test --match-contract ForgedReceiptFork --fork-url $SEPOLIA_RPC_URL
```

The full agent loop (Claude streaming + the four tools) was additionally smoke-tested against the live Anthropic API.
