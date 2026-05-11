# syntax=docker/dockerfile:1.7
# =============================================================================
# Scribble Bot Docker Image
# Self-hosted Slack knowledge bot
# =============================================================================
# The production image in sen-deploy uses the same runtime shape: compiled
# Scribble, bundled scribble-mcp, packaged streamlinear MCP, and an entrypoint
# that fixes mounted data ownership before dropping privileges.

FROM node:26-slim AS base

RUN apt-get update && apt-get install -y \
    git \
    curl \
    gnupg \
    ca-certificates \
    sqlite3 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI for wiki operations.
RUN ARCH=$(dpkg --print-architecture) \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=${ARCH} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Native dependencies may need node-gyp when a Node release is ahead of their
# published prebuilds. Keep build tools out of the final runtime image.
FROM base AS build-base

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Stage: Build Scribble
# =============================================================================
FROM build-base AS builder
WORKDIR /build

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build:all

# =============================================================================
# Stage: Production
# =============================================================================
FROM base

COPY --from=builder /build/dist /app/dist
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/package.json /app/
COPY CLAUDE.md /app/

RUN userdel node 2>/dev/null; \
    useradd -m -s /bin/bash -u 1000 scribble && \
    mkdir -p /data && \
    chown -R scribble:scribble /app /data

COPY docker/entrypoint-scribble.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV DATA_DIRECTORY=/data
ENV LOG_LEVEL=info

# This process-level healthcheck only verifies the Node process is running; it
# does not prove Slack Socket Mode is connected.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD pgrep -fx "node dist/index.js" || exit 1

WORKDIR /app
ENTRYPOINT ["/entrypoint.sh"]
