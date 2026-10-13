# GDD 行情 Provider（实验性）

GDD 为市场数据服务增加一个**可选、默认关闭**的数据源，兼容单镜像、单容器、统一 8088 端口。

## 已接入

- HTTP K线：向动态下发的行情网关根路径 POST JSON，reqtype=150；支持日K，以及 5/15/30/60 分钟K请求。
- HTTP 历史分时：reqtype=152（timevalue0=90、timevalue1=420），可通过页面的盘中读取或 GET /api/v1/gdd/trend/300505?day=2026-10-13 获取。
- 自动发现：sessionCode 或账号密码登录后，从 /investment-adviser/config/query_server_info 的 result.sers 中选 serverType=36，而非 serverId。
- 股票编码：300/301 开头为创业板 market=1008。其余 A 股编号按下发的 ums.marketCode 做初步映射，但**未逐一现场验证**。
- K线、分时结果为二维数组，首行是表头、数据从索引1开始。解析时根据表头名称识别字段并验证 OHLC；**无法识别就报错，不猜列序、不写库**。
- 用户在“数据同步 → 数据源管理”选择 GDD、测试 daily、配置优先级，然后可同步指定股票历史日K（优先级由用户决定）。GDD 失败时按原有 Provider 顺序降级。
- 实时 WebSocket（reqtype=200/250/251）与分笔 reqtype=151 暂未接入，不标记为已验证。

## 配置

修改宿主机 web/.env，重启 Quant：

```dotenv
# 直连已测试网关（不配置登录凭据也能发送 session="" 的行情请求）
GDD_GATEWAY_URL="http://8.129.13.151:19920/"
# 动态网关发现两种方式：已有 sessionCode；或者账号密码、设备 UUID
GDD_SESSION_CODE=""
GDD_ACCOUNT=""
GDD_PASSWORD=""
GDD_DEVICE=""
GDD_PASSWORD_MODE="plain"
GDD_VERSION_NUMBER="1.20.0"
GDD_SYSTEM_TYPE="Android"
GDD_BUSINESS_URL="http://120.76.229.148:1080"
GDD_TIMEOUT_MS="12000"
```

当 GDD_SESSION_CODE 非空时查询服务器清单；否则如果账号、密码、设备 UUID 均有值，则先登录再查询服务器清单。均不满足时使用 GDD_GATEWAY_URL。网关发现结果缓存30分钟。

**安全提醒：**原接口是明文 HTTP，包含密码或 sessionCode 的请求有窃听风险；只在可信网络中使用，建议通过受控代理或 HTTPS 网关，不要将真实密码、sessionCode 或设备UUID提交至 GitHub。web/.env 在部署中应限制读权限。

## API 与诊断

- GET /api/v1/data-sources：读取 GDD 的启用状态、能力和优先级
- PUT /api/v1/data-sources：保存启用状态和排序
- POST /api/v1/data-sources/test：`{"source":"gdd","capability":"daily"}`
- GET /api/v1/stocks/300505/daily?days=5&refresh=true：经过数据源优先级获取日K并保存 DuckDB
- GET /api/v1/gdd/trend/300505?day=2026-10-13：GDD 启用时请求历史分时

因为上游尚未提供真实 kline 和 trend 的首行表头样例，当前解析支持标准中英文列名。若测试返回“GDD 表头无法匹配字段”，请只提供 **data.kline[0]** 或 **data.trend[0]**（不包含凭据），以便精确确定真实列位。不会在字段不确定时采用错误的价格或成交量。

未启用 GDD 不影响新浪、腾讯和现有东财同步。默认优先级新浪10、腾讯20、GDD25、东方财富数据中心30、东方财富行情40、Tushare50。GDD 默认关闭。
