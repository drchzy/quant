FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY services/stock-select/package.json services/stock-select/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY services/stock-select services/stock-select
RUN npm run build:stock-select

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY services/stock-select/package.json services/stock-select/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --omit=dev

COPY --from=build /app/services/stock-select/dist /app/services/stock-select/dist

RUN mkdir -p /app/data

EXPOSE 8090

CMD ["node", "services/stock-select/dist/server.js"]
