# Quant Trade Manager

次日执行计划、已有持仓和盘中状态监控服务。

## 推荐：整套 Docker Compose 部署

四个镜像按服务拆分，推荐一起部署：

- `quant-market-data`
- `quant-stock-select`
- `quant-trade-manager`
- `quant-web`

### 一键准备

```bash
mkdir -p quant/runtime/config quant/runtime/data
cd quant

curl -L -o docker-compose.yml https://raw.githubusercontent.com/drchzy/quant/main/docker-compose.yml
curl -L -o runtime/config/.env https://raw.githubusercontent.com/drchzy/quant/main/runtime/config/.env.example

# 建议先修改默认密码
vi runtime/config/.env

docker compose --env-file runtime/config/.env pull
docker compose --env-file runtime/config/.env up -d
```

### 访问地址

```text
Web: http://服务器IP:8088
```

默认登录：

```text
账号：admin
密码：quant123456
```

> 正式使用前请修改 `runtime/config/.env` 中的 `WEB_USERNAME` / `WEB_PASSWORD`，然后重新 `docker compose up -d`。

### 宿主机持久化目录

```text
runtime/
├─ config/
│  └─ .env
└─ data/
   ├─ market.duckdb
   ├─ select.duckdb
   └─ trade.duckdb
```

升级镜像不会删除 DuckDB 数据。

### 更新

```bash
docker compose --env-file runtime/config/.env pull
docker compose --env-file runtime/config/.env up -d
```

所有镜像当前发布平台：`linux/amd64`。


## 本镜像

```text
镜像：drchzy/quant-trade-manager:latest
内部端口：8091
数据库：/app/data/trade.duckdb
宿主机默认：runtime/data/trade.duckdb
依赖：quant-market-data + quant-stock-select
```

主要能力：

- 重点候选盘中每分钟监控
- 进入买入区 / 不追高 / 候选失效
- 手工确认真实买入价和数量
- 已有持仓手工录入
- A 股 T+1 约束
- 止损 / 两档止盈 / 移动止盈 / 时间退出
- 买卖成交手工确认
- 状态变化日志
- 已结束交易记录

> 本镜像不会自动连接券商，也不会自动下单。

## 常用配置

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `TRADE_MONITOR_ENABLED` | `true` | 是否开启盘中监控 |
| `TRADE_MONITOR_CRON` | `* * * * 1-5` | 工作日每分钟检查 |
| `TRADE_PLAN_SYNC_CRON` | `45 16 * * 1-5` | 收盘后同步明日重点计划 |
| `TRADE_MONITOR_TOP_COUNT` | `3` | 默认监控重点3只 |
| `TRADE_DEFAULT_STOP_PCT` | `3` | 手工持仓默认止损% |
| `TRADE_DEFAULT_TAKE_PROFIT1_PCT` | `4` | 第一止盈% |
| `TRADE_DEFAULT_TAKE_PROFIT2_PCT` | `6` | 第二止盈% |
