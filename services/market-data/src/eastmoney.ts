import { EastmoneyClient } from 'eastmoney-data-sdk';

export const eastmoney = new EastmoneyClient();

export function normalizeStockCode(code: string): string {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error('stock code must be 6 digits');
  }
  return normalized;
}

export function buildSecid(code: string): string {
  return eastmoney.utils.buildSecid(normalizeStockCode(code));
}
