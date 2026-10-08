# trade-manager

次日交易计划、持仓和盘中监控服务。

## 服务边界

trade-manager：

- 不选股。
- 不直接访问东方财富。
- 不直接读取 market-data 或 stock-select 的 DuckDB。
- 不连接券商。
- 不自动下单。

它只通过 HTTP API 获取：

- stock-select 的重点候选和计划。
- market-data 的实时行情与分时。

然后生成盘中执行状态和风险提示。

## 状态

```text
waiting       等待触发
buy_ready     进入计划买入区
no_chase      超过不追价
invalid       买入前跌破止损，候选失效

holding       已确认买入
trailing      移动止盈已启动
t1_locked     买入当天触发风险，但受T+1限制不能卖
sell_ready    已触发可执行卖出条件

closed        已确认卖出
expired       当日没有买入，计划过期
```

## 盘中信号

- BUY：进入买入区。
- NO_CHASE：超过不追价。
- HOLD：继续持有。
- TAKE_PROFIT_1：达到第一止盈。
- TAKE_PROFIT_2：达到第二止盈。
- TRAILING_ACTIVE：移动止盈启动。
- TRAILING_STOP：触及移动保护价。
- STOP_LOSS：触及止损。
- TIME_EXIT：达到时间退出条件。
- T1_LOCKED_RISK：买入当天触发退出条件，但A股T+1不能卖。

## 手工确认

系统不会假设用户已经成交。

进入 BUY 状态后，必须调用“确认买入”。

卖出同样必须调用“确认卖出”。

这可以保证页面状态和实际账户尽量一致。

## API

```text
GET  /health

GET  /api/v1/trading/today
POST /api/v1/trading/sync-plans
POST /api/v1/trading/refresh
POST /api/v1/trading/expire

POST /api/v1/trading/plans/:id/buy
POST /api/v1/trading/plans/:id/sell

POST /api/v1/trading/positions
GET  /api/v1/trading/history
GET  /api/v1/trading/events

GET  /api/v1/trading/ai
```
