import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import {
  getAiSelect,
  getLatest,
  getRun,
  getRuns,
  runSelect
} from './select.js';
import {
  getLatestReviews,
  getReviewSummary,
  reviewPending
} from './review.js';
import {
  getBacktest,
  getBacktests,
  getLatestBacktest,
  startBacktest
} from './backtest.js';

export async function registerRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get('/api/v1/select/config', async () => ({
    strategy: '超短趋势',
    filters: {
      excludeBse: config.excludeBse,
      excludeStar: config.excludeStar,
      excludeSt: config.excludeSt,
      minPrice: config.minPrice,
      minAmount: config.minAmount,
      minMarketCap: config.minMarketCap,
      maxMarketCap: config.maxMarketCap,
      minTurnover: config.minTurnover,
      maxTurnover: config.maxTurnover,
      minPct: config.minPct,
      maxPct: config.maxPct,
      minScore: config.minScore
    },
    plan: {
      noChasePct: config.noChasePct,
      firstTakeProfitPct: config.firstTakeProfitPct,
      secondTakeProfitPct: config.secondTakeProfitPct,
      maxLossPct: config.maxLossPct,
      trailingStartPct: config.trailingStartPct,
      trailingDrawdownPct: config.trailingDrawdownPct,
      maxPositionPct: config.maxPositionPct,
      timeStopDays: config.timeStopDays
    }
  }));

  app.post('/api/v1/select/run', async (request, reply) => {
    try {
      return await runSelect();
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/select/latest', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(
      Math.max(Number(query.limit || config.topCount), 1),
      50
    );

    return getLatest(limit);
  });

  app.get('/api/v1/select/runs', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(
      Math.max(Number(query.limit || 30), 1),
      100
    );

    return { data: await getRuns(limit) };
  });

  app.get('/api/v1/select/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getRun(id);

    if (!result) {
      return reply.code(404).send({ error: '选股记录不存在' });
    }

    return result;
  });

  app.post('/api/v1/select/review/run', async (request, reply) => {
    try {
      return await reviewPending();
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/select/review/summary', async (request) => {
    const query = request.query as { mainOnly?: string };
    const mainOnly =
      query.mainOnly === undefined
        ? true
        : ['1', 'true', 'yes'].includes(
            String(query.mainOnly).toLowerCase()
          );

    return getReviewSummary(mainOnly);
  });

  app.get('/api/v1/select/review/latest', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(
      Math.max(Number(query.limit || 50), 1),
      200
    );

    return {
      data: await getLatestReviews(limit)
    };
  });

  app.post('/api/v1/select/backtest', async (request, reply) => {
    try {
      const body = (request.body || {}) as {
        tradeDays?: number;
        topCount?: number;
      };

      return await startBacktest(
        Number(body.tradeDays || 60),
        Number(body.topCount || 3)
      );
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/select/backtests', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(
      Math.max(Number(query.limit || 20), 1),
      100
    );

    return {
      data: await getBacktests(limit)
    };
  });

  app.get('/api/v1/select/backtests/latest', async () => {
    return getLatestBacktest();
  });

  app.get('/api/v1/select/backtests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getBacktest(id);

    if (!result) {
      return reply.code(404).send({
        error: '回测记录不存在'
      });
    }

    return result;
  });

  app.get('/api/v1/select/ai', async () => {
    return getAiSelect();
  });
}
