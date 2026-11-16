# Wildcard Agents — submission (zkVerify Agent Games)

**Project title:** Elenchos — a red team for code that trusts zkVerify proofs

**GitHub repo:** https://github.com/nickthelegend/elenchos

**Agent endpoint (optional):** the case-room agent runs over SSE at `/api/investigate`; a reproducible host is the
Docker image in the repo. (Our Steal the VFY agent for the same event is live at `https://elenchos-duel.vercel.app/agent`.)

**What it does** *(≤2000 chars):*
Elenchos is a chat-driven security agent that cross-examines smart contracts which consume zkVerify aggregation
receipts. A receipt only proves that *some* statement was aggregated — a contract that builds the statement wrong
(takes the verification key from the caller, never records what it consumed, moves value before it checks) will
accept a proof of a circuit the attacker wrote. These bugs pass ordinary tests, because an ordinary test never brings
an attacker's own valid receipt. Elenchos brings one.

You ask the agent about a contract and watch it work, every tool call shown as a card. Claude drives four real tools:
scan (a Slither-based detector with five rules for receipt-consumer bugs), forge (a real Groth16 proof from an
attacker circuit that mints an arbitrary amount, verified locally), replay (reads the real zkVerify verifier on
Ethereum Sepolia and shows the forged leaf returns false on its own), and patch. The patch tool is the point: the
agent proposes a fix, and Elenchos applies it to a throwaway copy, compiles it with Foundry, and re-runs the scanner.
A patch counts as fixed only when it compiles and the scanner is clean — the model proposes, the compiler and scanner
decide. An OpenAI model adds an independent second opinion. Nothing is mocked; a tool without its key says "Setup
required" instead of faking a result.

It ships as a monorepo: the detector (with SARIF output and a GitHub Action so findings show inline on a PR), a safe
`PinnedZkVerifyConsumer` base contract, the proof/attack engine, the deterministic patch verifier, the agent, and the
case-room UI. 37 real tests pass; the 3 that need a full aggregated receipt are honestly skipped until a Kurier key.

**Proof reference (optional):** the replay tool reads zkVerify's verifier at `0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E`
on Sepolia and shows a forged leaf is rejected. The end-to-end forged-receipt exploit on a Sepolia fork is in
`packages/forge/src/attack.ts` and `contracts/test/ForgedReceipt.fork.t.sol`.

**Additional links:** demo video (to record); architecture in `docs/architecture.md`; test table in `TESTING.md`.

**Message to judges** *(≤1000 chars):*
Most "AI auditor" demos stop at a model saying a line looks risky. Elenchos refuses to let the model grade its own
work: the verdict on every fix is a real compile plus a real re-scan, and the impact is a real Groth16 proof read
against the real zkVerify verifier on-chain. It targets a class of bug specific to this ecosystem — contracts that
trust an aggregation receipt without pinning what it proves — and it ships the fix (a safe base contract) and the CI
(SARIF in a GitHub Action), not just the finding. Everything that can't run without a key fails loudly as "Setup
required." The same repo also contains our Steal the VFY agent, which proves every move with the official circuit.
