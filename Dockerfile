FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY services/stock-select/package.json services/stock-select/package.json
COPY services/trade-manager/package.json services/trade-manager/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY services services
COPY apps apps

RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY services/stock-select/package.json services/stock-select/package.json
COPY services/trade-manager/package.json services/trade-manager/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --omit=dev

COPY --from=build /app/services/market-data/dist /app/services/market-data/dist
COPY --from=build /app/services/stock-select/dist /app/services/stock-select/dist
COPY --from=build /app/services/trade-manager/dist /app/services/trade-manager/dist
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

COPY docker/all-in-one-nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/start-all-in-one.sh /usr/local/bin/start-quant
COPY web/.env /opt/quant-defaults/.env

RUN chmod +x /usr/local/bin/start-quant \
    && mkdir -p /app/web/data \
    && rm -f /etc/nginx/sites-enabled/default

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "Promise.all(['http://127.0.0.1:8080/health','http://127.0.0.1:8090/health','http://127.0.0.1:8091/health','http://127.0.0.1:8088/'].map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error(u)}))).catch(()=>process.exit(1))"

CMD ["/usr/local/bin/start-quant"]
