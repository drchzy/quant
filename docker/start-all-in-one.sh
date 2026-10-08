#!/usr/bin/env bash
set -Eeuo pipefail

RUNTIME_DIR="/app/web"
CONFIG_FILE="${RUNTIME_DIR}/.env"
DATA_DIR="${RUNTIME_DIR}/data"

mkdir -p "${DATA_DIR}"

# 第一次运行时，把镜像内默认配置复制到宿主机映射目录。
if [ ! -f "${CONFIG_FILE}" ]; then
  cp /opt/quant-defaults/.env "${CONFIG_FILE}"
  echo "已生成默认配置：${CONFIG_FILE}"
fi

# 配置文件由用户直接修改；这里加载后传给三个内部服务。
set -a
# shellcheck disable=SC1090
source "${CONFIG_FILE}"
set +a

export TZ="${TZ:-Asia/Shanghai}"

MARKET_DATABASE_FILE="${MARKET_DATABASE_FILE:-market.duckdb}"
SELECT_DATABASE_FILE="${SELECT_DATABASE_FILE:-select.duckdb}"
TRADE_DATABASE_FILE="${TRADE_DATABASE_FILE:-trade.duckdb}"

PIDS=()

stop_all() {
  trap - TERM INT EXIT
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill -TERM "${pid}" 2>/dev/null || true
    fi
  done
  wait || true
}

trap stop_all TERM INT EXIT

echo "启动 market-data ..."
HOST=127.0.0.1 \
PORT=8080 \
DATABASE_PATH="${DATA_DIR}/${MARKET_DATABASE_FILE}" \
node /app/services/market-data/dist/server.js &
PIDS+=($!)

echo "启动 stock-select ..."
HOST=127.0.0.1 \
PORT=8090 \
SELECT_DATABASE_PATH="${DATA_DIR}/${SELECT_DATABASE_FILE}" \
MARKET_DATA_URL=http://127.0.0.1:8080 \
node /app/services/stock-select/dist/server.js &
PIDS+=($!)

echo "启动 trade-manager ..."
HOST=127.0.0.1 \
PORT=8091 \
TRADE_DATABASE_PATH="${DATA_DIR}/${TRADE_DATABASE_FILE}" \
MARKET_DATA_URL=http://127.0.0.1:8080 \
STOCK_SELECT_URL=http://127.0.0.1:8090 \
node /app/services/trade-manager/dist/server.js &
PIDS+=($!)

echo "启动 Web，统一访问端口 8088 ..."
nginx -g 'daemon off;' &
PIDS+=($!)

# 任意核心进程退出，整个容器退出，由 Docker restart 策略统一拉起。
set +e
wait -n "${PIDS[@]}"
STATUS=$?
set -e

echo "检测到核心进程退出，停止 Quant 容器。"
exit "${STATUS}"
