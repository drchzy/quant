import Fastify from 'fastify';
import { buildSecid, eastmoney, normalizeStockCode } from './eastmoney.js';

const app = Fastify({
  logger: true
});

app.get('/health', async () => ({
  status: 'ok',
  service: 'market-data',
  provider: 'eastmoney'
}));

app.get('/api/v1/stocks/:code/quote', async (request, reply) => {
  try {
    const { code } = request.params as { code: string };
    const normalized = normalizeStockCode(code);
    const data = await eastmoney.quote(buildSecid(normalized));
    return {
      code: normalized,
      source: 'eastmoney',
      data
    };
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

app.get('/api/v1/stocks/:code/daily', async (request, reply) => {
  try {
    const { code } = request.params as { code: string };
    const { limit = '120' } = request.query as { limit?: string };
    const normalized = normalizeStockCode(code);
    const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 1000);
    const data = await eastmoney.dailyKline(buildSecid(normalized), safeLimit, 1);
    return {
      code: normalized,
      adjust: 'qfq',
      source: 'eastmoney',
      count: data.length,
      data
    };
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

app.get('/api/v1/stocks/:code/intraday', async (request, reply) => {
  try {
    const { code } = request.params as { code: string };
    const normalized = normalizeStockCode(code);
    const data = await eastmoney.intradayTrend(buildSecid(normalized));
    return {
      code: normalized,
      source: 'eastmoney',
      count: data.length,
      data
    };
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

app.get('/api/v1/stocks/:code/minute', async (request, reply) => {
  try {
    const { code } = request.params as { code: string };
    const query = request.query as { period?: string; limit?: string };
    const normalized = normalizeStockCode(code);
    const periodValue = Number(query.period || 5);
    const allowed = new Set([1, 5, 15, 30, 60]);
    if (!allowed.has(periodValue)) {
      reply.code(400);
      return { error: 'period must be one of 1,5,15,30,60' };
    }
    const safeLimit = Math.min(Math.max(Number(query.limit) || 500, 1), 1000);
    const data = await eastmoney.minuteKline(
      buildSecid(normalized),
      periodValue as 1 | 5 | 15 | 30 | 60,
      safeLimit
    );
    return {
      code: normalized,
      period: periodValue,
      source: 'eastmoney',
      count: data.length,
      data
    };
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

app.get('/api/v1/market/stocks', async (request, reply) => {
  try {
    const query = request.query as { page?: string; pageSize?: string };
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 100, 1), 500);
    const data = await eastmoney.aShareList(pageSize, page);
    return {
      page,
      pageSize,
      source: 'eastmoney',
      count: data.length,
      data
    };
  } catch (error) {
    reply.code(502);
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);

app.listen({ host, port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
