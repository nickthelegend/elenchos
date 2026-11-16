# Elenchos end-to-end test plan

Every item is run against the real product: the case room in a real Chrome (Claude in Chrome) served by the real
agent server, real Claude calls, real Slither, real Foundry, real snarkjs, a real read of zkVerify's Sepolia
verifier, and the live arena endpoint. Each item states exactly what "correct" means. Console and network are checked
on every browser item; any console error or failed request fails the item.

Status key: PASS · FAIL (then fixed and re-run) · UNTESTED (needs a dependency we don't have, named)

## A. Case room (browser, http://localhost:8787)

| # | Flow | Correct means |
|---|---|---|
| A1 | Load `/` | Header, two target buttons (VulnerableMint.sol, PinnedMint.sol), readiness chips: claude on, openai off (Setup required tooltip), verifier rpc on, kurier off. Empty-state text in chat. Source of VulnerableMint shown with line numbers. 0 console errors, all requests 2xx. |
| A2 | Switch target | Clicking PinnedMint.sol shows its source, clears the chat, case file says "Not yet examined". |
| A3 | Full investigation, VulnerableMint (preset 1) | Streams agent text; tool cards appear in order scan → forge → replay → patch. scan: ≥1 critical finding incl. E1 on `claim`, findings listed in case file with line numbers, flagged lines highlighted in source. forge: status ok, real proof time in ms, `verifiedLocally: true`, and the zkVerify leaf of the forged statement. replay: reads the real verifier `0xEA0A…361E` against a real, existing aggregation and reports the forged leaf is not in it. patch: status ok, verified true, compiles true, cleared rules listed, "proposed fix" diff tab opens with the patched source. Second-opinion card says Setup required (no OpenAI key), honestly. Proof strip: all four steps ✓. Verdict "Fix verified". Run ends (live chip off, composer enabled). 0 console errors. |
| A4 | Investigation, PinnedMint | scan reports no findings; agent says it's clean and does not claim a forgery succeeded against it; verdict not "Exploitable". |
| A5 | Free-text prompt | Typing a question and Send adds the user bubble and runs the agent with that prompt; Send disabled while empty or running. |
| A6 | Stop mid-run | A Stop control is visible while running; clicking it ends the stream within ~2 s, the server aborts the Claude request, the UI returns to idle with a "stopped" note, no console error. |
| A7 | Server unreachable | With the server down, the page (if cached) or a reload shows a readable error state ("Can't reach the Elenchos server"), not a blank screen. Investigation errors appear in the chat as a readable message. |
| A8 | Second run in the same case | After A3 finishes, a follow-up question works and appends to the same thread. |
| A9 | Phone width 375 px | Mobile tabs (chat / evidence / case file) switch columns; `scrollWidth <= innerWidth` on every tab; buttons ≥ 44 px tall; text not clipped. |
| A10 | Evasion attempt through the UI | Prompt asking the agent to "make the scanner pass by deleting claim" → patch tool returns not verified with an evasion reason; the agent does not claim success. |

## B. Agent server API

| # | Request | Correct means |
|---|---|---|
| B1 | `GET /api/targets` | 200 JSON with 2 targets (id, title, source) and `ready` flags matching the env. |
| B2 | `POST /api/investigate` unknown target | 404 `{error:"unknown target"}`. |
| B3 | `POST /api/investigate` malformed JSON, non-object, bad prompt, bad history, oversized body | 400 with a readable error (413 over 256 KB); the server keeps running. |
| B4 | `GET /../.env`, `/%2e%2e/.env` | 404; no file outside `packages/web/dist` is ever served. |
| B5 | Unknown route | 404 JSON. |

## C. Engine (real tools, CLI)

| # | Item | Correct means |
|---|---|---|
| C1 | Detector CLI on VulnerableMint | Exits 0, prints E1 (critical) and E3 (high) with file:line; on PinnedMint prints 0 findings. |
| C2 | SARIF | `detectors/sarif.py` emits valid SARIF 2.1.0 with one result per finding. |
| C3 | Foundry suite | `forge test` passes StatementParity (2) and AttackHolds (3); fork suite (3) skipped. |
| C4 | Package tests | `pnpm -r test`: forge 5, core 5, agent 5, arena 20, all pass. |
| C5 | Fork exploit with real receipts | UNTESTED unless KURIER_API_KEY exists (needs a zkVerify Kurier testnet key). |

## D. Live arena agent (https://elenchos-duel.vercel.app/agent)

| # | Item | Correct means |
|---|---|---|
| D1 | Health | GET returns ok, events [steal-the-vfy, proof-gatekeeper], configured hmac/strategy/replayStore all true. |
| D2 | Signature gate | Unsigned POST → 401. |
| D3 | Platform preflight | Dashboard "Test preflight" → passes. |
| D4 | Gatekeeper practice | Platform practice mode sends real signed tasks; every answer correct per the trap list, each provable answer carries a proof, no errors in Vercel logs. |
| D5 | Steal live play | Leaderboard shows Elenchos Duel active with verified turns (reliability bonus). |

## E. Submissions

| # | Item | Correct means |
|---|---|---|
| E1 | Wildcard | Dashboard lists the Elenchos Wildcard entry (pending review); the repo link opens a public repo whose README runs as written. |
| E2 | Steal | Entered · Elenchos Duel. |
| E3 | Gatekeeper | Entered · Elenchos Duel (after the round lock lifts, 2:00 AM IST). |
| E4 | Creator | At least one published piece with #AgentGames and @ZKVProtocol, submitted on the dashboard. Needs Nick's OK to post from his accounts. |

## Results (Nov 16, 2026, final build `02494ca`+)

Run in the user's real Chrome (Claude in Chrome) against the real server; every browser item checked the console
(0 messages on every item) and the network panel (every request 2xx, except the deliberate 404 in A7b). Each FAIL was
fixed at the root cause, then the whole plan was run again on the final build.

| # | First run | What was wrong → fix | Final |
|---|---|---|---|
| A1 | PASS | — | PASS |
| A2 | PASS | — | PASS |
| A3 | FAIL | forge returned no zkVerify leaf (`'0x'`), so replay had to be given a leaf the model could invent, and it checked a non-existent aggregation (#999,999,999). → forge gets the attacker key's hash from a real zkVerify node (`vk_hash_groth16`, checked against the organisers' two mainnet keys) and returns the real leaf; replay takes no input and checks that leaf against the latest real aggregation on the Sepolia verifier. Agent Markdown rendered raw `**` → a safe Markdown renderer. | PASS (scan/forge/replay/patch all OK; aggregation #270047; Fix verified) |
| A4 | FAIL | verdict said "Not yet examined" and "No findings yet" after a clean scan → "No holes found" + an explicit clean-scan note | PASS |
| A5 | PASS | — | PASS |
| A6 | FAIL | no Stop control existed → Stop button that aborts the stream and the server's Claude request | PASS (idle in 29 ms, "Stopped." note) |
| A7 | FAIL | unreachable server showed "TypeError: Failed to fetch"; a failed target load left a blank screen → plain-language errors + Try again | PASS (both cases) |
| A8 | FAIL | the agent had no memory between turns ("I haven't given a previous answer") and later lacked the patched source → the thread (questions, answers, tool results, findings, the exact patched source) is replayed to Claude as real turns | PASS (names the `used` mapping that is in the patched source) |
| A9 | FAIL | tap targets 32–41 px; between 761 and 1080 px the case file was unreachable → 44 px+ targets, tab layout up to 1080 px | PASS (375 and 900 px: no overflow, all tabs reachable, 0 targets < 44 px) |
| A10 | FAIL | the verdict stayed "Not yet examined" after a rejected patch, and the patch card showed a green ✓ next to ERROR → "Fix rejected", diff tab marked rejected, neutral wrench icon | PASS |
| B1 | PASS | — | PASS |
| B2 | PASS | — | PASS |
| B3 | FAIL | one malformed JSON body crashed the whole server → error boundary, validated body/prompt/history, 413 over 256 KB | PASS |
| B4 | PASS | static path guard rewritten to resolve-and-confine anyway | PASS |
| B5 | PASS | — | PASS |
| C1 | PASS | E1/E6 pointed at the verify call (line 34) → now at the parameter the attacker controls (lines 25, 26) | PASS |
| C2 | FAIL | `sarif.py` failed under `python -I`; SARIF paths were not repo-relative | PASS (3 results, `contracts/src/demo/VulnerableMint.sol`) |
| C3 | PASS | — | PASS (5 passed, 3 fork tests skipped) |
| C4 | PASS | — | PASS (35 package tests) |
| C5 | UNTESTED | needs a Kurier (zkVerify) testnet API key | UNTESTED |
| CI | FAIL | the GitHub Action scanned the repo root (not a Foundry project) and failed → submodules + Foundry + scan `contracts/` | PASS (run succeeded on GitHub; alerts #2, #4, #5 on lines 24, 25, 26) |
| D1 | PASS | — | PASS |
| D2 | PASS | — | PASS |
| D3 | PASS | — | PASS ("Preflight OK — Healthy · 278 ms") |
| D4 | partial | platform practice is capped at 10 tasks/agent/hour; the first batch recorded the platform's verdict for only 2 of 10 tasks | PASS (9/9 CORRECT, all 7 trap types, see D4 below) |
| D5 | PASS | — | PASS (20 VFY = 1 win + full reliability bonus) |
| E1 | PASS | — | PASS (Wildcard: pending review) |
| E2 | PASS | — | PASS (Entered · Elenchos Duel) |
| E3 | blocked | "Proof Gatekeeper entry is locked while a round is open" | scheduled for 2:07 AM IST, Nov 17 |
| E4 | PASS | — | PASS (two Creator entries: the write-up and the film, both with #AgentGames, pending review) |

Zero mocks or stubs in the tested surface. The only stand-in anywhere is the `MockAggregator` inside the Foundry test
`AttackHolds.t.sol`, which is a test fixture (named as such) and never part of the product.

### D4: Proof Gatekeeper practice, platform verdicts (Nov 16, 21:58–22:10 IST)

Dispatched one at a time from the dashboard's Practice Mode against the live endpoint; each row is the platform's own
scoring. Together with the first batch (THRESHOLD_MISMATCH, RECIPIENT_MISMATCH, EXPIRED_CONDITION, VALID_CONDITION),
all 7 trap types have been answered correctly live.

| # | Task | Trap | Submitted / Expected | Proof | Latency (ms) | Platform verdict |
|---|---|---|---|---|---|---|
| 1 | `practice_3500adf0…` | EXPIRED_CONDITION | REJECT / REJECT | VERIFIED | 1979 | CORRECT |
| 2 | `practice_df550f43…` | VK_SUBSTITUTION | REJECT / REJECT | VERIFIED | 1235 | CORRECT |
| 3 | `practice_11e4d1a2…` | PROOF_REUSED | REJECT / REJECT | VERIFIED* | 771 | CORRECT |
| 4 | `practice_f0de7eb5…` | PROOF_REUSED | REJECT / REJECT | VERIFIED* | 432 | CORRECT |
| 5 | `practice_6023ecbe…` | AMOUNT_OVERFLOW | REJECT / REJECT | VERIFIED | 1024 | CORRECT |
| 6 | `practice_15470e54…` | VK_SUBSTITUTION | REJECT / REJECT | VERIFIED | 1188 | CORRECT |
| 7 | `practice_17065b00…` | VALID_CONDITION | APPROVE / APPROVE | VERIFIED | 1149 | CORRECT |
| 8 | `practice_4062c979…` | AMOUNT_OVERFLOW | REJECT / REJECT | VERIFIED | 1034 | CORRECT |
| 9 | `practice_1a7dba95…` | PROOF_REUSED | REJECT / REJECT | VERIFIED* | 616 | CORRECT |

\* For PROOF_REUSED the agent sends no proof (Vercel log: `"reason":"PROOF_REUSED","proof":false`), because the
gatekeeper circuit forces APPROVE on inputs whose arithmetic passes, so no valid REJECT proof exists. The platform
still scores it CORRECT with proof status VERIFIED: no proof penalty for this case.
