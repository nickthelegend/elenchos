pragma circom 2.1.6;

include "../packages/forge/node_modules/circomlib/circuits/poseidon.circom";
include "../packages/forge/node_modules/circomlib/circuits/bitify.circom";

// Proof of audit: "the Elenchos auditor published this report with this verdict".
// Public signals, in order: digestHi, digestLo, verdict, auditor.
//   digestHi/digestLo: the sha256 of the report's canonical JSON, as two 128-bit halves (anyone can recompute it)
//   verdict: 0 no holes found, 1 findings, 2 exploit proven, 3 fix verified
//   auditor: Poseidon(secret), the auditor's public id; only the holder of `secret` can prove for it
// zkVerify verifies the proof and aggregates its statement to Ethereum, so the report is timestamped, tamper-evident,
// and attributable to one auditor key, and its anchor can be checked with zkVerify's verifier contract on Sepolia.
template AuditAttestation() {
    signal input digestHi;
    signal input digestLo;
    signal input verdict;
    signal input auditor;
    signal input secret; // private

    component hi = Num2Bits(128); hi.in <== digestHi;
    component lo = Num2Bits(128); lo.in <== digestLo;
    component v = Num2Bits(2); v.in <== verdict;

    component id = Poseidon(1);
    id.inputs[0] <== secret;
    auditor === id.out;
}

component main {public [digestHi, digestLo, verdict, auditor]} = AuditAttestation();
