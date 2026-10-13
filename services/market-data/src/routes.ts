import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { fetchGddTrend, fetchGddTicks, fetchGddKline, getGddServerAddress } from './gdd.js';
import { GDD_FEATURES, queryGddFeature } from './gdd-features.js';
import { importBridgeRows, getBridgeCounts } from './external-bridge.js';
import {
  getAiStock,
  getDaily,
  getMarketOverview,
  getMinute,
  getSectorList,
  getStock,
  getStockIntraday,
  getStockList,
  getStockQuote,
  getTechnicalStocks,
  getFuturePrices,
  getTradeDates,
  searchStocks
} from './market.js';
import {
  getMarketDataSourceStatus,
  normalizeStockCode
} from './eastmoney.js';
import {
  getJobs,
  stopAllSyncs,
  syncDailyMarket,
  syncHistory,
  syncSectors
} from './sync.js';
import {
  getSourceSettings,
  saveSourceSettings,
  testSource
} from './source-manager.js';
import type { DataSourceId } from './providers.js';
import type { SectorType } from './types.js';

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export async function registerRoutes(
  app: FastifyInstance
): Promise<void> {
  // 外部桥接写入只接受单独配置的令牌，不能依赖前端页面是否登录。
  const checkBridgeToken = (token: unknown): boolean => {
    const expected = config.bridgeImportToken.trim();
    if (expected.length < 16 || typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  app.post('/api/v1/bridge/import', { bodyLimit: 1_048_576 }, async (request, reply) => {
    if (!config.bridgeImportToken.trim()) {
      return reply.code(503).send({ error: '外部桥接未开启：请在 web/.env 设置 BRIDGE_IMPORT_TOKEN 并重启服务' });
    }
    if (!checkBridgeToken(request.headers['x-bridge-token'])) {
      return reply.code(401).send({ error: '桥接令牌无效' });
    }
    try {
      const result = await importBridgeRows(request.body);
      return { success: true, ...result };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/v1/bridge/status', async (request, reply) => {
    if (!config.bridgeImportToken.trim()) {
      return reply.code(503).send({ enabled: false, error: '服务端 BRIDGE_IMPORT_TOKEN 未配置' });
    }
    if (!checkBridgeToken(request.headers['x-bridge-token'])) {
      return reply.code(401).send({ error: '桥接令牌无效' });
    }
    return { enabled: true, counts: await getBridgeCounts() };
  });

  app.get('/api/v1/market/overview', async (request) => {
    const query = request.query as { live?: string };
    return getMarketOverview(toBoolean(query.live, true));
  });

  app.get('/api/v1/market/stocks', async (request) => {
    const query = request.query as Record<string, string | undefined>;

    return getStockList({
      q: query.q,
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 50),
      sort: query.sort,
      order: query.order === 'asc' ? 'asc' : 'desc'
    });
  });

  app.get('/api/v1/market/source-status', async () => {
    return getMarketDataSourceStatus();
  });

  app.get('/api/v1/market/technical', async (request) => {
    const query = request.query as {
      days?: string;
      date?: string;
    };
    const days = Math.min(
      Math.max(Number(query.days || 30), 21),
      120
    );

    return getTechnicalStocks(days, query.date);
  });

  app.post('/api/v1/market/future-prices', async (request, reply) => {
    const body = (request.body || {}) as {
      codes?: string[];
      afterDate?: string;
      days?: number;
    };

    if (!Array.isArray(body.codes) || !body.afterDate) {
      return reply.code(400).send({
        error: 'codes 和 afterDate 不能为空'
      });
    }

    return getFuturePrices(
      body.codes,
      body.afterDate,
      Number(body.days || 3)
    );
  });

  app.get('/api/v1/market/trade-dates', async (request) => {
    const query = request.query as { limit?: string };
    return {
      data: await getTradeDates(Number(query.limit || 60))
    };
  });

  app.get('/api/v1/sectors', async (request, reply) => {
    const query = request.query as {
      type?: string;
      live?: string;
    };

    const type = (query.type || 'industry') as SectorType;

    if (!['industry', 'concept'].includes(type)) {
      return reply
        .code(400)
        .send({ error: 'type 只能是 industry 或 concept' });
    }

    return {
      type,
      live: toBoolean(query.live, true),
      data: await getSectorList(
        type,
        toBoolean(query.live, true)
      )
    };
  });

  app.get('/api/v1/stocks/search', async (request) => {
    const query = request.query as { q?: string };
    return { data: await searchStocks(query.q || '') };
  });

  app.get('/api/v1/stocks/:code', async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const normalized = normalizeStockCode(code);
      return { data: await getStock(normalized) };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/stocks/:code/quote', async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const normalized = normalizeStockCode(code);

      const result = await getStockQuote(normalized);

      return {
        code: normalized,
        ...result
      };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 历史分时专用接口：仅在 GDD 已由用户启用时可用，避免绕过数据源开关。
  // 只读插件功能目录：前端无需知道 ReqType 的构造细节。
  app.get('/api/v1/gdd/features', async () => ({
    features: GDD_FEATURES.map(({ id, title, group, description, reqtype, fields }) =>
      ({ id, title, group, description, reqtype, fields })),
    configured: !!String(process.env.GDD_ACCOUNT || '').trim() &&
                !!String(process.env.GDD_PASSWORD || '').trim()
  }));

  // 受控的 GDD 功能查询：命令名称/字段/数值全部由服务端白名单校验；
  // 不接受任意 ReqType、任意 JSON Data，限制请求频率保护上游。
  const gddQueryTimes: number[] = [];
  const rateLimitGdd = () => {
    const now = Date.now();
    while (gddQueryTimes.length && gddQueryTimes[0] < now - 60_000) gddQueryTimes.shift();
    if (gddQueryTimes.length >= 30) return false;
    gddQueryTimes.push(now);
    return true;
  };
  app.get('/api/v1/gdd/features/:id', async (request, reply) => {
    try {
      const gdd = (await getSourceSettings()).find((item) => item.id === 'gdd');
      if (!gdd?.enabled || !gdd.available) {
        return reply.code(503).send({ error: '请先配置 GDD 账号密码，在数据源管理中启用 GDD' });
      }
      if (!rateLimitGdd()) return reply.code(429).send({ error: 'GDD 请求过于频繁，稍后再试' });
      const { id } = request.params as { id: string };
      const params = request.query as Record<string, unknown>;
      return await queryGddFeature(id, params);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'GDD 查询失败' });
    }
  });

  app.get('/api/v1/gdd/connection', async (request, reply) => {
    try {
      const gdd = (await getSourceSettings()).find((item) => item.id === 'gdd');
      if (!gdd?.enabled || !gdd.available) {
        return reply.code(503).send({ error: '请先配置 GDD 账号密码并启用数据源' });
      }
      if (!rateLimitGdd()) return reply.code(429).send({error:'GDD 请求过于频繁'});
      const gateway = await getGddServerAddress(36);
      let lhb: string|null = null;
      try { lhb = await getGddServerAddress(35); } catch { /* 仅标识该服务未下发 */ }
      return { authenticated:true, gateway, lhb, serverType:36, checkedAt:new Date().toISOString() };
    } catch (error) {
      return reply.code(502).send({ error:error instanceof Error ? error.message:'GDD 动态网关连接失败' });
    }
  });

  app.get('/api/v1/gdd/kline/:code', async (request, reply) => {
    try {
      const gdd = (await getSourceSettings()).find((item)=>item.id==='gdd');
      if (!gdd?.enabled || !gdd.available) return reply.code(503).send({error:'请先启用 GDD 并配置账号密码'});
      if (!rateLimitGdd()) return reply.code(429).send({error:'GDD 请求过于频繁'});
      const {code} = request.params as {code:string};
      const {period:rawPeriod,count:rawCount} = request.query as {period?:string;count?:string};
      const period = Number(rawPeriod ?? 10);
      if (![2,3,4,5,6,7,10,11,20,21,30].includes(period)) return reply.code(400).send({error:'不支持此 K线周期'});
      const count = Number(rawCount ?? 100);
      if (!Number.isInteger(count) || count < 1 || count > 500) return reply.code(400).send({error:'count 必须是1～500'});
      const stockCode = normalizeStockCode(code);
      const data = await fetchGddKline(stockCode,period,count);
      return {source:'gdd',reqtype:150,code:stockCode,period,count:data.length,data};
    } catch(error) {
      return reply.code(400).send({error:error instanceof Error?error.message:'GDD K线查询失败'});
    }
  });

  app.get('/api/v1/gdd/ticks/:code', async (request, reply) => {
    try {
      const gdd = (await getSourceSettings()).find((item) => item.id === 'gdd');
      if (!gdd?.enabled || !gdd.available) return reply.code(503).send({ error: '请先启用 GDD 并配置账号密码' });
      if (!rateLimitGdd()) return reply.code(429).send({ error: 'GDD 请求过于频繁，稍后再试' });
      const { code } = request.params as { code:string };
      const { day } = request.query as { day?:string };
      if (!day) return reply.code(400).send({ error: 'day 不能为空' });
      const normalized = normalizeStockCode(code);
      const data = await fetchGddTicks(normalized, day);
      return { source:'gdd', code:normalized, day, count:data.length, data };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'GDD 分笔查询失败' });
    }
  });

  app.get('/api/v1/gdd/trend/:code', async (request, reply) => {
    try {
      const gdd = (await getSourceSettings()).find((item) => item.id === 'gdd');
      if (!gdd?.enabled) return reply.code(503).send({ error: '请先在数据源管理中启用 GDD' });
      const { code } = request.params as { code: string };
      const { day } = request.query as { day?: string };
      const stockCode = normalizeStockCode(code);
      const data = await fetchGddTrend(stockCode, day);
      return { source: 'gdd', code: stockCode, day: day || null, count: data.length, data };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/v1/stocks/:code/daily', async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const query = request.query as {
        days?: string;
        refresh?: string;
      };

      const normalized = normalizeStockCode(code);
      const days = Math.min(
        Math.max(Number(query.days || 120), 1),
        1000
      );

      const data = await getDaily(
        normalized,
        days,
        toBoolean(query.refresh, false)
      );

      return {
        code: normalized,
        count: data.length,
        data
      };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/stocks/:code/minute', async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const query = request.query as {
        period?: string;
        limit?: string;
        refresh?: string;
      };

      const normalized = normalizeStockCode(code);
      const period = Number(query.period || 1);

      if (![1, 5, 15, 30, 60].includes(period)) {
        return reply
          .code(400)
          .send({ error: 'period 只能是 1/5/15/30/60' });
      }

      const limit = Math.min(
        Math.max(Number(query.limit || 500), 1),
        1000
      );

      const data = await getMinute(
        normalized,
        period,
        limit,
        toBoolean(query.refresh, true)
      );

      return {
        code: normalized,
        period,
        count: data.length,
        data
      };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/stocks/:code/intraday', async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const normalized = normalizeStockCode(code);
      const result = await getStockIntraday(normalized);

      return {
        code: normalized,
        source: result.source,
        degraded: result.degraded,
        count: result.data.length,
        data: result.data
      };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/v1/data-sources', async () => ({
    data: await getSourceSettings()
  }));

  app.put('/api/v1/data-sources', async (request, reply) => {
    try {
      const body = (request.body || {}) as {
        sources?: Array<{
          id: DataSourceId;
          enabled: boolean;
          priority: number;
        }>;
      };

      if (!Array.isArray(body.sources)) {
        return reply.code(400).send({
          error: 'sources 必须是数组'
        });
      }

      await saveSourceSettings(body.sources);

      return {
        success: true,
        data: await getSourceSettings()
      };
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  });

  app.post('/api/v1/data-sources/test', async (request, reply) => {
    try {
      const body = (request.body || {}) as {
        source?: DataSourceId;
        capability?: 'snapshot' | 'daily' | 'minute' | 'sector' | 'index' | 'quote';
      };

      if (!body.source) {
        return reply.code(400).send({
          error: 'source 不能为空'
        });
      }

      return await testSource(
        body.source,
        body.capability
      );
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  });

  app.post('/api/v1/sync/daily', async (request) => {
    const body = (request.body || {}) as {
      sources?: string[];
    };

    return {
      jobId: await syncDailyMarket(
        Array.isArray(body.sources)
          ? body.sources
          : []
      )
    };
  });

  app.post('/api/v1/sync/sectors', async (request) => {
    const body = (request.body || {}) as {
      sources?: string[];
    };

    return {
      jobId: await syncSectors(
        Array.isArray(body.sources)
          ? body.sources
          : []
      )
    };
  });

  app.post('/api/v1/sync/history', async (request) => {
    const body = (request.body || {}) as {
      days?: number;
      codes?: string[];
      sources?: string[];
    };

    const days = Math.min(
      Math.max(Number(body.days || 120), 20),
      1000
    );

    const codes = Array.isArray(body.codes)
      ? body.codes.map((code) => normalizeStockCode(code))
      : [];

    return {
      jobId: await syncHistory(
        days,
        codes,
        Array.isArray(body.sources)
          ? body.sources
          : []
      )
    };
  });

  app.post('/api/v1/sync/stop-all', async () => {
    return stopAllSyncs();
  });

  app.get('/api/v1/sync/jobs', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(
      Math.max(Number(query.limit || 50), 1),
      200
    );

    return { data: await getJobs(limit) };
  });

  /**
   * AI 市场接口：一次给齐指数、涨跌家数、强弱板块和活跃股票。
   */
  app.get('/api/v1/ai/market', async () => {
    return getMarketOverview(true);
  });

  /**
   * AI 个股接口：一次给齐实时行情、日 K、1 分钟数据和技术指标。
   */
  app.get('/api/v1/ai/stock/:code', async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const normalized = normalizeStockCode(code);
      return await getAiStock(normalized);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
