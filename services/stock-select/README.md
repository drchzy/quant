# stock-select

收盘后自动选股服务。

## 职责

- 从 market-data 获取全市场技术指标。
- 按固定规则过滤约5000只A股。
- 计算超短趋势评分。
- 保存每日候选和前三名重点候选。
- 为每只候选生成次日执行计划。
- 工作日16:40自动运行。
- 给 Web 和 AI 提供统一接口。

## 默认策略

默认排除：

- 北交所
- 科创板
- ST / 退市股票

核心趋势：

- 收盘价 > MA5 > MA10 > MA20
- MA5向上
- MA10不向下

优先形态：

1. 缩量回踩MA5
2. 放量接近/突破前20日高点
3. 强势上涨后的首次回踩
4. 普通趋势延续

## API

```text
GET  /health

GET  /api/v1/select/config
POST /api/v1/select/run
GET  /api/v1/select/latest
GET  /api/v1/select/runs
GET  /api/v1/select/runs/:id
GET  /api/v1/select/ai
```

## 次日计划

每只候选都会生成：

- 计划买入区间
- 不追高价格
- 止损价
- 第一止盈
- 第二止盈
- 移动止盈启动涨幅
- 高点回撤退出比例
- 最大单票仓位
- 时间止损
