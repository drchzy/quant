#!/bin/sh
set -eu

AUTH_ENABLED="${WEB_AUTH_ENABLED:-true}"
USERNAME="${WEB_USERNAME:-admin}"
PASSWORD="${WEB_PASSWORD:-quant123456}"
CONF="/etc/nginx/conf.d/default.conf"
PASSWD_FILE="/etc/nginx/.htpasswd"

case "$(printf '%s' "$AUTH_ENABLED" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
      echo "WEB_USERNAME 和 WEB_PASSWORD 不能为空" >&2
      exit 1
    fi

    htpasswd -bc "$PASSWD_FILE" "$USERNAME" "$PASSWORD" >/dev/null 2>&1
    chmod 640 "$PASSWD_FILE"
    echo "Quant Web 登录保护已启用，账号：$USERNAME"
    ;;
  *)
    # Nginx 配置默认启用 Basic Auth；关闭时删除两行指令。
    sed -i '/^[[:space:]]*auth_basic[[:space:]]/d' "$CONF"
    sed -i '/^[[:space:]]*auth_basic_user_file[[:space:]]/d' "$CONF"
    echo "Quant Web 登录保护已关闭"
    ;;
esac
