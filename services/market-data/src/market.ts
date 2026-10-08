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


function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNumber(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

/**
 * 返回全市场用于策略筛选的技术数据。
 *
 * 这里仍属于“行情加工层”，只计算客观指标，不做选股结论。
 * stock-select 服务会基于这些字段执行具体策略。
 */
export async function getTechnicalStocks(days = 30, tradeDate?: string) {
  const safeDays = Math.min(Math.max(days, 21), 120);

  // 回测时允许指定历史交易日；不传日期时使用数据库里的最新数据。
  const effectiveDateRow = tradeDate
    ? await one<{ trade_date: string }>(
        `SELECT MAX(trade_date)::VARCHAR AS trade_date
         FROM daily_price
         WHERE trade_date <= CAST(? AS DATE)`,
        [tradeDate]
      )
    : await one<{ trade_date: string }>(
        `SELECT MAX(trade_date)::VARCHAR AS trade_date
         FROM daily_price`
      );

  const effectiveDate = effectiveDateRow?.trade_date?.slice(0, 10) || null;

  if (!effectiveDate) {
    return { tradeDate: null, count: 0, data: [] };
  }

  const rows = await all<any>(
    `WITH ranked AS (
       SELECT
         s.code,
         s.name,
         s.market_name,
         d.trade_date::VARCHAR AS trade_date,
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
         d.float_market_cap,
         ROW_NUMBER() OVER (
           PARTITION BY d.code
           ORDER BY d.trade_date DESC
         ) AS rn
       FROM daily_price d
       JOIN stock s ON s.code = d.code
       WHERE d.trade_date <= CAST(? AS DATE)
     )
     SELECT *
     FROM ranked
     WHERE rn <= ?
     ORDER BY code, trade_date`,
    [effectiveDate, safeDays]
  );

  const groups = new Map<string, any[]>();

  for (const row of rows) {
    const list = groups.get(row.code) || [];
    list.push(row);
    groups.set(row.code, list);
  }

  const data: any[] = [];

  for (const [code, list] of groups) {
    if (list.length < 20) continue;

    const current = list.at(-1)!;

    // 停牌股票可能最后一根K线早于目标交易日，回测时不把它当作当天候选。
    if (String(current.trade_date).slice(0, 10) !== effectiveDate) {
      continue;
    }
    const previous = list.length >= 2 ? list.at(-2)! : null;
    const closes = list.map((row) => Number(row.close));
    const volumes = list.map((row) => Number(row.volume || 0));
    const amounts = list.map((row) => Number(row.amount || 0));

    const ma5 = avg(closes.slice(-5));
    const ma10 = avg(closes.slice(-10));
    const ma20 = avg(closes.slice(-20));

    const ma5Prev =
      closes.length >= 6 ? avg(closes.slice(-6, -1)) : null;
    const ma10Prev =
      closes.length >= 11 ? avg(closes.slice(-11, -1)) : null;

    const close = Number(current.close);
    const ret5 =
      closes.length >= 6
        ? (close / closes[closes.length - 6] - 1) * 100
        : null;
    const ret20 =
      closes.length >= 21
        ? (close / closes[closes.length - 21] - 1) * 100
        : null;

    // 突破判断使用“当前交易日前”的20日高点，避免把当天最高价算进去。
    const previous20 = list.slice(-21, -1);
    const previousHigh20 =
      previous20.length > 0
        ? Math.max(...previous20.map((row) => Number(row.high)))
        : null;
    const previousLow20 =
      previous20.length > 0
        ? Math.min(...previous20.map((row) => Number(row.low)))
        : null;

    const avgVolume5 = avg(volumes.slice(-6, -1));
    const avgAmount5 = avg(amounts.slice(-6, -1));
    const volumeRate5 =
      avgVolume5 && avgVolume5 > 0
        ? Number(current.volume || 0) / avgVolume5
        : null;

    const high = Number(current.high || close);
    const low = Number(current.low || close);
    const closeStrength =
      high > low ? (close - low) / (high - low) : 0.5;

    const closeToMa5 =
      ma5 && ma5 > 0 ? (close / ma5 - 1) * 100 : null;

    const highToClose =
      high > low ? (high - close) / (high - low) : 0;

    data.push({
      code,
      name: current.name,
      marketName: current.market_name,
      tradeDate: String(current.trade_date).slice(0, 10),
      open: Number(current.open),
      close,
      high,
      low,
      preClose: Number(current.pre_close || 0),
      pct: Number(current.pct || 0),
      amount: Number(current.amount || 0),
      volume: Number(current.volume || 0),
      turnover:
        current.turnover === null ? null : Number(current.turnover),
      volumeRatio:
        current.volume_ratio === null
          ? null
          : Number(current.volume_ratio),
      pe: current.pe === null ? null : Number(current.pe),
      pb: current.pb === null ? null : Number(current.pb),
      marketCap: Number(current.total_market_cap || 0),
      floatMarketCap: Number(current.float_market_cap || 0),
      ma5: roundNumber(ma5),
      ma10: roundNumber(ma10),
      ma20: roundNumber(ma20),
      ma5Prev: roundNumber(ma5Prev),
      ma10Prev: roundNumber(ma10Prev),
      return5: roundNumber(ret5),
      return20: roundNumber(ret20),
      previousHigh20: roundNumber(previousHigh20),
      previousLow20: roundNumber(previousLow20),
      volumeRate5: roundNumber(volumeRate5),
      avgAmount5: roundNumber(avgAmount5, 0),
      closeStrength: roundNumber(closeStrength),
      closeToMa5: roundNumber(closeToMa5),
      highToClose: roundNumber(highToClose),
      previousPct:
        previous?.pct === null || previous?.pct === undefined
          ? null
          : Number(previous.pct),
      previousOpen:
        previous?.open === null || previous?.open === undefined
          ? null
          : Number(previous.open),
      previousClose:
        previous?.close === null || previous?.close === undefined
          ? null
          : Number(previous.close),
      historyDays: list.length
    });
  }

  return {
    tradeDate: effectiveDate,
    count: data.length,
    data
  };
}

/**
 * 返回若干股票在指定交易日之后的日K。
 * 主要给选股复盘和回测使用，避免策略服务逐只请求。
 */
export async function getFuturePrices(
  codes: string[],
  afterDate: string,
  days = 3
) {
  const safeCodes = [...new Set(codes)]
    .filter((code) => /^\d{6}$/.test(code))
    .slice(0, 100);
  const safeDays = Math.min(Math.max(days, 1), 10);

  if (safeCodes.length === 0) {
    return { afterDate, days: safeDays, count: 0, data: [] };
  }

  const placeholders = safeCodes.map(() => '?').join(',');

  const rows = await all<any>(
    `WITH future AS (
       SELECT
         d.code,
         d.trade_date::VARCHAR AS trade_date,
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
         ROW_NUMBER() OVER (
           PARTITION BY d.code
           ORDER BY d.trade_date
         ) AS rn
       FROM daily_price d
       WHERE d.code IN (${placeholders})
         AND d.trade_date > CAST(? AS DATE)
     )
     SELECT *
     FROM future
     WHERE rn <= ?
     ORDER BY code, trade_date`,
    [...safeCodes, afterDate, safeDays]
  );

  return {
    afterDate,
    days: safeDays,
    count: rows.length,
    data: rows
  };
}

/**
 * 返回数据库最近的交易日列表，供历史回测逐日重放。
 */
export async function getTradeDates(limit = 60) {
  const safeLimit = Math.min(Math.max(limit, 1), 250);

  const rows = await all<{ trade_date: string }>(
    `SELECT DISTINCT trade_date::VARCHAR AS trade_date
     FROM daily_price
     ORDER BY trade_date DESC
     LIMIT ?`,
    [safeLimit]
  );

  return rows
    .map((row) => row.trade_date.slice(0, 10))
    .reverse();
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
