pragma circom 2.1.6;

include "../packages/forge/node_modules/circomlib/circuits/poseidon.circom";
include "../packages/forge/node_modules/circomlib/circuits/comparators.circom";

// The circuit a claim contract MEANS to trust: you know the secret behind the nullifier,
// and the amount is at most 1,000. Public signals, in order: recipient, amount, nullifier.
template Claim() {
    signal input recipient;
    signal input amount;
    signal input nullifier;
    signal input secret; // private

    component h = Poseidon(1);
    h.inputs[0] <== secret;
    nullifier === h.out;

    component cap = LessEqThan(32);
    cap.in[0] <== amount;
    cap.in[1] <== 1000;
    cap.out === 1;

    // bind the recipient into the proof (a proof for one recipient is not a proof for another)
    signal recipientSquared <== recipient * recipient;
}

component main {public [recipient, amount, nullifier]} = Claim();
