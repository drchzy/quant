# Quant

本地 A 股行情与量化研究平台。

当前已完成三层核心能力：**market-data 行情层** + **stock-select 超短趋势选股层** + **策略复盘/回测层**。

## 目录

```text
quant/
├─ services/
│  ├─ market-data/       # 行情采集、DuckDB、REST API、定时同步
│  └─ stock-select/      # 超短趋势选股、评分、次日计划
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
```

## 本地开发

需要 Node.js 20+。

```bash
npm install

# 行情服务
npm run dev:market-data

# 选股服务
npm run dev:stock-select

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
<DOCKERHUB_USERNAME>/quant-web
```

## 默认执行时间

```text
16:10  同步当天全市场行情
16:40  先复盘历史候选，再自动运行超短趋势选股
```

选股策略详细说明：

```text
docs/stock-select.md
```
