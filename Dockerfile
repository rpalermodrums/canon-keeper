# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20.19.5
ARG BUN_VERSION=1.2.23

FROM node:${NODE_VERSION}-bookworm-slim AS workspace
ARG BUN_VERSION

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile

COPY . .

CMD ["bash"]
