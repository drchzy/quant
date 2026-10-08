# Quant Market Data｜A股本地行情数据服务

`quant-market-data` 是 Quant 平台的本地行情数据层，负责从东方财富获取 A 股行情并保存到 DuckDB，对 Web、选股服务和 AI 提供统一 REST API。

## 镜像

```bash
docker pull __DOCKERHUB_USERNAME__/quant-market-data:latest
```

当前镜像架构：

```text
linux/amd64
```

适用于常见 Intel / AMD x86_64 Linux 服务器、NAS、虚拟机和 Docker 主机。

## 主要功能

- 全 A 股基础行情
- 实时行情
- 历史日 K
- 1/5/15/30/60 分钟 K
- 当日分时
- 上证、深证、创业板、科创50、沪深300等主要指数
- 行业板块、概念板块
- MA5 / MA10 / MA20 等技术指标
- 全市场技术指标接口
- DuckDB 本地持久化
- 工作日收盘后自动增量同步
- 历史日 K 初始化任务
- AI 聚合查询接口

## 推荐：使用 Docker Compose

完整 Quant 平台建议使用项目根目录的 `docker-compose.yml`，不要单独启动各容器。

```bash
git clone https://github.com/drchzy/quant.git
cd quant

cp .env.example .env
docker compose pull
docker compose up -d
```

行情服务访问地址：

```text
http://服务器IP:8080
```

健康检查：

```text
http://服务器IP:8080/health
```

## 单独启动

```bash
mkdir -p ./data

docker run -d \
  --name quant-market-data \
  --restart unless-stopped \
  -p 8080:8080 \
  -e TZ=Asia/Shanghai \
  -e HOST=0.0.0.0 \
  -e PORT=8080 \
  -e DATABASE_PATH=/app/data/market.duckdb \
  -e SYNC_ENABLED=true \
  -e "DAILY_SYNC_CRON=10 16 * * 1-5" \
  -v "$PWD/data:/app/data" \
  __DOCKERHUB_USERNAME__/quant-market-data:latest
```

## 数据目录

容器内：

```text
/app/data/market.duckdb
```

建议映射到宿主机：

```text
./data:/app/data
```

删除或重建容器不会丢失行情数据库。

## 可配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP监听地址 |
| `PORT` | `8080` | HTTP端口 |
| `TZ` | `Asia/Shanghai` | 时区 |
| `DATABASE_PATH` | `/app/data/market.duckdb` | DuckDB文件 |
| `SYNC_ENABLED` | `true` | 是否启用自动同步 |
| `DAILY_SYNC_CRON` | `10 16 * * 1-5` | 工作日每日行情同步时间 |
| `EASTMONEY_TIMEOUT_MS` | `10000` | 东方财富请求超时毫秒 |
| `EASTMONEY_PAGE_SIZE` | `500` | 全市场分页大小 |

## 常用接口

```text
GET /health

GET /api/v1/market/overview
GET /api/v1/market/stocks
GET /api/v1/market/technical

GET /api/v1/stocks/:code/quote
GET /api/v1/stocks/:code/daily
GET /api/v1/stocks/:code/minute
GET /api/v1/stocks/:code/intraday

GET /api/v1/sectors

POST /api/v1/sync/daily
POST /api/v1/sync/history
POST /api/v1/sync/sectors

GET /api/v1/ai/market
GET /api/v1/ai/stock/:code
```

## 第一次部署

推荐按下面顺序：

1. 启动容器。
2. 执行“同步今日市场”。
3. 执行“同步板块”。
4. 初始化历史日 K，建议至少 120 个交易日。
5. 后续由定时任务每日增量更新。

## 查看日志

```bash
docker logs -f quant-market-data
```

## 更新镜像

```bash
docker pull __DOCKERHUB_USERNAME__/quant-market-data:latest
docker rm -f quant-market-data
# 再按上面的 docker run 命令启动
```

如果使用 Compose：

```bash
docker compose pull
docker compose up -d
```

## 项目地址

GitHub：

```text
https://github.com/drchzy/quant
```
