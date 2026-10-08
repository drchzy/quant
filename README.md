# Quant

本地 A 股行情与量化研究平台。

当前已完成完整闭环：**market-data 行情层** + **stock-select 选股/复盘/回测层** + **trade-manager 持仓/盘中执行层**。

## 目录

```text
quant/
├─ services/
│  ├─ market-data/       # 行情采集、DuckDB、REST API、定时同步
│  ├─ stock-select/      # 超短趋势选股、评分、复盘、回测
│  └─ trade-manager/     # 持仓、盘中监控、执行状态、T+1约束
├─ apps/
│  └─ web/               # 本地行情与管理页面
├─ docs/
│  └─ architecture.md    # 架构说明
├─ docker-compose.yml
└─ .github/workflows/    # CI 与 Docker Hub 发布
```

## 当前数据源

东方财富：

- `eastmoney-data-sdk`
- 东财公开 HTTP 接口

当前支持：

- 全 A 股基础行情
- 实时行情
- 历史日 K
- 1/5/15/30/60 分钟 K
- 当日分时
- 主要指数
- 行业板块
- 概念板块
- DuckDB 本地保存
- 每日自动增量同步
- Web 页面
- AI 聚合查询接口
- 全市场技术指标
- 超短趋势自动选股
- Top10 候选 + 重点3只
- 次日买入区、止损、止盈、移动止盈计划
- 候选次日表现自动复盘
- 胜率、盈亏比、最大回撤统计
- 历史参数回测与止盈止损参数建议
- 次日重点候选盘中每分钟监控
- 已有持仓手工录入
- 买入/卖出成交手工确认
- A股T+1卖出限制
- 移动止盈、止损、时间退出实时状态

## Docker Compose 启动

```bash
cp .env.example .env
docker compose up -d --build
```

打开：

- Web: `http://localhost:8088`
- API: `http://localhost:8080`
- 健康检查: `http://localhost:8080/health`

DuckDB 数据保存在：

```text
./data/market.duckdb   # 行情数据
./data/select.duckdb   # 选股、复盘、回测数据
./data/trade.duckdb    # 交易计划、持仓、状态变化和交易记录
```

## 本地开发

需要 Node.js 20+。

```bash
npm install

# 行情服务
npm run dev:market-data

# 选股服务
npm run dev:stock-select

# 持仓与盘中执行
npm run dev:trade-manager

# 前端
npm run dev:web
```

## 第一次使用

1. 打开“数据同步”页面。
2. 点击“同步今日市场”。
3. 点击“同步板块”。
4. 执行“初始化历史日 K”（建议至少120个交易日）。
5. 打开“每日选股”，执行第一次选股。
6. 下一个交易日数据同步后，“策略复盘”会自动产生真实候选表现。

历史初始化默认 120 个交易日，属于一次性重任务。

之后工作日收盘后会按配置自动增量同步。

## AI 查询接口

市场：

```text
GET /api/v1/ai/market
```

个股：

```text
GET /api/v1/ai/stock/600186
```

每日选股：

```text
GET /api/v1/select/ai
```

手动执行选股：

```text
POST /api/v1/select/run
```

策略复盘：

```text
GET  /api/v1/select/review/summary
GET  /api/v1/select/review/latest
POST /api/v1/select/review/run
```

参数回测：

```text
POST /api/v1/select/backtest
GET  /api/v1/select/backtests/latest
```

盘中执行：

```text
GET  /api/v1/trading/today
POST /api/v1/trading/refresh
POST /api/v1/trading/plans/:id/buy
POST /api/v1/trading/plans/:id/sell
POST /api/v1/trading/positions
GET  /api/v1/trading/ai
```

详细设计见：

```text
docs/architecture.md
```

## Docker Hub

仓库已准备 Docker Hub 发布工作流。

在 GitHub 仓库 Secrets 配置：

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

然后手动运行：

`Publish Docker Images`

或推送 `v*` 标签。

发布镜像：

```text
<DOCKERHUB_USERNAME>/quant-market-data
<DOCKERHUB_USERNAME>/quant-stock-select
<DOCKERHUB_USERNAME>/quant-trade-manager
<DOCKERHUB_USERNAME>/quant-web
```

## 默认执行时间

```text
09:30-11:30 / 13:00-15:00
       trade-manager 每分钟检查重点候选和持仓

16:10  同步当天全市场行情
16:40  先复盘历史候选，再自动运行超短趋势选股
16:45  trade-manager 同步明日重点3只执行计划
```

选股策略详细说明：

```text
docs/stock-select.md
```


## 执行原则

trade-manager **不会自动下单**。

进入买入区后只产生“可买”提示，用户实际成交后需要点击“确认买入”；触发止损、止盈或移动止盈时只产生“可卖”提示，实际卖出后点击“确认卖出”。

A股普通股票按 T+1 处理：当天确认买入的仓位，当天即使触发止损/止盈，也只提示 `T+1锁定风险`，不会显示为可执行卖出。

节假日或停牌时，如果东方财富分时数据不是当天日期，trade-manager 不改变计划状态，也不会把计划误判为过期。
