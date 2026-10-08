#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p web/config web/data

if [ ! -f web/config/.env ]; then
  cp web/config/.env.example web/config/.env
  echo "已生成 web/config/.env"
  echo "默认登录：admin / quant123456"
  echo "正式使用前建议修改 WEB_PASSWORD。"
fi

docker compose --env-file web/config/.env pull
docker compose --env-file web/config/.env up -d

echo
echo "Quant 已启动。"
echo "Web: http://服务器IP:$(grep '^WEB_PORT=' web/config/.env | cut -d= -f2 || echo 8088)"
echo "运行目录: $ROOT_DIR/web"
