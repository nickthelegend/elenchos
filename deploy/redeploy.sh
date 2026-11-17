#!/usr/bin/env bash
# Ship main to the hackathon VPS and rebuild Elenchos Studio. Run from the repo root on the Mac.
set -euo pipefail
HOST=root@201.18.198.162
SSH=(ssh -i "$HOME/.ssh/hackathon_vps" -o BatchMode=yes "$HOST")
"${SSH[@]}" 'rm -rf /opt/hk/elenchos/app.new; mkdir -p /opt/hk/elenchos/app.new && chmod 700 /opt/hk/elenchos'
git archive --format=tar HEAD | "${SSH[@]}" 'tar -x -C /opt/hk/elenchos/app.new'
# git archive leaves submodules out; ship each one at its pinned commit (forge-std for the contracts build).
git submodule foreach --quiet 'git archive --format=tar --prefix="$displaypath/" HEAD' | "${SSH[@]}" 'tar -x -i -C /opt/hk/elenchos/app.new'
# The circuit artifacts are built with circom on the Mac (gitignored); ship the exact ones the docs' vk hashes come from.
[ -f build/attacker_vk.json ] || { echo "build/ is missing: run pnpm --dir packages/forge circuits first" >&2; exit 1; }
tar -c --exclude='*.ptau' build | "${SSH[@]}" 'tar -x -C /opt/hk/elenchos/app.new'
"${SSH[@]}" 'set -e; cd /opt/hk/elenchos; rm -rf app.prev; [ -d app ] && mv app app.prev; mv app.new app;
  cd app && flock /opt/hk/.build.lock docker compose -f deploy/docker-compose.yml up -d --build >> /opt/hk/elenchos-build.log 2>&1;
  docker compose -f deploy/docker-compose.yml ps'
