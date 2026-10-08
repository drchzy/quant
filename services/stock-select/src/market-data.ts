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
export async function getTechnicalStocks() {
  return getJson<{
    tradeDate: string | null;
    count: number;
    data: TechnicalStock[];
  }>('/api/v1/market/technical?days=30');
}

export async function getMarketOverview() {
  return getJson<any>('/api/v1/market/overview?live=false');
}
