import { config } from './config.js';
import type { LiveStock } from './types.js';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${config.marketDataUrl}${path}`);

  if (!response.ok) {
    throw new Error(
      `market-data 请求失败：${response.status} ${await response.text()}`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * 同时读取实时行情和当日分时。
 * 分时最后一条的日期用来判断东财返回的是今天数据还是节假日/停牌旧数据。
 */
export async function getLiveStock(code: string): Promise<LiveStock> {
  const [quoteResult, intradayResult] = await Promise.all([
    getJson<any>(`/api/v1/stocks/${code}/quote`),
    getJson<any>(`/api/v1/stocks/${code}/intraday`)
  ]);

  const quote = quoteResult.data || {};
  const intraday = Array.isArray(intradayResult.data)
    ? intradayResult.data
    : [];
  const latest = intraday.at(-1);

  return {
    code,
    name: String(quote.name || code),
    price: Number(quote.price || 0),
    high: Number(quote.high || 0),
    low: Number(quote.low || 0),
    open: Number(quote.open || 0),
    preClose: Number(quote.preClose || 0),
    pct: Number(quote.pct || 0),
    avgPrice:
      latest?.avgPrice === undefined
        ? null
        : Number(latest.avgPrice),
    marketTime: latest?.datetime || null,
    marketDate: latest?.datetime
      ? String(latest.datetime).slice(0, 10)
      : null,
    intraday
  };
}

export async function getTradeDates(limit = 10) {
  return getJson<{ data: string[] }>(
    `/api/v1/market/trade-dates?limit=${limit}`
  );
}
