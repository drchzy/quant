# market-data

A local-first A-share market data service.

Current provider:

- Eastmoney via `eastmoney-data-sdk@^1.0.5`

Current endpoints:

- `GET /health`
- `GET /api/v1/stocks/:code/quote`
- `GET /api/v1/stocks/:code/daily?limit=120`
- `GET /api/v1/stocks/:code/intraday`
- `GET /api/v1/stocks/:code/minute?period=1&limit=500`
- `GET /api/v1/market/stocks?page=1&pageSize=100`

## Run

From repository root:

```bash
npm install
npm run dev:market-data
```

Default listen address: `0.0.0.0:8080`.

Example:

```bash
curl http://localhost:8080/api/v1/stocks/600186/daily?limit=60
curl http://localhost:8080/api/v1/stocks/600186/intraday
```

Next planned layers:

1. DuckDB persistence and incremental sync
2. full-market daily snapshot sync
3. industry/concept/index datasets
4. AI-friendly query endpoints
5. Web dashboard
6. Docker / docker-compose / Docker Hub image pipeline
