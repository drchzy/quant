# Quant Web｜A股行情、选股、盘中执行与策略复盘 Web 页面

`quant-web` 是 Quant 平台的统一 Web 入口，通过 Nginx 提供前端静态页面，并反向代理 `market-data`、`stock-select` 和 `trade-manager`。

## 镜像

```bash
docker pull __DOCKERHUB_USERNAME__/quant-web:latest
```

镜像架构：

```text
linux/amd64
```

## 页面

- 市场总览
- 股票查询
- 板块对比
- 每日选股
- 盘中执行
- 策略复盘
- 数据同步

## 推荐启动方式

Web 镜像不是独立行情服务，推荐与另外三个后端一起通过 Docker Compose 启动。

```bash
git clone https://github.com/drchzy/quant.git
cd quant

cp .env.example .env
docker compose pull
docker compose up -d
```

浏览器访问：

```text
http://服务器IP:8088
```

例如服务器 IP 是 `192.168.1.100`：

```text
http://192.168.1.100:8088
```

## 完整服务端口

| 服务 | 默认端口 | 访问地址 |
| --- | ---: | --- |
| Web | 8088 | `http://服务器IP:8088` |
| market-data | 8080 | `http://服务器IP:8080` |
| stock-select | 8090 | `http://服务器IP:8090` |
| trade-manager | 8091 | `http://服务器IP:8091` |

正常日常使用只需要打开 Web 的 `8088`。

## Web 反向代理

容器内会转发：

```text
/api/v1/trading/* → trade-manager:8091
/api/v1/select/*  → stock-select:8090
/api/*            → market-data:8080
```

因此如果单独运行 Web，需要保证 Docker 网络内存在以下主机名：

```text
market-data
stock-select
trade-manager
```

## 单独运行 Web

如果三个后端已经在同一 Docker 网络，并使用上述容器名：

```bash
docker run -d \
  --name quant-web \
  --restart unless-stopped \
  --network 你的Docker网络 \
  -p 8088:80 \
  __DOCKERHUB_USERNAME__/quant-web:latest
```

## Compose 配置

修改 Web 暴露端口：

```env
WEB_PORT=8088
```

例如想改成 `18088`：

```env
WEB_PORT=18088
```

然后：

```bash
docker compose up -d
```

访问：

```text
http://服务器IP:18088
```

## 更新

```bash
docker compose pull
docker compose up -d
```

查看状态：

```bash
docker compose ps
```

查看 Web 日志：

```bash
docker logs -f quant-web
```

## 推荐首次使用顺序

1. 打开“数据同步”。
2. 同步今日市场。
3. 同步板块。
4. 初始化至少 120 个交易日日 K。
5. 打开“每日选股”运行第一次选股。
6. 第二天通过“盘中执行”按计划观察和确认实际成交。
7. 后续通过“策略复盘”查看历史表现和回测结果。

## 项目地址

```text
https://github.com/drchzy/quant
```
