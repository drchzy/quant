import { EastmoneyClient } from 'eastmoney-data-sdk';
import { config } from './config.js';
import type { MainIndex, MarketStock, SectorRow, SectorType } from './types.js';

export const eastmoney = new EastmoneyClient();

const requestHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
  Accept: 'application/json,text/plain,*/*'
};

const stockListUrl = 'https://push2.eastmoney.com/api/qt/clist/get';

/**
 * 页面固定展示的主要指数。
 */
export const mainIndexes: MainIndex[] = [
  { code: '000001', name: '上证指数', secid: '1.000001' },
  { code: '399001', name: '深证成指', secid: '0.399001' },
  { code: '399006', name: '创业板指', secid: '0.399006' },
  { code: '000688', name: '科创50', secid: '1.000688' },
  { code: '000300', name: '沪深300', secid: '1.000300' }
];

export function normalizeStockCode(code: string): string {
  const value = code.trim();
  if (!/^\d{6}$/.test(value)) {
    throw new Error('股票代码必须是 6 位数字');
  }
  return value;
}

export function buildSecid(code: string): string {
  return eastmoney.utils.buildSecid(normalizeStockCode(code));
}

function toNumber(value: unknown, defaultValue = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function toNullableNumber(value: unknown): number | null {
  if (value === '-' || value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getJson(url: URL): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.eastmoneyTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`东方财富返回 HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 分页获取全 A 股基础行情。
 * 东财一次返回多只股票，因此同步 5000 多只股票不需要 5000 次请求。
 *
 * eastmoney-data-sdk 当前股票列表没有返回开高低、昨收、PE/PB、量比，
 * 这里仍使用相同的东财接口补齐这些字段。
 */
export async function getMarketStocks(): Promise<MarketStock[]> {
  const result: MarketStock[] = [];
  const pageSize = config.eastmoneyPageSize;

  for (let page = 1; page <= 30; page += 1) {
    const url = new URL(stockListUrl);
    url.searchParams.set('pn', String(page));
    url.searchParams.set('pz', String(pageSize));
    url.searchParams.set('po', '1');
    url.searchParams.set('np', '1');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', 'f3');
    url.searchParams.set(
      'fs',
      'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'
    );
    url.searchParams.set(
      'fields',
      'f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23'
    );
    url.searchParams.set('_', String(Date.now()));

    const json = await getJson(url);
    const rows = json?.data?.diff;

    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      result.push({
        code: String(row.f12 || ''),
        name: String(row.f14 || ''),
        market: toNumber(row.f13),
        price: toNumber(row.f2),
        pct: toNumber(row.f3),
        change: toNumber(row.f4),
        volume: toNumber(row.f5),
        amount: toNumber(row.f6),
        amplitude: toNumber(row.f7),
        turnover: toNumber(row.f8),
        pe: toNullableNumber(row.f9),
        volumeRatio: toNullableNumber(row.f10),
        high: toNumber(row.f15),
        low: toNumber(row.f16),
        open: toNumber(row.f17),
        preClose: toNumber(row.f18),
        totalMarketCap: toNumber(row.f20),
        floatMarketCap: toNumber(row.f21),
        pb: toNullableNumber(row.f23)
      });
    }

    if (rows.length < pageSize) break;
  }

  return result.filter((item) => item.code && item.name);
}

/**
 * 获取行业或概念板块实时排名。
 */
export async function getSectors(type: SectorType): Promise<SectorRow[]> {
  const url = new URL(stockListUrl);
  url.searchParams.set('pn', '1');
  url.searchParams.set('pz', '500');
  url.searchParams.set('po', '1');
  url.searchParams.set('np', '1');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('invt', '2');
  url.searchParams.set('fid', 'f3');
  url.searchParams.set(
    'fs',
    type === 'industry' ? 'm:90+t:2+f:!50' : 'm:90+t:3+f:!50'
  );
  url.searchParams.set('fields', 'f2,f3,f12,f14,f62,f104,f105,f128');
  url.searchParams.set('_', String(Date.now()));

  const json = await getJson(url);
  const rows = json?.data?.diff;
  if (!Array.isArray(rows)) return [];

  return rows.map((row: any) => ({
    type,
    code: String(row.f12 || ''),
    name: String(row.f14 || ''),
    price: toNumber(row.f2),
    pct: toNumber(row.f3),
    mainInflow: toNumber(row.f62),
    upCount: toNumber(row.f104),
    downCount: toNumber(row.f105),
    leadStock: String(row.f128 || '')
  }));
}

/**
 * 用上证指数最后一根日 K 的日期作为最新交易日。
 * 这样节假日执行同步时，不会写入一个不存在的交易日。
 */
export async function getLatestTradeDate(): Promise<string> {
  const rows = await eastmoney.kline({
    secid: '1.000001',
    klt: 101,
    fqt: 0,
    limit: 5
  });
  const last = rows.at(-1);
  if (!last?.date) throw new Error('无法取得最新交易日');
  return last.date.slice(0, 10);
}
