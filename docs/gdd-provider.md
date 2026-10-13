# GDD 行情 Provider（动态网关发现）

Quant 在现有 market-data 模块内提供 GDD 可选行情源，不新增容器或端口；Web 统一入口仍为 8088。

## 使用方式

只需在**宿主机** \`web/.env\` 配置这两个参数（不要把真实密码提交到 GitHub）：

\`\`\`dotenv
GDD_ACCOUNT="<GDD登录账号>"
GDD_PASSWORD="<GDD登录明文密码>"
\`\`\`

重启 Quant：\`docker restart quant\`，在“数据同步 → 数据源管理”启用 GDD，再测试 daily/分钟K。

### 自动登录与动态网关

每次缓存到期（15分钟）或网关连接失败时：

1. 使用 GDD_ACCOUNT/GDD_PASSWORD 登录业务地址 \`http://120.76.229.148:1080/investment-adviser/customer/login\`，密码默认以明文发送（与实际客户端抓包一致）。其他固定字段：orgCode=0007，loginType=1。
2. 自动生成设备 UUID，首次使用写入 \`web/data/.gdd-device-id\`。容器重建后保留同一设备 ID；无需配置 GDD_DEVICE。
3. 从登录响应提取 sessionCode（仅在内存中），调用 \`/investment-adviser/config/query_server_info\`（请求头与 body 同时携带 sessionCode）。
4. 在 \`result.sers\` 中找到 \`serverType=36\`（0x24）并验证 IPv4 + 端口。
5. 将行情 HTTP 请求发送至该地址的 \`/\`；行情 JSON 保持 \`session:""\`。
6. 网关地址缓存15分钟；连接超时、HTTP 502/503/504 等可重试故障将清除缓存、重新登录并查询地址后**最多重试一次**。

**不再从 GDD_GATEWAY_URL/GDD_SESSION_CODE 读取静态地址或旧会话，不允许缺少登录凭据时直连上一次记录的 IP。** 原有配置中若还有这两个旧变量，可删除。业务接口基址默认固定，只有部署网络特殊时才需覆盖 GDD_BUSINESS_URL。

业务服务使用明文 HTTP，网络传输凭据可能被窃听。请在可信网络中部署，或配置可信 TLS 反向代理；限制宿主机 \`web/.env\` 和 \`web/data/.gdd-device-id\` 文件权限。不要在日志和工单中张贴 sessionCode。

## 行情能力

| 功能 | ReqType | 说明 |
|---|---:|---|
| 日K和历史周期K线 | 150 | marketCode，二维表头、OHLC 校验后入库 |
| 历史/指定日期分时 | 152 | day、timetype=0、timevalue0=90、timevalue1=420 |
| 分笔成交 | 151 | 命令已知，尚未实现接口与持久化 |
| WebSocket 实时订阅 | 200/201/202 | 命令已知，尚未启用服务端实时长连 |

市场编码：创业板 300/301 对应 market=1008；深证主板 1001、上证A股 1、科创板 7 为服务器下发的候选映射，仍需逐票验证。

插件行情 ReqType 与方法名见 \`docs/gdd-plugin-api.md\`；**请求体 Data 仍需从 RequestUtils 构造器核实**。没有为客户端暴露任意参数透传接口，避免将上游无鉴权服务变成公共代理。

## 检查

- \`GET /api/v1/data-sources\`：GDD 条目中的 available 只有配置两项凭据后才为 true。
- \`POST /api/v1/data-sources/test\`，JSON：\`{"source":"gdd","capability":"daily"}\`
- \`GET /api/v1/stocks/300505/daily?days=5&refresh=true\`：走当前启用源顺序。
- \`GET /api/v1/gdd/trend/300505?day=2026-10-13\`：GDD 历史分时专用读取，需启用。

由于实盘 K 线和分时的完整表头尚未在当前对话中提供，解析器按已知表头名称严格识别、校验，无法识别字段即报错、不会猜测写库。CI 对登录、设备持久化、网关动态变化和解析逻辑使用模拟响应，不代表上游实时业务可达。
