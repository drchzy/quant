import { config } from './config.js';
import type { TechnicalStock } from './types.js';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${config.marketDataUrl}${path}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `market-data 请求失败：${response.status} ${text}`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * 一次获取全市场技术指标。
 * 选股服务不直接访问 market-data 的 DuckDB，服务之间只通过 HTTP API 通信。
 */
export async function getTechnicalStocks(date?: string) {
  const query = date
    ? `/api/v1/market/technical?days=30&date=${encodeURIComponent(date)}`
    : '/api/v1/market/technical?days=30';

  return getJson<{
    tradeDate: string | null;
    count: number;
    data: TechnicalStock[];
  }>(query);
}

export async function getTradeDates(limit = 60) {
  return getJson<{ data: string[] }>(
    `/api/v1/market/trade-dates?limit=${limit}`
  );
}

export async function getFuturePrices(
  codes: string[],
  afterDate: string,
  days = 3
) {
  const response = await fetch(
    `${config.marketDataUrl}/api/v1/market/future-prices`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        codes,
        afterDate,
        days
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `market-data 请求失败：${response.status} ${text}`
    );
  }

  return response.json() as Promise<{
    afterDate: string;
    days: number;
    count: number;
    data: Array<{
      code: string;
      trade_date: string;
      open: number;
      close: number;
      high: number;
      low: number;
      pre_close: number;
      volume: number;
      amount: number;
      pct: number;
      change: number;
      amplitude: number;
      turnover: number;
    }>;
  }>;
}

export async function getMarketOverview() {
  return getJson<any>('/api/v1/market/overview?live=false');
}
