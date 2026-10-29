#!/usr/bin/env bash
# Jalankan Image Forge (web UI lokal).
set -euo pipefail
cd "$(dirname "$0")"

if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  PY="python3"
fi

exec "$PY" server.py "$@"
