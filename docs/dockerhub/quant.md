# Quant｜A股本地行情、选股、回测与盘中执行平台

Quant 默认提供 **All-in-One 单镜像**：

```text
__DOCKERHUB_USERNAME__/quant:0.4.0-build.<构建号>
```

镜像架构：

```text
linux/amd64
```

一个镜像内包含：

- market-data：东方财富行情、日K、分钟K、板块、DuckDB
- stock-select：全市场选股、Top10、重点3只、复盘、参数回测
- trade-manager：持仓、T+1、止损、止盈、移动止盈、盘中执行
- Web：统一管理页面和反向代理

## 一个端口

宿主机只需要开放：

```text
8088
```

访问：

```text
http://服务器IP:8088
```

内部三个 API 服务只监听容器本机：

```text
127.0.0.1:8080  market-data
127.0.0.1:8090  stock-select
127.0.0.1:8091  trade-manager
```

不会暴露到宿主机。

## 最简单启动

```bash
mkdir -p web

docker run -d \
  --name quant \
  --restart unless-stopped \
  -p 8088:8088 \
  -v "$PWD/web:/app/web" \
  __DOCKERHUB_USERNAME__/quant:0.4.0-build.<构建号>
```

第一次启动后会自动生成：

```text
web/
├─ .env
└─ data/
   ├─ market.duckdb
   ├─ select.duckdb
   └─ trade.duckdb
```

也就是说，**配置和所有数据库都在一个目录**。

## Docker Compose

项目已经提供单容器 Compose：

```bash
git clone https://github.com/drchzy/quant.git
cd quant/web

docker compose pull
docker compose up -d
```

然后访问：

```text
http://服务器IP:8088
```

## 配置文件

配置文件：

```text
web/.env
```

修改后：

```bash
docker restart quant
```

主要参数如下。

### 行情

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `TZ` | `Asia/Shanghai` | 时区 |
| `SYNC_ENABLED` | `true` | 自动同步行情 |
| `DAILY_SYNC_CRON` | `10 16 * * 1-5` | 工作日16:10同步 |
| `EASTMONEY_TIMEOUT_MS` | `10000` | 东财请求超时 |
| `EASTMONEY_PAGE_SIZE` | `500` | 全市场分页大小 |

### 选股

| 配置 | 默认值 |
| --- | ---: |
| `SELECT_CRON` | `40 16 * * 1-5` |
| `SELECT_TOP_COUNT` | 10 |
| `SELECT_MAIN_COUNT` | 3 |
| `SELECT_EXCLUDE_BSE` | true |
| `SELECT_EXCLUDE_STAR` | true |
| `SELECT_EXCLUDE_ST` | true |
| `SELECT_MIN_PRICE` | 3 |
| `SELECT_MIN_AMOUNT` | 100000000 |
| `SELECT_MIN_MARKET_CAP` | 2000000000 |
| `SELECT_MAX_MARKET_CAP` | 100000000000 |
| `SELECT_MIN_TURNOVER` | 1 |
| `SELECT_MAX_TURNOVER` | 18 |
| `SELECT_MIN_PCT` | -3 |
| `SELECT_MAX_PCT` | 7 |
| `SELECT_MIN_SCORE` | 55 |

### 次日交易纪律

| 配置 | 默认值 |
| --- | ---: |
| `PLAN_NO_CHASE_PCT` | 4 |
| `PLAN_TAKE_PROFIT_1_PCT` | 4 |
| `PLAN_TAKE_PROFIT_2_PCT` | 6 |
| `PLAN_MAX_LOSS_PCT` | 3 |
| `PLAN_TRAILING_START_PCT` | 4 |
| `PLAN_TRAILING_DRAWDOWN_PCT` | 2 |
| `PLAN_MAX_POSITION_PCT` | 50 |
| `PLAN_TIME_STOP_DAYS` | 2 |

### 盘中执行

| 配置 | 默认值 |
| --- | --- |
| `TRADE_MONITOR_ENABLED` | true |
| `TRADE_MONITOR_CRON` | `* * * * 1-5` |
| `TRADE_PLAN_SYNC_CRON` | `45 16 * * 1-5` |
| `TRADE_MONITOR_TOP_COUNT` | 3 |
| `TRADE_DEFAULT_STOP_PCT` | 3 |
| `TRADE_DEFAULT_TAKE_PROFIT1_PCT` | 4 |
| `TRADE_DEFAULT_TAKE_PROFIT2_PCT` | 6 |
| `TRADE_DEFAULT_TRAILING_START_PCT` | 4 |
| `TRADE_DEFAULT_TRAILING_DRAWDOWN_PCT` | 2 |
| `TRADE_DEFAULT_TIME_STOP_DAYS` | 2 |

## 数据文件

```text
web/data/market.duckdb
web/data/select.duckdb
web/data/trade.duckdb
```

备份只需要：

```bash
tar -czf quant-backup.tar.gz web/
```

## 首次使用

1. 打开 `http://服务器IP:8088`
2. 进入“数据同步”
3. 同步今日市场
4. 同步板块
5. 初始化历史日K，建议至少120个交易日
6. 进入“每日选股”运行第一次选股
7. 第二天使用“盘中执行”

## 自动时间

```text
09:30-11:30 / 13:00-15:00
盘中每分钟监控重点候选和持仓

16:10
同步当天市场

16:40
复盘历史候选并自动选股

16:45
同步明日重点3只执行计划
```

## 更新

```bash
docker pull __DOCKERHUB_USERNAME__/quant:0.4.0-build.<构建号>
docker restart quant
```

使用 Compose：

```bash
docker compose pull
docker compose up -d
```

## 健康检查

```text
http://服务器IP:8088/health
```

## 注意

本平台用于行情研究、策略筛选、复盘和执行纪律辅助，不保证收益；trade-manager 不会自动连接券商下单。

## GitHub

```text
https://github.com/drchzy/quant
```


## 镜像版本规则

从 0.4.0 开始，每次 GitHub Actions 发布都会生成新的不可变版本标签：

```text
<基础版本>-build.<GitHub构建号>
```

例如：

```text
0.4.0-build.120
0.4.0-build.121
0.4.0-build.122
```

同一次发布还会附带：

```text
latest
sha-<commit>
```

推荐：

- 正式环境固定使用 `0.4.0-build.xxx`，方便升级和回滚。
- `latest` 只用于希望始终跟随最新版本的环境。
- 每次发布都会产生新的版本号，不覆盖旧的版本标签。


## 行情网络稳定性配置

东方财富 `push2/push2his` 存在 IP 级风控，因此镜像内默认：

- 实时行情优先 `push2delay.eastmoney.com`。
- 东财所有请求共用全局限速队列。
- 全市场快照缓存 60 秒。
- 板块缓存 5 分钟。
- 日K/分钟K在东财历史接口失败时自动切换腾讯财经备用源。
- 市场总览实时源失败时回退 DuckDB，不直接返回 500。

可调参数：

| 配置 | 默认值 | 说明 |
| --- | ---: | --- |
| `EASTMONEY_MIN_INTERVAL_MS` | 1000 | 东财请求最小间隔 |
| `EASTMONEY_RETRY_COUNT` | 2 | 单主机重试次数 |
| `EASTMONEY_RETRY_BASE_MS` | 1500 | 指数退避基础时间 |
| `EASTMONEY_PAGE_SIZE` | 100 | push2delay 全市场分页 |
| `MARKET_CACHE_TTL_MS` | 60000 | 全市场实时快照缓存 |
| `SECTOR_CACHE_TTL_MS` | 300000 | 板块缓存 |
| `QUOTE_CACHE_TTL_MS` | 5000 | 个股实时行情缓存 |
| `TREND_CACHE_TTL_MS` | 10000 | 个股分时缓存 |
| `FALLBACK_MIN_INTERVAL_MS` | 300 | 腾讯备用源最小间隔 |
| `FALLBACK_RETRY_COUNT` | 1 | 腾讯备用源重试次数 |

诊断：

```text
http://服务器IP:8088/api/v1/market/source-status
```
