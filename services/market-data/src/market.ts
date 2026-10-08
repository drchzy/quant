import { all, one, run } from './database.js';
import { calculateIndicators } from './indicator.js';
import {
  buildSecid,
  eastmoney,
  getMarketStocks,
  getSectors,
  mainIndexes
} from './eastmoney.js';
import type { MarketStock, SectorType } from './types.js';

let marketCache:
  | { time: number; data: MarketStock[] }
  | null = null;

const sectorCache = new Map<
  SectorType,
  { time: number; data: Awaited<ReturnType<typeof getSectors>> }
>();

async function getLiveMarket(): Promise<MarketStock[]> {
  const now = Date.now();

  if (marketCache && now - marketCache.time < 15_000) {
    return marketCache.data;
  }

  const data = await getMarketStocks();
  marketCache = { time: now, data };
  return data;
}

async function getLiveSectors(type: SectorType) {
  const now = Date.now();
  const cached = sectorCache.get(type);

  if (cached && now - cached.time < 30_000) {
    return cached.data;
  }

  const data = await getSectors(type);
  sectorCache.set(type, { time: now, data });
  return data;
}

function buildBreadth(rows: MarketStock[]) {
  const valid = rows.filter((item) => item.price > 0);
  const byPct = [...valid].sort((a, b) => b.pct - a.pct);
  const byAmount = [...valid].sort((a, b) => b.amount - a.amount);

  return {
    total: valid.length,
    up: valid.filter((item) => item.pct > 0).length,
    down: valid.filter((item) => item.pct < 0).length,
    flat: valid.filter((item) => item.pct === 0).length,
    up3: valid.filter((item) => item.pct >= 3).length,
    down3: valid.filter((item) => item.pct <= -3).length,
    amount: valid.reduce((sum, item) => sum + item.amount, 0),
    topGainers: byPct.slice(0, 10),
    topLosers: byPct.slice(-10).reverse(),
    topAmount: byAmount.slice(0, 10)
  };
}

/**
 * 市场总览同时给页面和 AI 使用。
 * live=true 时直接获取当前东财数据，避免依赖数据库里上一次同步结果。
 */
export async function getMarketOverview(live = true) {
  let marketRows: MarketStock[];

  if (live) {
    marketRows = await getLiveMarket();
  } else {
    marketRows = await all<MarketStock>(`
      SELECT
        s.code,
        s.name,
        s.market,
        d.close AS price,
        d.pct,
        d.change,
        d.volume,
        d.amount,
        d.amplitude,
        d.turnover,
        d.pe,
        d.volume_ratio AS volumeRatio,
        d.high,
        d.low,
        d.open,
        d.pre_close AS preClose,
        d.total_market_cap AS totalMarketCap,
        d.float_market_cap AS floatMarketCap,
        d.pb
      FROM daily_price d
      JOIN stock s ON s.code = d.code
      WHERE d.trade_date = (SELECT MAX(trade_date) FROM daily_price)
    `);
  }

  const indexes = live
    ? await Promise.all(
        mainIndexes.map(async (item) => ({
          ...item,
          quote: await eastmoney.quote(item.secid)
        }))
      )
    : await all<any>('SELECT * FROM market_index ORDER BY code');

  const [industry, concept] = live
    ? await Promise.all([
        getLiveSectors('industry'),
        getLiveSectors('concept')
      ])
    : await Promise.all([
        all<any>(
          `SELECT * FROM sector WHERE type = 'industry' ORDER BY pct DESC`
        ),
        all<any>(
          `SELECT * FROM sector WHERE type = 'concept' ORDER BY pct DESC`
        )
      ]);

  const sortDesc = (rows: any[]) =>
    [...rows].sort((a, b) => Number(b.pct || 0) - Number(a.pct || 0));

  const sortAsc = (rows: any[]) =>
    [...rows].sort((a, b) => Number(a.pct || 0) - Number(b.pct || 0));

  return {
    updatedAt: new Date().toISOString(),
    live,
    breadth: buildBreadth(marketRows),
    indexes,
    sectors: {
      industryTop: sortDesc(industry).slice(0, 10),
      industryBottom: sortAsc(industry).slice(0, 10),
      conceptTop: sortDesc(concept).slice(0, 10),
      conceptBottom: sortAsc(concept).slice(0, 10)
    }
  };
}

export async function getStockList(options: {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}) {
  const page = Math.max(options.page || 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize || 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const q = (options.q || '').trim();

  const allowedSort = new Map([
    ['code', 's.code'],
    ['name', 's.name'],
    ['pct', 'd.pct'],
    ['amount', 'd.amount'],
    ['turnover', 'd.turnover'],
    ['marketCap', 'd.total_market_cap']
  ]);

  const sort = allowedSort.get(options.sort || '') || 'd.amount';
  const order = options.order === 'asc' ? 'ASC' : 'DESC';

  const where = q ? 'WHERE s.code LIKE ? OR s.name LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::INTEGER AS count FROM stock s ${where}`,
    params
  );

  const data = await all<any>(
    `SELECT
      s.code,
      s.name,
      s.market,
      s.market_name,
      d.trade_date,
      d.close,
      d.pct,
      d.amount,
      d.turnover,
      d.volume_ratio,
      d.pe,
      d.pb,
      d.total_market_cap,
      d.float_market_cap
     FROM stock s
     LEFT JOIN daily_price d
       ON d.code = s.code
      AND d.trade_date = (SELECT MAX(trade_date) FROM daily_price)
     ${where}
     ORDER BY ${sort} ${order} NULLS LAST
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    page,
    pageSize,
    total: total?.count || 0,
    data
  };
}

export async function searchStocks(q: string, limit = 20) {
  const value = q.trim();
  if (!value) return [];

  return all<any>(
    `SELECT code, name, market_name
     FROM stock
     WHERE code LIKE ? OR name LIKE ?
     ORDER BY
       CASE WHEN code = ? OR name = ? THEN 0 ELSE 1 END,
       code
     LIMIT ?`,
    [`%${value}%`, `%${value}%`, value, value, limit]
  );
}

export async function getStock(code: string) {
  return one<any>(
    `SELECT
      s.*,
      d.trade_date,
      d.open,
      d.close,
      d.high,
      d.low,
      d.pre_close,
      d.volume,
      d.amount,
      d.pct,
      d.change,
      d.amplitude,
      d.turnover,
      d.pe,
      d.pb,
      d.volume_ratio,
      d.total_market_cap,
      d.float_market_cap
     FROM stock s
     LEFT JOIN daily_price d
       ON d.code = s.code
      AND d.trade_date = (
        SELECT MAX(trade_date)
        FROM daily_price
        WHERE code = s.code
      )
     WHERE s.code = ?`,
    [code]
  );
}

export async function getDaily(
  code: string,
  days = 120,
  refresh = false
) {
  if (refresh) {
    const rows = await eastmoney.dailyKline(buildSecid(code), days, 1);

    for (const item of rows) {
      await run(
        `INSERT OR REPLACE INTO daily_price (
          code, trade_date, open, close, high, low,
          volume, amount, pct, change, amplitude, turnover,
          source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'eastmoney-kline', current_timestamp)`,
        [
          code,
          item.date.slice(0, 10),
          item.open,
          item.close,
          item.high,
          item.low,
          item.volume,
          item.amount,
          item.pct,
          item.change,
          item.amplitude,
          item.turnover
        ]
      );
    }
  }

  let data = await all<any>(
    `SELECT *
     FROM daily_price
     WHERE code = ?
     ORDER BY trade_date DESC
     LIMIT ?`,
    [code, days]
  );

  data = data.reverse();

  if (data.length === 0 && !refresh) {
    return getDaily(code, days, true);
  }

  return data;
}

export async function getMinute(
  code: string,
  period = 1,
  limit = 500,
  refresh = true
) {
  if (refresh) {
    const rows = await eastmoney.minuteKline(
      buildSecid(code),
      period as 1 | 5 | 15 | 30 | 60,
      limit
    );

    for (const item of rows) {
      await run(
        `INSERT OR REPLACE INTO minute_price (
          code, period, trade_time, open, close, high, low,
          volume, amount, pct, change, turnover, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'eastmoney', current_timestamp)`,
        [
          code,
          period,
          item.date,
          item.open,
          item.close,
          item.high,
          item.low,
          item.volume,
          item.amount,
          item.pct,
          item.change,
          item.turnover
        ]
      );
    }
  }

  let data = await all<any>(
    `SELECT *
     FROM minute_price
     WHERE code = ? AND period = ?
     ORDER BY trade_time DESC
     LIMIT ?`,
    [code, period, limit]
  );

  data = data.reverse();
  return data;
}

export async function getSectorList(
  type: SectorType,
  live = true
) {
  if (live) return getLiveSectors(type);

  return all<any>(
    `SELECT * FROM sector
     WHERE type = ?
     ORDER BY pct DESC`,
    [type]
  );
}

/**
 * AI 个股接口一次返回常用上下文，减少 AI 连续请求多个底层接口。
 */
export async function getAiStock(code: string) {
  const [stock, quote, daily, minute, intraday] = await Promise.all([
    getStock(code),
    eastmoney.quote(buildSecid(code)),
    getDaily(code, 120, false),
    getMinute(code, 1, 240, true),
    eastmoney.intradayTrend(buildSecid(code))
  ]);

  return {
    code,
    stock,
    quote,
    indicators: calculateIndicators(daily as any),
    daily,
    minute,
    intraday,
    generatedAt: new Date().toISOString()
  };
}
