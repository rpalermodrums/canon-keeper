# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=25

FROM node:${NODE_VERSION}-bookworm-slim AS workspace

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts/repair-workspace-links.mjs scripts/repair-workspace-links.mjs

RUN bun install --frozen-lockfile

COPY . .

CMD ["bash"]
