#!/bin/bash
set -e

echo "=== Scribble Bot Starting ==="
echo "Data directory: ${DATA_DIRECTORY:-/data}"

echo "=== Starting Scribble Bot ==="

chown -R scribble:scribble "${DATA_DIRECTORY:-/data}" 2>/dev/null || true

# Claude Agent SDK refuses elevated operation in the bot process. Start as root
# only long enough to fix mounted volume ownership, then run the app as scribble.
exec su scribble -c "node dist/index.js"
