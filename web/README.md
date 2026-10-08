# web 运行目录

Docker 运行时的数据库和可修改配置统一放在这个目录。

```text
web/
├─ config/
│  ├─ .env.example     # 默认配置模板
│  └─ .env             # 实际配置，首次部署时复制生成
└─ data/
   ├─ market.duckdb    # 行情数据库
   ├─ select.duckdb    # 选股 / 复盘 / 回测数据库
   └─ trade.duckdb     # 持仓 / 交易执行数据库
```

Docker Compose 会把整个宿主机目录：

```text
./web
```

统一挂载到容器：

```text
/app/runtime
```

三个服务分别使用：

```text
/app/runtime/data/market.duckdb
/app/runtime/data/select.duckdb
/app/runtime/data/trade.duckdb
```

因此备份、迁移时直接复制整个 `web` 目录即可。

首次部署：

```bash
mkdir -p web/config web/data
cp web/config/.env.example web/config/.env

# 修改密码、端口和策略参数
vi web/config/.env

docker compose --env-file web/config/.env pull
docker compose --env-file web/config/.env up -d
```

升级镜像：

```bash
docker compose --env-file web/config/.env pull
docker compose --env-file web/config/.env up -d
```

删除或重建容器不会删除宿主机 `web/data` 下的 DuckDB 文件。
