# Quant

本地 A 股行情与量化研究平台。

当前完成第一阶段：**market-data**。

## 目录

```text
quant/
├─ services/
│  └─ market-data/       # 行情采集、DuckDB、REST API、定时同步
├─ apps/
│  └─ web/               # 本地行情与管理页面
├─ docs/
│  └─ architecture.md    # 架构说明
├─ docker-compose.yml
└─ .github/workflows/    # CI 与 Docker Hub 发布
```

## 当前数据源

东方财富：

- `eastmoney-data-sdk`
- 东财公开 HTTP 接口

当前支持：

- 全 A 股基础行情
- 实时行情
- 历史日 K
- 1/5/15/30/60 分钟 K
- 当日分时
- 主要指数
- 行业板块
- 概念板块
- DuckDB 本地保存
- 每日自动增量同步
- Web 页面
- AI 聚合查询接口

## Docker Compose 启动

```bash
cp .env.example .env
docker compose up -d --build
```

打开：

- Web: `http://localhost:8088`
- API: `http://localhost:8080`
- 健康检查: `http://localhost:8080/health`

DuckDB 数据保存在：

```text
./data/market.duckdb
```

## 本地开发

需要 Node.js 20+。

```bash
npm install

# 后端
npm run dev:market-data

# 前端
npm run dev:web
```

## 第一次使用

1. 打开“数据同步”页面。
2. 点击“同步今日市场”。
3. 点击“同步板块”。
4. 如需完整均线和趋势分析，再执行“初始化历史日 K”。

历史初始化默认 120 个交易日，属于一次性重任务。

之后工作日收盘后会按配置自动增量同步。

## AI 查询接口

市场：

```text
GET /api/v1/ai/market
```

个股：

```text
GET /api/v1/ai/stock/600186
```

详细设计见：

```text
docs/architecture.md
```

## Docker Hub

仓库已准备 Docker Hub 发布工作流。

在 GitHub 仓库 Secrets 配置：

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

然后手动运行：

`Publish Docker Images`

或推送 `v*` 标签。

发布镜像：

```text
<DOCKERHUB_USERNAME>/quant-market-data
<DOCKERHUB_USERNAME>/quant-web
```
