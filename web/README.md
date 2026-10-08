# Quant 单容器运行目录

现在 Quant 默认使用 **一个 Docker 镜像、一个容器、一个端口、一个映射目录**。

目录：

```text
web/
├─ docker-compose.yml
├─ .env
└─ data/
   ├─ market.duckdb
   ├─ select.duckdb
   └─ trade.duckdb
```

第一次启动时，如果数据库不存在会自动创建。

如果直接使用 `docker run` 且 `.env` 不存在，容器也会自动生成默认 `.env`。

## 最简单启动

```bash
cd web

docker compose pull
docker compose up -d
```

只访问：

```text
http://服务器IP:8088
```

不需要再开放 8080、8090、8091。

这些端口只在容器内部使用：

```text
127.0.0.1:8080  market-data
127.0.0.1:8090  stock-select
127.0.0.1:8091  trade-manager
0.0.0.0:8088    Web/Nginx统一入口
```

## 不使用 Compose

创建运行目录：

```bash
mkdir -p web
```

然后：

```bash
docker run -d \
  --name quant \
  --restart unless-stopped \
  -p 8088:8088 \
  -v "$PWD/web:/app/web" \
  drchzy/quant:latest
```

第一次启动后：

```text
web/.env
web/data/market.duckdb
web/data/select.duckdb
web/data/trade.duckdb
```

会自动出现在宿主机目录中。

## 修改参数

编辑：

```text
web/.env
```

然后：

```bash
docker restart quant
```

## 更新

Compose：

```bash
cd web
docker compose pull
docker compose up -d
```

docker run：

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

## 备份

只需要备份整个 `web/`：

```bash
tar -czf quant-backup.tar.gz web/
```

配置和三个 DuckDB 都在里面。


## 固定镜像版本

每次发布都会生成类似：

```text
drchzy/quant:0.4.0-build.123
```

生产环境建议把 `web/.env` 中：

```env
QUANT_IMAGE="drchzy/quant:latest"
```

改成实际版本，例如：

```env
QUANT_IMAGE="drchzy/quant:0.4.0-build.123"
```

这样更新、回滚都更明确。
