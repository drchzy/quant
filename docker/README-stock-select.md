# Quant Stock Select

A 股超短趋势选股、候选复盘和历史参数回测服务。

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
镜像：drchzy/quant-stock-select:latest
内部端口：8090
数据库：/app/data/select.duckdb
宿主机默认：runtime/data/select.duckdb
依赖：quant-market-data
```

主要能力：

- 全市场趋势过滤
- 默认排除北交所、科创板、ST
- 缩量回踩 / 放量突破 / 强势后首次回踩 / 趋势延续
- Top10 + 重点3只
- 次日买入区、止损、止盈和移动止盈计划
- 候选次日表现复盘
- 胜率、盈亏比、最大回撤统计
- 432 组退出参数回测

## 常用配置

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `AUTO_SELECT_ENABLED` | `true` | 是否自动选股 |
| `SELECT_CRON` | `40 16 * * 1-5` | 自动选股时间 |
| `SELECT_TOP_COUNT` | `10` | 候选数量 |
| `SELECT_MAIN_COUNT` | `3` | 重点候选数量 |
| `SELECT_EXCLUDE_BSE` | `true` | 排除北交所 |
| `SELECT_EXCLUDE_STAR` | `true` | 排除科创板 |
| `SELECT_EXCLUDE_ST` | `true` | 排除 ST |
| `SELECT_MIN_SCORE` | `55` | 最低评分 |
| `PLAN_MAX_LOSS_PCT` | `3` | 默认最大止损% |
| `PLAN_TAKE_PROFIT_1_PCT` | `4` | 第一止盈% |
| `PLAN_TAKE_PROFIT_2_PCT` | `6` | 第二止盈% |

所有筛选和执行参数都在 `runtime/config/.env` 中可修改。
