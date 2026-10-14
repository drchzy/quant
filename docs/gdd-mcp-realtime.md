# GDD MCP 实时行情与扩展能力

## 架构建议：后端直连上游 WS，MCP 保持 HTTP

Quant 单镜像内的 market-data 负责连接动态发现的 GDD `serverType=36` 行情 WS，不向 AI 客户端公开上游 IP 或会话。
同一 Node 进程复用一个 WS 连接，支持 `reqtype=200` 新订阅、`201` 取消、`202` 重连恢复，以及 `250` 行情快照、`251` 逐笔推送；20秒心跳，退避重连。
目前不将 `252` 经纪队列关联到股票，因为逆向文档缺少明确可验证的数据结构。MCP Streamable HTTP 工具只读取最新缓存，不保证向聊天窗口无限实时推送。

## MCP 新工具（加上原有11个共19个）

| 工具 | 用途 |
| --- | --- |
| `gdd_live_subscribe` | 后端WS订阅1～10个股票代码，type=1快照或2逐笔 |
| `gdd_live_snapshot` | 读取某证券5分钟有效期的实时内存缓存 |
| `gdd_live_status` | 查看WS连接状态、订阅、最近推送与错误 |
| `gdd_live_unsubscribe` | 取消某项上游订阅 |
| `gdd_batch_kline` | 1～10只股票，每只最多200根历史日K/3～120分钟K。默认预览，persist=true才写DuckDB |
| `gdd_simulate_trade_plan` | 100股一手、T+1的仓位/止损/止盈模拟；绝不发送真实订单 |
| `gdd_get_f10` | 旧F10六类白名单业务路径，必须提供准确GDD_INFO_BASE_URL |
| `gdd_get_news` | 旧资讯分类/列表/详情/分组4类路径，必须提供准确GDD_INFO_BASE_URL |

## 配置

```dotenv
GDD_ACCOUNT="你的账号"
GDD_PASSWORD="你的密码"
GDD_MCP_TOKEN="至少32字符独立随机令牌"
# 可选：旧信息服务地址目前文档未给出（见下方）
GDD_INFO_BASE_URL=""
```

不配置GDD_INFO_BASE_URL并不影响WS、K线、分时和已实现的插件查询。GDD上游服务器地址仍由登录及query_server_info自动获取，15分钟缓存，异常重连重新发现。

## 实时订阅示例

调用 gdd_live_subscribe：
```json
{"codes":["300505","600186"],"type":1}
```
随后调用 gdd_live_snapshot：
```json
{"code":"300505","type":1}
```
状态对象会包含 `subscribed`、`connected`、`latest`、`ageMs`、`stale`；非交易时段没有新推送不等同于连接故障。

## 批量日K入库

```json
{"codes":["300505","300605"],"period":10,"count":120,"persist":false}
```
先预览然后显式指定 `persist:true`。支持的period为2/3/4/5/6/7/10，历史日K写入daily_price，分钟K写入minute_price，source=gdd。返回每只股票成功/失败和实际入库数量，避免部分失败时误报成功。

## F10和资讯的剩余验证条件

用户提供的APK逆向文档确定了 `/f10/profile/query_profile`、`/f10/feature/{balance_info,cash_info,rate_info,income_info,summary_info}` 和 `/news/{getGroupNews,getCategory,getNews,getNewsDetail}`，但**未确定 `ServerManager.getServerPath()` 的生产基址、HTTP Method 和完整参数**。因此本次只能提供不猜测地址的受控适配框架；未配置 `GDD_INFO_BASE_URL` 时主动报错，不会伪造F10/新闻数据，配置后仍须实测响应字段。

## 实盘自动下单

现有逆向资料只有GDD行情/辅助选股协议，没有券商的委托/撤单/成交回报协议。**本版本没有真实自动交易功能**；只有 `gdd_simulate_trade_plan`，返回 `noOrderSubmitted=true`，按A股T+1和用户设定仓位计算风险。真实交易需要合法券商接口、明确授权与风控实现，不能假装下单成功。

## 测试与安全

CI通过本地模拟WS网关测试复用、订阅、250/251推送解析、取消订阅、输入校验；Docker继续单镜像单容器8088。真实GDD的全部上游接口仍需账户联调。
只通过HTTPS访问 `https://你的域名/mcp`，Bearer访问令牌与GDD账号密码分离。不要把没有统一认证的Quant 8088整个端口暴露到公网。上游GDD ws://与登录http://仍为明文，需可信网络。
