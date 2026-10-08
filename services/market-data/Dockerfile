FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY services/market-data services/market-data
RUN npm run build:market-data

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --omit=dev

COPY --from=build /app/services/market-data/dist /app/services/market-data/dist

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["node", "services/market-data/dist/server.js"]
