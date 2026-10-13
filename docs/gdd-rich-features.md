# GDD 行情工作台：接口、页面与验证边界

## 部署与操作

新的 GDD 工作台已加入 Quant 左侧主导航，单镜像单容器、统一端口 8088，数据持久化沿用 web/data。

在宿主机 web/.env 填写且只需填写：

```dotenv
GDD_ACCOUNT="你的账号"
GDD_PASSWORD="你的密码"
```

如与实际客户端登录密码格式不同，可额外配置 GDD_PASSWORD_MODE=md5，但上个版本默认为 plain。

重启容器，并在“数据同步 → 数据源管理”勾选 GDD 后保存。打开“GDD 行情工作台”：

1. 点击 **检测动态网关**：自动生成稳定设备UUID、登录、获取 sessionCode、按 serverType=36/35 选择网关。页面不会显示密码或 sessionCode。
2. 选择功能标签（市场情绪/热门板块/个股资金/选股策略/龙虎榜/分时与逐笔）。
3. 修改经过白名单校验的参数，点击查询，查看结构化数据表及原始响应。
4. 日K、5/15/30/60分钟K可选条数；分时与逐笔可指定历史交易日期。

## 已实现的 API

| 端点 | 用途 | 上游协议 |
|---|---|---|
| GET /api/v1/gdd/connection | 业务账号登录 + 动态查服务器（返回36/35地址） | query_server_info |
| GET /api/v1/gdd/features | 18类功能目录及表单字段 | 内部定义 |
| GET /api/v1/gdd/features/:id | 限定功能 + 经过校验的参数 | ReqType/ReqID/Data |
| GET /api/v1/gdd/kline/:code?period=10&count=100 | 直接GDD周期K线（只读） | reqtype=150 |
| GET /api/v1/gdd/trend/:code?day=YYYY-MM-DD | GDD历史分时 | reqtype=152 |
| GET /api/v1/gdd/ticks/:code?day=YYYY-MM-DD | GDD历史逐笔成交 | reqtype=151 |
| GET /api/v1/data-sources | 启用状态与优先级 | Quant原接口 |

所有新查询接口必须配置GDD账号密码并在数据源管理启用GDD。插件和历史行情接口均采用服务端请求，不允许浏览器控制任意 ReqType 或发送任意 JSON。插件结果直接只读显示，**不在未经核验的情况下写DuckDB**。

### 插件功能（18类）

市场情绪：riseFall=1260、limitUpDown=1274、shortLine=1287、bigStrategy=1417。

板块：blockData=1201、blockRank=1203、blockMerchRank=1202、blockSymbolRankingByCycle=1225、relatedBlock=1421。

个股资金：fundFlow=1200、capitalTrend=1282、merchAuction=1403、indexParams=1279、statisticsRange=1427。

策略：chooseStocks=1207、dragons=1264。

龙虎榜：lhbList=3002、lhbDetail=3003。**动态选择服务器清单中的 serverType=35**，其余插件选择36。请求地址或返回对象是否与具体当前服务器完全一致尚需现场抓包校对。

这些请求的 **Data 字段与大小写**按上传的APK逆向文档第8节生成；1200/1201需要数组，其他功能使用对象。返回状态码不为0会显示错误，不伪造数据。

## 当前限制、诊断及安全

- 源文件包括客户端静态逆向和少量实测。**编译、单测、容器测试通过，不代表18个上游插件都已现场联调**。不同版本服务器可能对时间、Type、BlockID、排序方式和返回实体有不同解释。
- 部分未集成的能力：WS实时长连订阅、用户注册/注销、密码修改、付费订单、H5页面桥接及具体不明入参的F10/资讯。账号/支付变更等高风险业务不接入行情工作台。
- 历史151按文件第3.3节位序解析；若实际返回无数据，会明确报错。
- 服务器网关从登录下发的清单动态获取，没有固定行情IP备用路线；动态缓存15分钟，网络失败重新发现后最多重试1次。
- 为减少被滥用，每分钟最多发起30次 GDD 新查询（进程内全局）；行情结果上限2MB。请勿向互联网公开无访问控制的 8088 端口，使用私网/VPN/反向代理鉴权。
- GDD业务接口仍为明文HTTP；不要将真实账号密码、sessionCode提交到GitHub或写入公共日志，推荐受控HTTPS代理。Docker部署用户需限制 web/.env 文件权限。

## 验证方法

先打开 “数据同步 → 数据源管理” 启用 GDD。

```bash
curl -s http://127.0.0.1:8088/api/v1/gdd/features
curl -s http://127.0.0.1:8088/api/v1/gdd/connection
curl -s 'http://127.0.0.1:8088/api/v1/gdd/features/blockData?block=54000'
curl -s 'http://127.0.0.1:8088/api/v1/gdd/features/fundFlow?code=300505'
curl -s 'http://127.0.0.1:8088/api/v1/gdd/kline/300505?period=10&count=20'
curl -s 'http://127.0.0.1:8088/api/v1/gdd/trend/300505?day=2026-10-13'
curl -s 'http://127.0.0.1:8088/api/v1/gdd/ticks/300505?day=2026-10-13'
```

查询失败看 JSON 的 error 字段，实盘大批量同步前确认表头、金额/成交量单位。
