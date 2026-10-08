# Quant

本地 A 股行情、选股、回测、持仓与盘中执行平台。

默认部署方式已经收敛为：

```text
1 个 Docker 镜像
1 个容器
1 个对外端口
1 个 web/ 持久化目录
```

镜像：

```text
drchzy/quant:latest
```

架构仍然保持模块分层，但全部运行在同一个容器内：

```text
浏览器
  │
  ▼
8088 / Nginx
  ├─ /api/...         → market-data   127.0.0.1:8080
  ├─ /api/v1/select   → stock-select  127.0.0.1:8090
  └─ /api/v1/trading  → trade-manager 127.0.0.1:8091
```

内部 8080 / 8090 / 8091 **不暴露给宿主机**。

## 最简单启动

```bash
mkdir -p web

docker run -d \
  --name quant \
  --restart unless-stopped \
  -p 8088:8088 \
  -v "$PWD/web:/app/web" \
  drchzy/quant:latest
```

打开：

```text
http://服务器IP:8088
```

健康检查：

```text
http://服务器IP:8088/health
```

第一次启动会自动生成：

```text
web/
├─ .env
└─ data/
   ├─ market.duckdb
   ├─ select.duckdb
   └─ trade.duckdb
```

配置和数据库全部集中在一个目录。

## Docker Compose

项目提供：

```text
web/docker-compose.yml
web/.env
```

使用：

```bash
cd web
docker compose pull
docker compose up -d
```

日常仍然只访问：

```text
http://服务器IP:8088
```

## 配置

所有可调参数集中在：

```text
web/.env
```

包括：

- 东方财富请求超时和分页大小
- 每日行情同步时间
- 自动选股时间
- Top10 / 重点3只
- 北交所 / 科创板 / ST 过滤
- 价格、成交额、市值、换手率过滤
- 不追高比例
- 两档止盈
- 最大止损
- 移动止盈
- 最大仓位
- 时间退出
- 盘中监控频率

修改后：

```bash
docker restart quant
```

## 数据

```text
web/data/market.duckdb
```

行情、日K、分钟K、板块等。

```text
web/data/select.duckdb
```

每日选股、候选、策略复盘和参数回测。

```text
web/data/trade.duckdb
```

持仓、交易计划、T+1状态、止盈止损、状态日志和已结束交易。

## 备份与迁移

只备份整个 `web/`：

```bash
tar -czf quant-backup.tar.gz web/
```

换服务器时恢复 `web/` 后重新启动同一个镜像即可。

## 页面

- 市场总览
- 股票查询
- 板块对比
- 每日选股
- 盘中执行
- 策略复盘
- 数据同步

## 自动流程

```text
09:30-11:30 / 13:00-15:00
盘中每分钟监控重点候选和持仓

16:10
同步当天全市场行情

16:40
复盘历史候选并自动运行当天选股

16:45
同步明日重点3只交易计划
```

## 第一次使用

1. 启动容器。
2. 打开 `http://服务器IP:8088`。
3. 进入“数据同步”。
4. 同步今日市场。
5. 同步板块。
6. 初始化历史日K，建议至少120个交易日。
7. 进入“每日选股”运行第一次选股。
8. 第二天使用“盘中执行”。

## 更新

```bash
docker pull drchzy/quant:latest
docker rm -f quant

docker run -d \
  --name quant \
  --restart unless-stopped \
  -p 8088:8088 \
  -v "$PWD/web:/app/web" \
  drchzy/quant:latest
```

使用 Compose：

```bash
cd web
docker compose pull
docker compose up -d
```

## 本地开发

源代码仍然按模块开发：

```text
services/market-data
services/stock-select
services/trade-manager
apps/web
```

开发环境：

```bash
npm install

npm run dev:market-data
npm run dev:stock-select
npm run dev:trade-manager
npm run dev:web
```

## Docker Hub

GitHub Actions 默认只发布一个 x86_64 镜像：

```text
drchzy/quant:latest
```

架构：

```text
linux/amd64
```

详细运行说明见：

```text
web/README.md
docs/dockerhub/quant.md
```

## 注意

Quant 用于行情研究、策略筛选、回测和交易纪律辅助，不保证收益。

trade-manager 不会自动连接券商下单；实际买入和卖出仍需要用户手工确认。


## 行情数据源降级

为避免东方财富公开接口触发 IP 风控后整个平台不可用，market-data 现在采用：

```text
实时全市场 / 实时报价 / 分时
  push2delay.eastmoney.com
        ↓ 失败
  push2.eastmoney.com
        ↓ 仍失败
  页面回退 DuckDB 最近成功数据

日K / 分钟K
  push2his.eastmoney.com
        ↓ 失败
  腾讯财经 K 线备用源
```

所有东财请求统一串行限速、指数退避重试并带缓存，避免页面、选股和盘中执行分别请求上游造成同一出口 IP 被限流。

数据源状态：

```text
GET /api/v1/market/source-status
```

健康检查也会返回最近的数据源状态：

```text
GET /health
```
