# Quant Web

Quant A 股行情、选股、盘中执行和策略复盘管理页面。

## 推荐：整套 Docker Compose 部署

四个镜像按服务拆分，推荐一起部署：

- `quant-market-data`
- `quant-stock-select`
- `quant-trade-manager`
- `quant-web`

### 一键准备

```bash
mkdir -p quant/runtime/config quant/runtime/data
cd quant

curl -L -o docker-compose.yml https://raw.githubusercontent.com/drchzy/quant/main/docker-compose.yml
curl -L -o runtime/config/.env https://raw.githubusercontent.com/drchzy/quant/main/runtime/config/.env.example

# 建议先修改默认密码
vi runtime/config/.env

docker compose --env-file runtime/config/.env pull
docker compose --env-file runtime/config/.env up -d
```

### 访问地址

```text
Web: http://服务器IP:8088
```

默认登录：

```text
账号：admin
密码：quant123456
```

> 正式使用前请修改 `runtime/config/.env` 中的 `WEB_USERNAME` / `WEB_PASSWORD`，然后重新 `docker compose up -d`。

### 宿主机持久化目录

```text
runtime/
├─ config/
│  └─ .env
└─ data/
   ├─ market.duckdb
   ├─ select.duckdb
   └─ trade.duckdb
```

升级镜像不会删除 DuckDB 数据。

### 更新

```bash
docker compose --env-file runtime/config/.env pull
docker compose --env-file runtime/config/.env up -d
```

所有镜像当前发布平台：`linux/amd64`。


## 本镜像

```text
镜像：drchzy/quant-web:latest
内部端口：80
宿主机默认端口：8088
依赖：market-data + stock-select + trade-manager
```

## 默认登录

首次启动默认：

```text
账号：admin
密码：quant123456
```

配置：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `WEB_AUTH_ENABLED` | `true` | 是否启用浏览器 Basic Auth |
| `WEB_USERNAME` | `admin` | 登录账号 |
| `WEB_PASSWORD` | `quant123456` | 登录密码，请修改 |
| `WEB_BIND_IP` | `0.0.0.0` | Web 对外监听地址 |
| `WEB_PORT` | `8088` | Web 访问端口 |

Web 登录保护同时覆盖通过 Web 反向代理访问的 API。三个后端端口在推荐 Compose 中默认只绑定 `127.0.0.1`，避免绕过登录。
