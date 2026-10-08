# market-data

本地 A 股行情数据服务。

## 数据源

当前只接东方财富：

- `eastmoney-data-sdk`：日 K、分钟 K、分时、单股实时行情。
- 东财公开 HTTP 接口：全市场扩展字段、行业板块、概念板块。

## 已提供接口

```text
GET  /health

GET  /api/v1/market/overview
GET  /api/v1/market/stocks
GET  /api/v1/sectors

GET  /api/v1/stocks/search
GET  /api/v1/stocks/:code
GET  /api/v1/stocks/:code/quote
GET  /api/v1/stocks/:code/daily
GET  /api/v1/stocks/:code/minute
GET  /api/v1/stocks/:code/intraday

POST /api/v1/sync/daily
POST /api/v1/sync/sectors
POST /api/v1/sync/history
GET  /api/v1/sync/jobs

GET  /api/v1/ai/market
GET  /api/v1/ai/stock/:code
```

## 数据库

默认使用：

```text
data/market.duckdb
```

分钟数据只在查询候选股或持仓时保存，不保存全市场每一分钟的数据。
