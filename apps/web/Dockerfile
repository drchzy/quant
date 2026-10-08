FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY services/market-data/package.json services/market-data/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY apps/web apps/web
RUN npm run build:web

FROM nginx:1.29-alpine

RUN apk add --no-cache apache2-utils

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/40-basic-auth.sh /docker-entrypoint.d/40-basic-auth.sh
RUN chmod +x /docker-entrypoint.d/40-basic-auth.sh

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
