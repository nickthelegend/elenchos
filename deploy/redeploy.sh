#!/usr/bin/env bash
# Ship main to the hackathon VPS and rebuild Elenchos Studio. Run from the repo root on the Mac.
set -euo pipefail
HOST=root@201.18.198.162
SSH=(ssh -i "$HOME/.ssh/hackathon_vps" -o BatchMode=yes "$HOST")
"${SSH[@]}" 'mkdir -p /opt/hk/elenchos/app.new && chmod 700 /opt/hk/elenchos'
git archive --format=tar HEAD | "${SSH[@]}" 'tar -x -C /opt/hk/elenchos/app.new'
"${SSH[@]}" 'set -e; cd /opt/hk/elenchos; rm -rf app.prev; [ -d app ] && mv app app.prev; mv app.new app;
  cd app && flock /opt/hk/.build.lock docker compose -f deploy/docker-compose.yml up -d --build >> /opt/hk/elenchos-build.log 2>&1;
  docker compose -f deploy/docker-compose.yml ps'
