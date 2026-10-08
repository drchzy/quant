# runtime

运行时文件统一放在这里，升级 Docker 镜像时不会覆盖。

```text
runtime/
├─ config/
│  ├─ .env.example   # 配置模板（提交到 Git）
│  └─ .env           # 实际配置（不要提交）
└─ data/
   ├─ market.duckdb  # market-data
   ├─ select.duckdb  # stock-select
   └─ trade.duckdb   # trade-manager
```

第一次部署：

```bash
mkdir -p runtime/config runtime/data
cp runtime/config/.env.example runtime/config/.env

# 修改账号密码和策略参数
vi runtime/config/.env

docker compose --env-file runtime/config/.env pull
docker compose --env-file runtime/config/.env up -d
```

升级：

```bash
docker compose --env-file runtime/config/.env pull
docker compose --env-file runtime/config/.env up -d
```

DuckDB 文件位于宿主机 `runtime/data/`，删除/升级容器不会删除数据库。
