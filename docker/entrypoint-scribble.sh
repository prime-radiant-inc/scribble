#!/bin/bash
set -e

echo "=== Scribble Bot Starting ==="
echo "Data directory: ${DATA_DIRECTORY:-/data}"

echo "=== Starting Scribble Bot ==="

chown -R scribble:scribble "${DATA_DIRECTORY:-/data}"

SCRIBBLE_HOME="$(getent passwd scribble | cut -d: -f6)"
CLAUDE_DIR="${SCRIBBLE_HOME}/.claude"
CLAUDE_CONFIG="${SCRIBBLE_HOME}/.claude.json"
CLAUDE_REMOTE_SETTINGS="${CLAUDE_DIR}/remote-settings.json"

mkdir -p "${CLAUDE_DIR}"
if [ ! -f "${CLAUDE_CONFIG}" ]; then
  printf '{}\n' > "${CLAUDE_CONFIG}"
fi
if [ ! -f "${CLAUDE_REMOTE_SETTINGS}" ]; then
  printf '{}\n' > "${CLAUDE_REMOTE_SETTINGS}"
fi
chown -R scribble:scribble "${CLAUDE_DIR}" "${CLAUDE_CONFIG}"

# Claude Agent SDK refuses elevated operation in the bot process. Start as root
# only long enough to fix mounted volume ownership, then run the app as scribble.
exec runuser -u scribble -- node dist/index.js
