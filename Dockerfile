# syntax=docker/dockerfile:1.7
# =============================================================================
# Scribble Bot Docker Image
# Self-hosted Slack knowledge bot
# =============================================================================
#
# Until streamlinear is published as a package, build with a named context for
# the sibling source checkout:
#
#   docker build \
#     --build-context streamlinear=../../streamlinear \
#     -t scribble:local .
#
# Compatible streamlinear bridge refs live in docs/bridge-refs.json. Verify
# locally with `npm run check:bridge`.
#
# The production image in sen-deploy uses the same runtime shape: compiled
# Scribble, bundled scribble-mcp, bundled streamlinear MCP, and an entrypoint
# that fixes mounted data ownership before dropping privileges.

FROM node:20-slim AS base

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

# =============================================================================
# Stage: Build streamlinear MCP bundle
# =============================================================================
FROM base AS streamlinear-builder
WORKDIR /build-streamlinear

COPY --from=streamlinear mcp/package.json mcp/package-lock.json ./mcp/
COPY --from=streamlinear mcp/tsconfig.json ./mcp/
COPY --from=streamlinear mcp/src ./mcp/src

RUN --mount=type=cache,target=/root/.npm \
    cd mcp && npm ci && npm run build

# =============================================================================
# Stage: Build Scribble
# =============================================================================
FROM base AS builder
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
COPY --from=streamlinear-builder /build-streamlinear/mcp/dist/index.js /app/lib/streamlinear-mcp.js
COPY CLAUDE.md /app/

RUN userdel node 2>/dev/null; \
    useradd -m -s /bin/bash -u 1000 scribble && \
    mkdir -p /app/lib /data && \
    chmod +x /app/lib/streamlinear-mcp.js && \
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
