# GDD 行情插件接口目录（来自客户端静态逆向）

## 网关与报文

- 通过 `GDD_ACCOUNT/GDD_PASSWORD` 登录取得 sessionCode，查询 `query_server_info` 获得 `serverType=36` 的动态网关；不再依赖固定 IP。
- 行情插件 POST 的 HTTP Path 为 `/`，外层报文用大写的 `{"ReqType":1201,"ReqID":1,"Data":{}}`。
- K线与分时使用**另一种报文结构**：`{"reqtype":150,"reqid":1,"session":"","data":{...}}`。
- 目前 `services/market-data/src/gdd-plugin.ts` 有白名单命令映射与内部动态发送器。**尚未得到以下命令的完整 Data 结构，未接入对外 API、同步任务或数据库；不可把空 Data 当成有效请求**。
- 龙虎榜 3002/3003 的服务路由可能经 serverType=35（LhbPlugin）。需要按该服务端口/协议单独验证，暂未放入统一网关命令发送白名单。

## 插件命令

| 内部命令 | ReqType | 数据 |
|---|---:|---|
| fundFlow | 1200 | 商品资金流向 |
| blockData | 1201 | 板块明细 |
| blockMerchRank | 1202 | 板块商品排行 |
| blockRank | 1203 | 板块排行 |
| blockSymbolRankingByCycle | 1225 | 周期板块商品排行 |
| chooseStocks | 1207 | 智能选股池 |
| riseFall | 1260 | 涨跌家数 |
| dragons | 1264 | 龙头列表 |
| limitUpDown | 1274 | 涨跌停板 |
| indexParams | 1279 | 指标参数 |
| capitalTrend | 1282 | 当日资金流向走势 |
| shortLine | 1287 | 短线精灵 |
| merchAuction | 1403 | 集合竞价 |
| bigStrategy | 1417 | 大盘策略 |
| relatedBlock | 1421 | 个股所属板块 |
| statisticsRange | 1427 | 统计区间 |

## 其它接口定位

业务域名基础地址：`http://120.76.229.148:1080`，例如：
- `POST /investment-adviser/customer/login`
- `POST /investment-adviser/config/query_server_info`
- `POST /investment-adviser/auth/right_list`
- `POST /investment-adviser/auth/queryPermission`
- `POST /investment-adviser/advert/list`
- `POST /investment-adviser/liveTeacher/view`
- `POST /investment-adviser-live/live/list`

大部分登录态业务接口的 JSON 请求体尚未补全，暂不纳入 Quant 采集任务。
因子排序使用 serverType=512/1024 单独端点；龙头 CMS 使用 `https://gdd.gddtxcf.com/cms/api/info/list`。这些不属于 0x24 HTTP 根路径，不能混用。

安全：禁止在 Quant 对外 HTTP API 直接暴露可随意提交 `ReqType/Data` 的通用转发服务，避免无鉴权行情网关被任意利用；调用应由服务端按具体业务语义、参数规则实现。
