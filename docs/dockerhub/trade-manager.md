# Quant Trade Manager｜A股持仓与盘中执行管理服务

`quant-trade-manager` 负责把前一交易日的重点候选转成第二天可执行状态，并监控已有持仓的止损、止盈、移动止盈、时间退出和 A 股 T+1 约束。

**本服务不会自动连接券商下单。买入和卖出必须由用户手工确认。**

## 镜像

```bash
docker pull __DOCKERHUB_USERNAME__/quant-trade-manager:latest
```

镜像架构：

```text
linux/amd64
```

## 主要功能

- 自动同步重点3只次日交易计划
- 盘中每分钟监控重点候选
- 盘中每分钟监控实际持仓
- 等待 / 可买 / 不追 / 失效
- 持有 / 移动止盈
- 止损 / 两档止盈
- 时间退出
- A股 T+1 风险锁定
- 手工确认实际买入价
- 手工确认实际卖出价
- 手工录入已有持仓
- 浮盈亏显示
- 状态变化日志
- 已结束交易历史
- AI 聚合执行接口

## 依赖

依赖：

```text
market-data  :8080
stock-select :8090
```

默认容器内地址：

```text
MARKET_DATA_URL=http://market-data:8080
STOCK_SELECT_URL=http://stock-select:8090
```

## 推荐启动

使用完整 Quant Compose：

```bash
git clone https://github.com/drchzy/quant.git
cd quant

cp .env.example .env
docker compose pull
docker compose up -d
```

服务地址：

```text
http://服务器IP:8091
```

健康检查：

```text
http://服务器IP:8091/health
```

日常建议从 Web 访问：

```text
http://服务器IP:8088
```

进入“盘中执行”。

## 单独启动

先确保 market-data 和 stock-select 可访问。

```bash
mkdir -p ./data

docker run -d \
  --name quant-trade-manager \
  --restart unless-stopped \
  -p 8091:8091 \
  -e TZ=Asia/Shanghai \
  -e HOST=0.0.0.0 \
  -e PORT=8091 \
  -e TRADE_DATABASE_PATH=/app/data/trade.duckdb \
  -e MARKET_DATA_URL=http://你的market-data地址:8080 \
  -e STOCK_SELECT_URL=http://你的stock-select地址:8090 \
  -e TRADE_MONITOR_ENABLED=true \
  -e "TRADE_MONITOR_CRON=* * * * 1-5" \
  -e "TRADE_PLAN_SYNC_CRON=45 16 * * 1-5" \
  -v "$PWD/data:/app/data" \
  __DOCKERHUB_USERNAME__/quant-trade-manager:latest
```

## 数据目录

```text
/app/data/trade.duckdb
```

主要保存：

- 交易计划
- 实际确认买入
- 实际确认卖出
- 持仓成本
- 当前状态
- 移动止盈保护价
- T+1待处理风险
- 状态变化事件
- 已结束交易

## 可配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TRADE_DATABASE_PATH` | `/app/data/trade.duckdb` | 交易管理数据库 |
| `MARKET_DATA_URL` | `http://market-data:8080` | 行情服务 |
| `STOCK_SELECT_URL` | `http://stock-select:8090` | 选股服务 |
| `TRADE_MONITOR_ENABLED` | `true` | 是否启用盘中监控 |
| `TRADE_MONITOR_CRON` | `* * * * 1-5` | 盘中检查频率 |
| `TRADE_PLAN_SYNC_CRON` | `45 16 * * 1-5` | 收盘后同步明日计划 |
| `TRADE_MONITOR_TOP_COUNT` | `3` | 自动跟踪重点候选数 |
| `TRADE_DEFAULT_STOP_PCT` | `3` | 手工持仓默认止损 |
| `TRADE_DEFAULT_TAKE_PROFIT1_PCT` | `4` | 第一止盈 |
| `TRADE_DEFAULT_TAKE_PROFIT2_PCT` | `6` | 第二止盈 |
| `TRADE_DEFAULT_TRAILING_START_PCT` | `4` | 移动止盈启动 |
| `TRADE_DEFAULT_TRAILING_DRAWDOWN_PCT` | `2` | 高点回撤保护 |
| `TRADE_DEFAULT_TIME_STOP_DAYS` | `2` | 时间退出 |

## 交易状态

```text
waiting       等待
buy_ready     已进入计划买入区
no_chase      已超过不追价
invalid       买入前计划失效
holding       已确认持仓
trailing      移动止盈已启动
t1_locked     T+1锁定风险
sell_ready    已触发卖出纪律
closed        已确认卖出
expired       当日未买入，计划过期
```

## T+1

确认买入当天，系统不会允许确认卖出。

如果买入当天已经触发止损或第二止盈：

```text
T1_LOCKED_RISK
```

该风险会被保存；下一交易日 T+1 解除后优先转为 `sell_ready`。

## API

```text
GET  /health
GET  /api/v1/trading/today
POST /api/v1/trading/refresh
POST /api/v1/trading/sync-plans

POST /api/v1/trading/plans/:id/buy
POST /api/v1/trading/plans/:id/sell

POST /api/v1/trading/positions

GET  /api/v1/trading/history
GET  /api/v1/trading/events
GET  /api/v1/trading/ai
```

## 注意

这是交易辅助与纪律执行服务，不构成收益保证，也不会自动操作券商账户。

## 日志

```bash
docker logs -f quant-trade-manager
```

## 项目地址

```text
https://github.com/drchzy/quant
```
