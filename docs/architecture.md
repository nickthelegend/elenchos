# Architecture

```
            ┌────────────── packages/web (case room) ──────────────┐
            │  chat · evidence (code + diff) · proof strip · verdict │
            └───────────────────────┬──────────────────────────────┘
                                    │ SSE
            ┌───────────────────────▼──────────────────────────────┐
            │  packages/agent — Claude drives, tools do the work     │
            │                                                        │
            │   scan ──► detectors/elenchos_scan.py (Slither)        │
            │   forge ─► packages/forge (snarkjs Groth16)            │
            │   replay ► reads the real zkVerify verifier (Sepolia)  │
            │   patch ─► packages/core verifyPatch (forge + rescan)  │
            │                 └─► OpenAI second opinion (optional)    │
            └────────────────────────────────────────────────────────┘
```

## The deterministic core

The one claim Elenchos must never get wrong is "this fix works." So that claim is not the model's to make. The patch
tool (`packages/core/src/patch.ts`) takes the agent's proposed source, writes it onto a throwaway copy of the target's
Foundry project, compiles it with `forge build`, and runs the scanner again. A patch is **verified** only if it
compiles and the scanner reports zero findings. A cosmetic edit keeps its findings and is rejected; a broken edit
fails to compile and is rejected. The LLM proposes; the compiler and the scanner decide.

## The statement hash

A zkVerify Groth16 leaf is
`keccak256(provingSystemId ‖ vkHash ‖ versionHash ‖ keccak256(public inputs as 32-byte little-endian words))`.
`contracts/src/ZkVerifyStatement.sol` builds it on-chain and `packages/forge/src/statement.ts` builds the same thing
off-chain; `StatementParity.t.sol` pins them together so a drift fails the build.

## The attack path

`packages/forge/src/attack.ts` is the honest end-to-end exploit on a Sepolia fork: register the claim VK and an
attacker VK with zkVerify (Kurier), prove an honest claim and a forged one, submit both and wait until each is
aggregated, discover the domain id by asking the real verifier which one accepts the leaf, and write the receipts the
fork tests consume. It only forges a proof of *the attacker's own circuit* and brings a *real* zkVerify receipt for
it — it never forges zkVerify's aggregation.
