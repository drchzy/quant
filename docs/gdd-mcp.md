# Quant GDD MCP Server（只读、Streamable HTTP）

这套 MCP Server 与 Quant 的 market-data 共享 Node.js 进程，**不增加容器和对外端口**；入口使用 Nginx 统一端口 `8088`。

MCP SDK 使用 **@modelcontextprotocol/server v2** 和 Streamable HTTP。没有配置专用令牌时直接返回503，既不会自动开放服务，也不会泄露 GDD 账号、密码或 sessionCode。

## 1. 启用服务

修改宿主机 `web/.env` 文件（镜像默认文件不包含你的真实凭据）：

```dotenv
GDD_ACCOUNT="GDD账号"
GDD_PASSWORD="GDD密码"
# 单独生成的随机访问令牌，至少32字符
GDD_MCP_TOKEN="在此填写 openssl rand -hex 32 生成的值"
# 可选：仅当浏览器JS页面需要访问时才添加可信Origin
GDD_MCP_ALLOWED_ORIGINS=""
```

生成令牌（请只在宿主机执行）：

```bash
openssl rand -hex 32
```

修改后在项目 `web` 目录重建/重启容器：

```bash
docker compose pull
docker compose up -d
```

在“数据同步 → 数据源管理”勾选 GDD、保存。服务器后台会在首次真实行情查询时自动登录GDD、生成并持久化设备UUID，再从 `query_server_info` 动态下发的清单中选择 `serverType=36`（龙虎榜是35）。不会读取固定行情IP兜底。

## 2. MCP URL 与安全

- 容器本机调试：`http://127.0.0.1:8088/mcp`
- 从远程客户端访问：`https://你的域名/mcp`，需要自行配置HTTPS反向代理及域名。
- HTTP头：`Authorization: Bearer <GDD_MCP_TOKEN>`
- 协议：MCP Streamable HTTP（JSON响应模式）。
- **不要将 `8088` 直接暴露在不可信互联网**，因为 Quant 其他原有 REST API 可能还没有完整的统一认证。优先VPN、私网或为整个Quant加前置鉴权与TLS。MCP本身有独立Bearer鉴权，并不代表整个8088安全。
- 上游GDD业务仍使用明文HTTP：本地到GDD登录链路仍有凭据被嗅探风险；建议有条件时在内网安全代理上使用HTTPS。

## 3. MCP工具列表

| 工具名 | 能力 | 入参 |
|---|---|---|
| `gdd_get_connection` | 动态服务器IP/端口诊断 | 无 |
| `gdd_list_features` | 列出18类插件请求和参数 | 无 |
| `gdd_get_kline` | 历史日K、分钟K、周月季年K | code / period / count |
| `gdd_get_trend` | 历史分时 | code / day |
| `gdd_get_ticks` | 历史逐笔成交 | code / day |
| `gdd_query_feature` | 18种插件功能的统一白名单查询 | featureId / params |
| `gdd_get_sector_rank` | 板块排行 | block / type / count |
| `gdd_get_money_flow` | 个股资金流向 | code |
| `gdd_get_limit_board` | 涨跌停榜 | updown / count / st |
| `gdd_get_dragon_pool` | 龙头列表 | block |
| `gdd_get_lhb` | 龙虎榜列表或详情 | day / id |

所有MCP工具只读，无下单、账户修改、订单支付和任意HTTP转发能力；部分插件返回结构来自APK逆向协议，**真实生产环境的全部命令尚未逐一验证**。

## 4. 测试（握手 + 工具目录）

无令牌时应该得到HTTP 401（如果没有配置GDD_MCP_TOKEN则为503）：

```bash
curl -i -X POST 'http://127.0.0.1:8088/mcp' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0.0"}}}'
```

带令牌的握手：

```bash
curl -sS 'http://127.0.0.1:8088/mcp' \
  -H 'Authorization: Bearer 你自己的GDD_MCP_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0.0"}}}'
```

列出工具：

```bash
curl -sS 'http://127.0.0.1:8088/mcp' \
  -H 'Authorization: Bearer 你自己的GDD_MCP_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## 5. 加入 AI MCP 客户端

对于支持远程 Streamable HTTP、并能自定义 Authorization 请求头的 MCP 客户端：

```json
{
  "mcpServers": {
    "quant-gdd": {
      "url": "https://你的域名/mcp",
      "headers": {
        "Authorization": "Bearer 你的GDD_MCP_TOKEN"
      }
    }
  }
}
```

不同客户端配置路径、字段及支持的鉴权方式不完全一致，以客户端自身说明为准。不要把令牌作为URL参数或写到公开仓库。

对于 ChatGPT 自定义 MCP/Plugin，检查账户是否提供“Add custom MCP server”以及 **API key/Header** 认证选项。如果 UI 仅支持 OAuth/无认证，本版本 **Bearer token不等于OAuth**，不能直接选择“无认证”绕过保护；应改用允许自定义 Header 的客户端，或额外部署支持OAuth的鉴权网关。ChatGPT 接入之前需要公网 HTTPS（或官方支持的安全隧道）；ChatGPT Android App 不能直接访问你手机的 localhost。

## 6. 设计与性能约束

- MCP 工具调用限速：进程内最多30次/分钟，以减少GDD上游压力。
- 单次MCP工具结果文本最大约45KB，超过会标记truncated，避免整批数据塞满模型上下文。
- MCP独立令牌至少32字符，使用 timingSafeEqual 常量时间比较。
- 默认拒绝携带未经允许的浏览器Origin，`GDD_MCP_ALLOWED_ORIGINS` 可显式列出可信Origin。
- 仅在 GDD 源已启用且账号密码配置完整时允许查询。
- GDD 请求成功与否取决于上游权限/网络；编译和模拟单测成功不表示上游全部联调通过。
