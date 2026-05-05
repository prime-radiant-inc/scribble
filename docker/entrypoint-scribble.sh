#!/bin/bash
set -e

echo "=== Scribble Bot Starting ==="
echo "Data directory: ${DATA_DIRECTORY:-/data}"

echo "=== Starting Scribble Bot ==="

chown -R scribble:scribble "${DATA_DIRECTORY:-/data}"

# Claude Agent SDK refuses elevated operation in the bot process. Start as root
# only long enough to fix mounted volume ownership, then run the app as scribble.
exec runuser -u scribble -- node dist/index.js
