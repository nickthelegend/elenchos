pragma circom 2.1.6;

// The attacker's circuit: the SAME public interface as Claim (recipient, amount, nullifier), but it
// constrains nothing that matters. Any values "verify". zkVerify will honestly verify a proof of this circuit;
// a consumer that lets the caller pick the verification key will accept it as a claim.
template Attacker() {
    signal input recipient;
    signal input amount;
    signal input nullifier;

    signal t <== recipient * amount;
    signal u <== t * nullifier;
}

component main {public [recipient, amount, nullifier]} = Attacker();
