#!/usr/bin/env bash
# Compiles both circuits and runs a local Groth16 setup (a fresh powers-of-tau ceremony on this machine;
# fine for a red-team demo, never for production). Outputs go to ../../build (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
B="$ROOT/build"
SNARKJS="$ROOT/packages/forge/node_modules/.bin/snarkjs"
mkdir -p "$B"
cd "$B"
if [ ! -s pot10_final.ptau ]; then
  "$SNARKJS" powersoftau new bn128 10 pot10_0.ptau >/dev/null
  "$SNARKJS" powersoftau contribute pot10_0.ptau pot10_1.ptau --name="elenchos-local" -e="$(head -c 32 /dev/urandom | xxd -p -c 64)" >/dev/null
  "$SNARKJS" powersoftau prepare phase2 pot10_1.ptau pot10_final.ptau >/dev/null
  rm -f pot10_0.ptau pot10_1.ptau
fi
for c in claim attacker; do
  circom "$ROOT/circuits/$c.circom" --r1cs --wasm --sym -o "$B" >/dev/null
  "$SNARKJS" groth16 setup "$c.r1cs" pot10_final.ptau "${c}_0.zkey" >/dev/null
  "$SNARKJS" zkey contribute "${c}_0.zkey" "${c}.zkey" --name="elenchos-local" -e="$(head -c 32 /dev/urandom | xxd -p -c 64)" >/dev/null
  "$SNARKJS" zkey export verificationkey "${c}.zkey" "${c}_vk.json" >/dev/null
  rm -f "${c}_0.zkey"
  echo "built $c: $(node -e "const r=require('$B/${c}_vk.json');console.log('nPublic='+r.nPublic+' curve='+r.curve)")"
done
