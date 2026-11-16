# Elenchos: the full stack in one image — Node, Foundry and Slither, so scan/forge/replay/patch all work.
FROM ghcr.io/foundry-rs/foundry:latest AS foundry

FROM node:22-bookworm-slim
# Foundry (forge/anvil/cast) from the official image
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/forge
COPY --from=foundry /usr/local/bin/cast /usr/local/bin/cast
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
# Slither for the scanner
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages slither-analyzer==0.11.6 \
    && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@10.29.2
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false \
    && (cd contracts && forge build) \
    && (cd packages/web && pnpm build)
ENV ELENCHOS_SLITHER_PYTHON=python3 PORT=8787
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "packages/agent/src/server.ts"]
