#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f web/config/.env ]; then
  docker compose --env-file web/config/.env down
else
  docker compose down
fi
