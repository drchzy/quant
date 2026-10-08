# Quant Market Data

A 股本地行情数据服务。负责东方财富行情采集、DuckDB 持久化和统一查询 API。

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
镜像：drchzy/quant-market-data:latest
内部端口：8080
数据库：/app/data/market.duckdb
宿主机默认：runtime/data/market.duckdb
```

主要能力：

- 全 A 股基础行情
- 实时行情
- 日 K、1/5/15/30/60 分钟 K
- 当日分时
- 大盘指数
- 行业/概念板块
- 全市场技术指标
- 工作日收盘后自动增量同步

## 常用配置

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `TZ` | `Asia/Shanghai` | 时区 |
| `SYNC_ENABLED` | `true` | 是否开启自动同步 |
| `DAILY_SYNC_CRON` | `10 16 * * 1-5` | 每日行情同步 |
| `EASTMONEY_TIMEOUT_MS` | `10000` | 东财请求超时毫秒 |
| `EASTMONEY_PAGE_SIZE` | `500` | 全市场分页大小 |
| `MARKET_DATA_PORT` | `8080` | 宿主机端口 |
| `BACKEND_BIND_IP` | `127.0.0.1` | 默认仅本机访问后端 |

## 健康检查

```bash
curl http://127.0.0.1:8080/health
```

更多文档见 GitHub：`drchzy/quant`。
