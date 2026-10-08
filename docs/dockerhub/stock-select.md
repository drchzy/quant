# Quant Stock Select｜A股超短趋势选股、复盘与回测服务

`quant-stock-select` 是 Quant 平台的策略层，读取 `market-data` 提供的行情数据，完成全市场过滤、趋势选股、每日候选、次日计划、策略复盘和参数回测。

## 镜像

```bash
docker pull __DOCKERHUB_USERNAME__/quant-stock-select:latest
```

镜像架构：

```text
linux/amd64
```

## 主要功能

- 全市场约 5000+ A 股技术过滤
- 默认排除北交所、科创板、ST / 退市股票
- 创业板保留
- MA5 / MA10 / MA20 多头趋势过滤
- 缩量回踩
- 放量突破
- 强势后首次回踩
- 趋势延续
- 技术评分
- Top10 候选
- 重点3只
- 次日买入区、不追价、止损、两档止盈、移动止盈
- 历史候选自动复盘
- 胜率、盈亏比、最大回撤统计
- 历史参数回测

## 依赖

本服务依赖：

```text
quant-market-data
```

默认访问：

```text
http://market-data:8080
```

推荐直接运行完整 `docker-compose.yml`。

## 推荐启动

```bash
git clone https://github.com/drchzy/quant.git
cd quant

cp .env.example .env
docker compose pull
docker compose up -d
```

服务地址：

```text
http://服务器IP:8090
```

健康检查：

```text
http://服务器IP:8090/health
```

Web 页面统一从：

```text
http://服务器IP:8088
```

访问。

## 单独启动

先保证 `market-data` 已经运行并可访问。

```bash
mkdir -p ./data

docker run -d \
  --name quant-stock-select \
  --restart unless-stopped \
  -p 8090:8090 \
  -e TZ=Asia/Shanghai \
  -e HOST=0.0.0.0 \
  -e PORT=8090 \
  -e SELECT_DATABASE_PATH=/app/data/select.duckdb \
  -e MARKET_DATA_URL=http://你的market-data地址:8080 \
  -e AUTO_SELECT_ENABLED=true \
  -e "SELECT_CRON=40 16 * * 1-5" \
  -v "$PWD/data:/app/data" \
  __DOCKERHUB_USERNAME__/quant-stock-select:latest
```

## 数据目录

```text
/app/data/select.duckdb
```

保存：

- 每日选股批次
- Top10候选
- 重点3只
- 次日交易计划
- 历史候选复盘
- 回测批次
- 参数比较结果

## 选股配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SELECT_DATABASE_PATH` | `/app/data/select.duckdb` | 策略数据库 |
| `MARKET_DATA_URL` | `http://market-data:8080` | 行情服务地址 |
| `AUTO_SELECT_ENABLED` | `true` | 是否自动选股 |
| `SELECT_CRON` | `40 16 * * 1-5` | 工作日自动选股时间 |
| `SELECT_TOP_COUNT` | `10` | 最终候选数量 |
| `SELECT_MAIN_COUNT` | `3` | 重点候选数量 |
| `SELECT_EXCLUDE_BSE` | `true` | 排除北交所 |
| `SELECT_EXCLUDE_STAR` | `true` | 排除科创板 |
| `SELECT_EXCLUDE_ST` | `true` | 排除ST/退市 |
| `SELECT_MIN_PRICE` | `3` | 最低股价 |
| `SELECT_MIN_AMOUNT` | `100000000` | 最低当日成交额 |
| `SELECT_MIN_MARKET_CAP` | `2000000000` | 最低总市值 |
| `SELECT_MAX_MARKET_CAP` | `100000000000` | 最高总市值 |
| `SELECT_MIN_TURNOVER` | `1` | 最低换手率 |
| `SELECT_MAX_TURNOVER` | `18` | 最高换手率 |
| `SELECT_MIN_PCT` | `-3` | 当日最低涨跌幅 |
| `SELECT_MAX_PCT` | `7` | 当日最高涨跌幅 |
| `SELECT_MIN_SCORE` | `55` | 最低策略分 |

## 次日交易计划配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PLAN_NO_CHASE_PCT` | `4` | 高于参考收盘约4%原则上不追 |
| `PLAN_TAKE_PROFIT_1_PCT` | `4` | 第一止盈 |
| `PLAN_TAKE_PROFIT_2_PCT` | `6` | 第二止盈 |
| `PLAN_MAX_LOSS_PCT` | `3` | 最大初始止损 |
| `PLAN_TRAILING_START_PCT` | `4` | 移动止盈启动涨幅 |
| `PLAN_TRAILING_DRAWDOWN_PCT` | `2` | 高点回撤保护比例 |
| `PLAN_MAX_POSITION_PCT` | `50` | 单票最大建议仓位 |
| `PLAN_TIME_STOP_DAYS` | `2` | 时间退出交易日数 |

## API

```text
GET  /health

GET  /api/v1/select/config
POST /api/v1/select/run
GET  /api/v1/select/latest
GET  /api/v1/select/ai

POST /api/v1/select/review/run
GET  /api/v1/select/review/summary
GET  /api/v1/select/review/latest

POST /api/v1/select/backtest
GET  /api/v1/select/backtests
GET  /api/v1/select/backtests/latest
```

## 自动执行时间

默认：

```text
16:10 market-data 更新当天行情
16:40 stock-select 先复盘历史候选，再运行当天选股
```

## 注意

本服务输出的是策略候选和执行计划，不保证收益，也不自动下单。

## 日志

```bash
docker logs -f quant-stock-select
```

## 项目地址

```text
https://github.com/drchzy/quant
```
