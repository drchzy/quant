#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f web/config/.env ]; then
  echo "未找到 web/config/.env，请先运行 ./web/start.sh" >&2
  exit 1
fi

docker compose --env-file web/config/.env pull
docker compose --env-file web/config/.env up -d
