import { config } from './config.js';
import type { SelectionItem } from './types.js';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${config.stockSelectUrl}${path}`);

  if (!response.ok) {
    throw new Error(
      `stock-select 请求失败：${response.status} ${await response.text()}`
    );
  }

  return response.json() as Promise<T>;
}

export async function getLatestSelection(limit = config.monitorTopCount) {
  return getJson<{
    run: {
      id: string;
      trade_date: string;
      strategy: string;
    } | null;
    data: SelectionItem[];
  }>(`/api/v1/select/latest?limit=${limit}`);
}

export async function getSelectionContext() {
  return getJson<any>('/api/v1/select/ai');
}
