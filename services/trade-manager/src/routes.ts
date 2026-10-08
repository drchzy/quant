import type { FastifyInstance } from 'fastify';
import {
  addManualPosition,
  confirmBuy,
  confirmSell,
  expireTodayPlans,
  getClosedTrades,
  getEvents,
  getPlan,
  getTradingAi,
  getTradingOverview,
  refreshTrading,
  syncLatestPlans
} from './trading.js';

export async function registerRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get('/api/v1/trading/today', async () => {
    return getTradingOverview();
  });

  app.post('/api/v1/trading/sync-plans', async (request, reply) => {
    try {
      return await syncLatestPlans();
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/v1/trading/refresh', async (request, reply) => {
    try {
      return await refreshTrading();
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/v1/trading/expire', async () => {
    return expireTodayPlans();
  });

  app.get('/api/v1/trading/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getPlan(id);

    if (!result) {
      return reply.code(404).send({ error: '交易计划不存在' });
    }

    return result;
  });

  app.post('/api/v1/trading/plans/:id/buy', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as {
        price?: number;
        quantity?: number;
      };

      return await confirmBuy(id, body.price, body.quantity);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/v1/trading/plans/:id/sell', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as {
        price?: number;
        reason?: string;
      };

      return await confirmSell(id, body.price, body.reason);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/v1/trading/positions', async (request, reply) => {
    try {
      return await addManualPosition(
        request.body as any
      );
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/trading/history', async (request) => {
    const query = request.query as { limit?: string };
    return {
      data: await getClosedTrades(Number(query.limit || 100))
    };
  });

  app.get('/api/v1/trading/events', async (request) => {
    const query = request.query as { limit?: string };
    return {
      data: await getEvents(Number(query.limit || 100))
    };
  });

  app.get('/api/v1/trading/ai', async () => {
    return getTradingAi();
  });
}
