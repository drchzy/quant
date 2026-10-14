# Quant Web 登录与 GDD 专业行情终端

## 登录保护

宿主机 `web/.env` 仅需配置：

```dotenv
WEB_USERNAME="admin"
WEB_PASSWORD="使用长度不少于8位的独立强密码"
GDD_ACCOUNT="你的GDD行情账号"
GDD_PASSWORD="你的GDD行情密码"
GDD_MCP_TOKEN="原MCP独立访问令牌"
```

- Docker 重启后访问 `http://服务器IP:8088` 自动进入 `/login.html`，输入 Web 账号和密码登录；两个账户用途不同。**`WEB_PASSWORD` 为空或不足8位时默认拒绝网站访问**，不要误以为仍可免登录访问。
- Web 登录由 `market-data` 服务端校验密码；Nginx 的 `auth_request` 对静态资源、`/api/`、策略、交易、外部行情导入统一实施会话检查。
- 12小时有效期的 HMAC 签名会话 Cookie：HttpOnly、SameSite=Strict。Cookie签名私钥首次自动存于 `web/data/.web-auth-secret`，重建容器不会丢失；更改 WEB_PASSWORD 即让旧Cookie失效。
- 登录端点限制请求频率（Nginx每分钟8次，突发6次）；应用内部对连续失败登录也限制次数。退出登录会清除Cookie。
- `/mcp` 保留独立Bearer令牌，不与网页登录共享Cookie；`/health` 可继续供Docker健康检测使用。
- **务必通过TLS/HTTPS反向代理远程访问。** 本地HTTP会使浏览器密码和会话可能被嗅探。生产服务器不应把没有外部访问控制的8088端口直接暴露到公网。
- 如果宿主机旧 `web/.env` 没有新字段，需自行补充 `WEB_USERNAME/WEB_PASSWORD`，不会覆盖原有GDD账号与DuckDB。

## GDD 行情终端

路径：登录后打开「GDD 行情工作台 → 专业行情」。

- 顶栏可以按六位A股代码查询；后台使用登录得到的会话和`query_server_info`动态发现 GDD 0x24/36 统一行情网关。
- 价格图支持分时、日K、周K、月K、5分、15分、30分、60分钟切换，ECharts 默认折线图，K线周期可以切换蜡烛图；显示成交量以及MA5/10/20或当日均价。
- GDD WebSocket只由Quant容器内部保持共享连接：使用 `reqtype=200/201/202` 订阅，接收 `250` 证券快照与 `251` 逐笔交易。浏览器每2秒读取服务端缓存，不直接访问上游WS。
- 右侧显示卖10～卖1、最新价、买1～买10以及逐笔成交。档位使用 `buyPrice0..9`、`sellPrice0..9` 和对应量字段；**若上游没有提供十档，缺失显示 — 并告知未确认L2**，不能将普通五档谎称十档。
- 历史K线来自GDD HTTP `reqtype=150`，分时来自 `152`；交易日可手动选择。实时数据与历史数据明确区分，休市与GDD行情订阅异常时不会制造假实时价格。
- 2026-10-14这版实现与模拟测试不等于真实生产GDD账号已经联调；十档行情是否可用取决于服务端提供的字段、账户权限和时间段。

## 上线命令

```bash
cd web
docker compose pull
docker compose up -d
```

登录异常可在服务器执行 `docker logs --tail 120 quant`。不应把 WEB_PASSWORD、GDD_PASSWORD、MCP Token 放进工单日志或Git提交。

## 安全验证

```bash
# 未登录应该302跳转到登录页
curl -I http://127.0.0.1:8088/
# 未登录API应该401
curl -i http://127.0.0.1:8088/api/v1/market/stocks
```

登录成功后再访问 GDD 专业行情页面，并在「数据源管理」启用GDD行情源。
