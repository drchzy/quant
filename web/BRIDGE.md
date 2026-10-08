# Quant 外部行情采集桥接

当 Quant 服务器无法直接访问东方财富，而局域网内另一台电脑可以访问时，使用该电脑的浏览器采集并推送行情。

## 一、服务端开启写入

在**服务器宿主机**已有的 `web/.env` 中添加并设置随机长令牌：

```env
BRIDGE_IMPORT_TOKEN="自己生成至少16位的随机长字符串"
```

> 默认留空时导入 API 完全禁用（HTTP 503）。令牌不要提交到 GitHub，不要复制到公开网页或截图。若面向公网，建议使用 HTTPS、访问控制和限制写入来源地址。

重启 Quant 容器（不删除数据库）：

```bash
docker compose -f web/docker-compose.yml up -d --force-recreate
```

## 二、在能访问东方财富的电脑上采集

浏览器打开：

```text
http://服务器IP:8088/bridge.html
```

- 填写服务器地址（默认本页面同源）与令牌，点击“测试接收接口”。
- 勾选需要的类型：全市场快照、日 K、分钟 K、分时、行业/概念、主要指数。
- 股票范围支持全部，或通过 `600186`、`贵州茅台` 等股票代码/名称选择。按名称搜索依赖 Quant 已有股票数据，若没有则扫描东财快照。
- 日 K、分钟 K 可指定日期范围，分钟 K 支持 1、5、15、30、60 分钟周期；上游历史分钟及分时数据通常有时间窗口限制。
- 配置请求间隔（建议 1000ms 以上）、失败重试、每批写入条数、最多处理股票数。
- 浏览器需保持页面打开，支持暂停/继续/停止；刷新或关闭页面会中断未完成的任务。
- 采集端使用东财 HTTPS JSONP 脚本查询，服务器端只接收上传，**服务器不直接访问东财**。受上游风控影响，部分接口可能禁用 JSONP、断连或返回空值，页面会记录失败。

## 三、接收接口

请求头：

```http
Content-Type: application/json
X-Bridge-Token: <服务器配置的令牌>
```

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/api/v1/bridge/status` | GET | 校验令牌和查询六张表当前条数 |
| `/api/v1/bridge/import` | POST | 校验并批量 UPSERT 到 DuckDB |
| `/bridge.html` | GET | 浏览器外部采集页面 |

单批 1–200 条，单次请求体不超过 1 MiB，可多次上传；相同主键重复推送将更新记录。

```bash
curl -X POST http://服务器IP:8088/api/v1/bridge/import \
  -H 'Content-Type: application/json' \
  -H 'X-Bridge-Token: 你的令牌' \
  -d '{"type":"daily","rows":[{"code":"600186","name":"莲花控股","date":"2026-10-08","open":12.1,"close":12.3,"high":12.5,"low":12,"volume":12345}]}'
```

支持 `type`：

| 类型 | 主键 | 数据位置 |
| --- | --- | --- |
| `snapshot` | code、tradeDate | stock + daily_price |
| `daily` | code、date | stock + daily_price |
| `minute` | code、period、tradeTime | stock + minute_price |
| `intraday` | code、tradeTime | stock + intraday_trend |
| `sector` | type、code | sector |
| `index` | code | market_index |

示例请求：

```json
{
  "type": "minute",
  "rows": [
    {
      "code": "600186",
      "name": "莲花控股",
      "period": 5,
      "tradeTime": "2026-10-08 14:55",
      "open": 12.4,
      "close": 12.5,
      "high": 12.5,
      "low": 12.3,
      "volume": 5000,
      "amount": 62000
    }
  ]
}
```

## 四、注意事项

- 本功能**不改变数据源勾选优先级**。它是额外的数据导入通道，写入与本地数据表共用的 DuckDB；不会强行开启被禁用的东财 Provider。
- 快照与日 K 共享 `daily_price`，使用各自日期作为主键；分时独立于分钟 K，避免两个来源覆盖同一个时间点。
- 导入接口只保证写入受限白名单表；不提供任意 SQL 执行。
- 建议在公网环境启用 HTTPS；使用非 HTTPS 的外部网页访问局域网 HTTP 接口可能被浏览器拦截。推荐直接打开 Quant 内置的 HTTP 页面。
