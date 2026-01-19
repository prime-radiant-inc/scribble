# syntax=docker/dockerfile:1
# =============================================================================
# Scribble Bot Docker Image
# Company-wide Slack knowledge bot
# =============================================================================

FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (for wiki operations)
RUN ARCH=$(dpkg --print-architecture) \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=${ARCH} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# =============================================================================
# Stage: Build
# =============================================================================
FROM base AS builder
WORKDIR /build

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src

# Install dependencies and build
RUN --mount=type=cache,target=/root/.npm \
    npm ci && npm run build

# =============================================================================
# Stage: Production
# =============================================================================
FROM base

# Copy built application
COPY --from=builder /build/dist /app/dist
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/package.json /app/

# Copy CLAUDE.md for reference
COPY CLAUDE.md /app/

# Create scribble user
RUN useradd -m -s /bin/bash scribble && \
    mkdir -p /app/data && \
    chown -R scribble:scribble /app

# Switch to non-root user
USER scribble

# Environment defaults
ENV NODE_ENV=production
ENV DATA_DIRECTORY=/app/data
ENV LOG_LEVEL=info

# Health check - verify process is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD pgrep -f "node dist/index.js" || exit 1

WORKDIR /app
CMD ["node", "dist/index.js"]
