# Found in the wild

We pointed Elenchos at the public repositories in the zkVerify ecosystem that consume aggregation
receipts. It flagged **four live contracts with the same critical bug** — the one Elenchos was built to
catch. We name one, `anon-claim`, and link its exact line at a pinned commit. The other three teams stay
anonymous while we tell them privately: no repo, owner, file or function names. Each finding maps to the Elenchos
exploit test that reproduces the pattern on a **fork of Ethereum Sepolia against
zkVerify's real verifier**, with an attacker proof zkVerify actually aggregated (aggregation `270049`).

> These are testnet hackathon projects with no funds at risk. We told the anon-claim author first, we are
> telling the other three teams privately, and we lead with the fix. The point is not to embarrass anyone — it is that this bug class is easy to ship and hard to see in
> a normal test, which is exactly why an agent that brings its own valid receipt is worth building.

## The one bug, four times: `E1b` — the caller supplies the leaf

A zkVerify aggregation receipt only proves that *some* leaf was aggregated in a domain. It says nothing
about *which* statement that leaf is. A safe consumer **rebuilds the leaf on-chain** from a pinned
verification key and the exact public inputs it is about to act on, and verifies *that* leaf. Each contract
below instead takes the `leaf` as a **function parameter from the caller** and asks the verifier only "is
this leaf in a batch?" So an attacker takes **any** proof zkVerify ever aggregated — even from an unrelated
circuit — and passes its real `leaf` / `merklePath` / `aggregationId` / `index`, with the action's own
fields (recipient, wallet, identity, tx hash) set to whatever they want. `verifyProofAggregation` returns
`true`, and the contract acts.

The fix is the same for all four: [`PinnedZkVerifyConsumer`](../contracts/src/PinnedZkVerifyConsumer.sol) —
pin the verifier, the `vkHash` and the domain as immutables, rebuild the leaf from the real inputs, and
record each consumed statement once.

| # | Repository | Contract · function | What an attacker gets | Status |
|---|---|---|---|---|
| 1 | [`smilewithkhushi/anon-claim`](https://github.com/smilewithkhushi/anon-claim) | [`AnonClaim.claim`](https://github.com/smilewithkhushi/anon-claim/blob/f61296e596558a0a23a8769e7407ef162308c0e8/contracts/src/AnonClaim.sol#L135) | Drains the ETH reward pool to any address, with no eligibility proof | Author notified (Nov 18) |
| 2 | Project B *(withheld)* | access-NFT mint | Mints access NFTs to anyone; a second mint path has no check at all | Disclosing privately |
| 3 | Project C *(withheld)* | identity registry | Links any identity hash to any wallet (fake "verified" identities) | Disclosing privately |
| 4 | Project D *(withheld)* | email-attestation recorder | Records a false email-attestation statement against any tx hash | Disclosing privately |

---

### 1 — `anon-claim`: drain the reward pool

[`AnonClaim.claim`](https://github.com/smilewithkhushi/anon-claim/blob/f61296e596558a0a23a8769e7407ef162308c0e8/contracts/src/AnonClaim.sol#L119)
takes `_leaf` straight from the caller (the NatSpec even says *"do not recompute"*) and pays `rewardAmount`
to a caller-chosen `recipient`:

```solidity
if (!ZK_VERIFY.verifyProofAggregation(_domainId, _aggregationId, _leaf, _merklePath, _leafCount, _index))
    revert AggregationInvalid();
nullifierUsed[nullifier] = true;
(bool ok,) = recipient.call{value: rewardAmount}("");   // recipient and nullifier are caller input
```

Nothing binds `_leaf` to `nullifier`, `root` or `recipient`. An attacker supplies any real aggregated leaf,
a fresh `nullifier`, `root = merkleRoot` (public) and `recipient =` their own address. The call pays out.
New nullifier each time → the whole pool. **No eligibility proof, no secret.**

### 2 — Project B: free access NFTs

An access-NFT contract takes `leaf` from the caller and mints on any aggregated leaf — one per address, but any
address, with no valid credential. A second public mint path has **no check at all** (`E4`): anyone mints an NFT to
any seller, no proof involved.

### 3 — Project C: forge a verified identity

An identity registry for undercollateralized lending takes the wallet, the identity hash and the `leaf`, all as
caller parameters, then links that identity to that wallet. With any real aggregated leaf, anyone links any
identity to any wallet — and the lending layer built on top trusts a fabricated identity.

### 4 — Project D: false email attestations

An email-attestation recorder takes `leaf` and a tx hash from the caller and records the statement for any
aggregated leaf. An attacker writes false "this email proves affiliation with org X" records against a tx hash they
choose. (Its sibling path rebuilds the leaf itself and is not affected — the gap is only the caller-leaf path.)

---

## How Elenchos reproduces it

The four findings are the same shape Elenchos ships a fork exploit for. Its `leaf-from-caller` template
([`packages/agent/src/exploit.ts`](../packages/agent/src/exploit.ts)) runs on a **fork of Ethereum Sepolia
against zkVerify's real verifier** (`0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E`) and replays a **real
honest aggregated leaf** (aggregation `270049`, submitted through Kurier) to pay an attacker — proving the
verifier returns `true` for a statement the contract never bound to its action. See
[`TESTING.md`](../TESTING.md) and run it yourself in the studio: paste a contract with this shape and press **Run
exploit test**.

Scan methodology and the full 25-repo ecosystem sweep (precision, false positives we found and fixed) are
in the private research notes; this page lists only the manually confirmed true positives.

*Elenchos — [github.com/nickthelegend/elenchos](https://github.com/nickthelegend/elenchos) · MIT.*
