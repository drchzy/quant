FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY services/stock-select/package.json services/stock-select/package.json
COPY services/trade-manager/package.json services/trade-manager/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY services/trade-manager services/trade-manager
RUN npm run build:trade-manager

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY services/stock-select/package.json services/stock-select/package.json
COPY services/trade-manager/package.json services/trade-manager/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --omit=dev

COPY --from=build /app/services/trade-manager/dist /app/services/trade-manager/dist

RUN mkdir -p /app/data

EXPOSE 8091

CMD ["node", "services/trade-manager/dist/server.js"]
