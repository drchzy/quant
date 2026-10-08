import { config } from './config.js';
import { getSourceSettings } from './source-manager.js';
import {
  getTencentDailyKline,
  getTencentMinuteKline,
  type FallbackKLine
} from './tencent.js';
import type {
  MainIndex,
  MarketStock,
  SectorRow,
  SectorType
} from './types.js';

const requestHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'close'
};

const liveBases = [
  // 2026 年部分网络下 push2 会直接断开，优先使用独立的延时集群。
  'https://push2delay.eastmoney.com',
  'https://push2.eastmoney.com'
];

const historyBases = [
  'https://push2his.eastmoney.com'
];

export interface SourceStatus {
  lastSuccessAt: string | null;
  lastSuccessHost: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

const sourceStatus: Record<'live' | 'history', SourceStatus> = {
  live: {
    lastSuccessAt: null,
    lastSuccessHost: null,
    lastErrorAt: null,
    lastError: null
  },
  history: {
    lastSuccessAt: null,
    lastSuccessHost: null,
    lastErrorAt: null,
    lastError: null
  }
};

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestStart = 0;

const quoteCache = new Map<
  string,
  { time: number; data: any }
>();
const trendCache = new Map<
  string,
  { time: number; data: any[] }
>();
const quoteInflight = new Map<string, Promise<any>>();
const trendInflight = new Map<string, Promise<any[]>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as any).cause;
    if (cause?.message) {
      return `${error.message}: ${cause.message}`;
    }
    return error.message;
  }
  return String(error);
}

/**
 * 东财所有 HTTP 请求共用一个全局队列。
 * SDK 自带限流只能约束 SDK 自己，无法约束我们额外的 clist 请求；
 * 统一收口后可以避免多个页面/服务同时把同一个出口 IP 打进风控。
 */
async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const previous = requestQueue;
  let release!: () => void;

  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  const jitter = Math.floor(Math.random() * 180);
  const wait = Math.max(
    0,
    config.eastmoneyMinIntervalMs +
      jitter -
      (Date.now() - lastRequestStart)
  );

  if (wait > 0) await sleep(wait);
  lastRequestStart = Date.now();

  try {
    return await fn();
  } finally {
    release();
  }
}

function markSuccess(
  kind: 'live' | 'history',
  host: string
) {
  sourceStatus[kind].lastSuccessAt = new Date().toISOString();
  sourceStatus[kind].lastSuccessHost = host;
  sourceStatus[kind].lastError = null;
}

function markFailure(
  kind: 'live' | 'history',
  error: unknown
) {
  sourceStatus[kind].lastErrorAt = new Date().toISOString();
  sourceStatus[kind].lastError = errorText(error);
}

async function requestJson(
  kind: 'live' | 'history',
  bases: string[],
  path: string,
  params: URLSearchParams
 ): Promise<any> {
  const settings = await getSourceSettings();
  if (!settings.some((item) => item.id === 'eastmoney_push2' && item.enabled)) {
    throw new Error('东方财富 Push2 已禁用，跳过外部请求');
  }

  let lastError: unknown;

  for (const base of bases) {
    for (
      let attempt = 0;
      attempt <= config.eastmoneyRetryCount;
      attempt += 1
    ) {
      try {
        const json = await throttle(async () => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            config.eastmoneyTimeoutMs
          );

          try {
            const url = `${base}${path}?${params.toString()}`;
            const response = await fetch(url, {
              headers: requestHeaders,
              signal: controller.signal
            });

            if (!response.ok) {
              throw new Error(
                `东方财富 HTTP ${response.status}：${new URL(base).hostname}${path}`
              );
            }

            const text = await response.text();
            if (!text.trim()) {
              throw new Error(
                `东方财富返回空响应：${new URL(base).hostname}${path}`
              );
            }

            try {
              return JSON.parse(text);
            } catch {
              throw new Error(
                `东方财富返回非 JSON：${new URL(base).hostname}${path}`
              );
            }
          } finally {
            clearTimeout(timer);
          }
        });

        markSuccess(kind, new URL(base).hostname);
        return json;
      } catch (error) {
        lastError = error;
        markFailure(kind, error);

        console.warn(
          `东方财富请求失败 [${kind}] ${new URL(base).hostname}${path}，第 ${attempt + 1} 次：${errorText(error)}`
        );

        if (attempt < config.eastmoneyRetryCount) {
          await sleep(
            config.eastmoneyRetryBaseMs * Math.pow(2, attempt)
          );
        }
      }
    }
  }

  throw new Error(
    `东方财富${kind === 'live' ? '实时' : '历史'}接口不可用：${errorText(lastError)}`
  );
}

function toNumber(value: unknown, defaultValue = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function toNullableNumber(value: unknown): number | null {
  if (
    value === '-' ||
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function detectMarket(code: string): 0 | 1 {
  // 沪市股票、基金和B股通常以5/6/9开头；北交所和深市均使用0。
  return /^(5|6|9)/.test(code) ? 1 : 0;
}

export function normalizeStockCode(code: string): string {
  const value = code.trim();
  if (!/^\d{6}$/.test(value)) {
    throw new Error('股票代码必须是 6 位数字');
  }
  return value;
}

export function buildSecid(code: string): string {
  const normalized = normalizeStockCode(code);
  return `${detectMarket(normalized)}.${normalized}`;
}

function codeFromSecid(secid: string): string {
  return secid.split('.').at(-1) || '';
}

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

function parseQuote(data: any) {
  if (!data) return null;

  return {
    code: String(data.f57 || ''),
    name: String(data.f58 || ''),
    price: toNumber(data.f43),
    high: toNumber(data.f44),
    low: toNumber(data.f45),
    open: toNumber(data.f46),
    volume: toNumber(data.f47),
    amount: toNumber(data.f48),
    preClose: toNumber(data.f60),
    updateTime: toNumber(data.f86),
    totalMarketCap: toNumber(data.f116),
    floatMarketCap: toNumber(data.f117),
    pe: toNullableNumber(data.f162),
    pb: toNullableNumber(data.f167),
    turnover: toNullableNumber(data.f168),
    change: toNumber(data.f169),
    pct: toNumber(data.f170)
  };
}

export async function getQuote(secid: string) {
  const cached = quoteCache.get(secid);
  const now = Date.now();

  if (
    cached &&
    now - cached.time < config.quoteCacheTtlMs
  ) {
    return cached.data;
  }

  const running = quoteInflight.get(secid);
  if (running) return running;

  const task = (async () => {
    const params = new URLSearchParams({
      secid,
      fields:
        'f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f116,f117,f162,f167,f168,f169,f170',
      invt: '2',
      fltt: '2',
      _: String(Date.now())
    });

    const json = await requestJson(
      'live',
      liveBases,
      '/api/qt/stock/get',
      params
    );

    const result = parseQuote(json?.data);
    if (!result) {
      throw new Error(`东方财富没有返回 ${secid} 行情`);
    }

    quoteCache.set(secid, {
      time: Date.now(),
      data: result
    });

    return result;
  })().finally(() => quoteInflight.delete(secid));

  quoteInflight.set(secid, task);
  return task;
}

/**
 * 主要指数一次批量请求，避免首页刷新时连续打5次 quote。
 */
export async function getBatchQuotes(secids: string[]) {
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    fields:
      'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18',
    secids: secids.join(','),
    _: String(Date.now())
  });

  const json = await requestJson(
    'live',
    liveBases,
    '/api/qt/ulist.np/get',
    params
  );

  const rows = Array.isArray(json?.data?.diff)
    ? json.data.diff
    : [];

  const map = new Map<string, any>();

  for (const row of rows) {
    const code = String(row.f12 || '');
    map.set(code, {
      code,
      name: String(row.f14 || ''),
      price: toNumber(row.f2),
      pct: toNumber(row.f3),
      change: toNumber(row.f4),
      volume: toNumber(row.f5),
      amount: toNumber(row.f6),
      high: toNumber(row.f15),
      low: toNumber(row.f16),
      open: toNumber(row.f17),
      preClose: toNumber(row.f18)
    });
  }

  return map;
}

/**
 * 分页获取全 A 股基础行情。
 * 2026 年部分出口 IP 对 push2 会直接断连接，所以优先走 push2delay。
 */
export async function getMarketStocks(): Promise<MarketStock[]> {
  const result: MarketStock[] = [];
  const pageSize = config.eastmoneyPageSize;

  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(pageSize),
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fid: 'f3',
      fs:
        'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
      fields:
        'f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23',
      _: String(Date.now())
    });

    const json = await requestJson(
      'live',
      liveBases,
      '/api/qt/clist/get',
      params
    );

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

    const total = Number(json?.data?.total || 0);
    if (total > 0 && result.length >= total) break;
    if (rows.length < pageSize) break;
  }

  return result.filter((item) => item.code && item.name);
}

export async function getSectors(
  type: SectorType
): Promise<SectorRow[]> {
  const result: SectorRow[] = [];
  const pageSize = 100;

  for (let page = 1; page <= 20; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(pageSize),
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fid: 'f3',
      fs:
        type === 'industry'
          ? 'm:90+t:2+f:!50'
          : 'm:90+t:3+f:!50',
      fields: 'f2,f3,f12,f14,f62,f104,f105,f128',
      _: String(Date.now())
    });

    const json = await requestJson(
      'live',
      liveBases,
      '/api/qt/clist/get',
      params
    );

    const rows = json?.data?.diff;
    if (!Array.isArray(rows) || rows.length === 0) break;

    result.push(
      ...rows.map((row: any) => ({
        type,
        code: String(row.f12 || ''),
        name: String(row.f14 || ''),
        price: toNumber(row.f2),
        pct: toNumber(row.f3),
        mainInflow: toNumber(row.f62),
        upCount: toNumber(row.f104),
        downCount: toNumber(row.f105),
        leadStock: String(row.f128 || '')
      }))
    );

    const total = Number(json?.data?.total || 0);
    if (total > 0 && result.length >= total) break;
    if (rows.length < pageSize) break;
  }

  return result;
}

function parseKline(raw: string[]): FallbackKLine[] {
  return raw
    .map((line) => String(line).split(','))
    .filter((row) => row.length >= 11)
    .map((row) => ({
      date: row[0],
      open: toNumber(row[1]),
      close: toNumber(row[2]),
      high: toNumber(row[3]),
      low: toNumber(row[4]),
      volume: toNumber(row[5]),
      amount: toNullableNumber(row[6]),
      amplitude: toNullableNumber(row[7]),
      pct: toNullableNumber(row[8]),
      change: toNullableNumber(row[9]),
      turnover: toNullableNumber(row[10])
    }));
}

async function getEastmoneyKline(
  secid: string,
  period: number,
  limit: number,
  fqt: 0 | 1 | 2
) {
  const params = new URLSearchParams({
    secid,
    klt: String(period),
    fqt: String(fqt),
    lmt: String(limit),
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2:
      'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    _: String(Date.now())
  });

  const json = await requestJson(
    'history',
    historyBases,
    '/api/qt/stock/kline/get',
    params
  );

  const rows = json?.data?.klines;
  if (!Array.isArray(rows)) return [];

  return parseKline(rows);
}

/**
 * 日K优先东财，push2his 被封时自动切腾讯。
 */
export async function getDailyKline(
  code: string,
  limit = 120,
  fqt: 0 | 1 | 2 = 1
): Promise<{
  source: 'eastmoney-kline' | 'tencent-kline';
  data: FallbackKLine[];
}> {
  try {
    const rows = await getEastmoneyKline(
      buildSecid(code),
      101,
      limit,
      fqt
    );

    if (rows.length > 0) {
      return {
        source: 'eastmoney-kline',
        data: rows
      };
    }
  } catch (error) {
    console.warn(
      `东财日K失败，切换腾讯备用源 ${code}：${errorText(error)}`
    );
  }

  return {
    source: 'tencent-kline',
    data: await getTencentDailyKline(code, limit)
  };
}

/**
 * 分钟K优先东财，失败时切腾讯 mkline。
 */
export async function getMinuteKline(
  code: string,
  period: 1 | 5 | 15 | 30 | 60,
  limit = 240
): Promise<{
  source: 'eastmoney-minute' | 'tencent-minute';
  data: FallbackKLine[];
}> {
  try {
    const rows = await getEastmoneyKline(
      buildSecid(code),
      period,
      limit,
      0
    );

    if (rows.length > 0) {
      return {
        source: 'eastmoney-minute',
        data: rows
      };
    }
  } catch (error) {
    console.warn(
      `东财分钟K失败，切换腾讯备用源 ${code}：${errorText(error)}`
    );
  }

  return {
    source: 'tencent-minute',
    data: await getTencentMinuteKline(
      code,
      period,
      limit
    )
  };
}

export async function getIntradayTrend(secid: string) {
  const cached = trendCache.get(secid);
  const now = Date.now();

  if (
    cached &&
    now - cached.time < config.trendCacheTtlMs
  ) {
    return cached.data;
  }

  const running = trendInflight.get(secid);
  if (running) return running;

  const task = (async () => {
    const params = new URLSearchParams({
      secid,
      ndays: '1',
      fields1:
        'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
      iscr: '0',
      iscca: '0',
      _: String(Date.now())
    });

    const json = await requestJson(
      'live',
      liveBases,
      '/api/qt/stock/trends2/get',
      params
    );

    const data = json?.data;
    if (!data) return [];

    const preClose = toNumber(data.preClose);
    const rows = Array.isArray(data.trends)
      ? data.trends
      : [];

    const result = rows
      .map((line: string) => String(line).split(','))
      .filter((row: string[]) => row.length >= 7)
      .map((row: string[]) => {
        const price = toNumber(row[1] || row[2]);
        return {
          datetime: row[0],
          time: row[0].slice(11, 16),
          price,
          avgPrice: toNumber(row[2], price),
          volume: toNumber(row[5]),
          amount: toNumber(row[6]),
          pct:
            preClose > 0
              ? ((price - preClose) / preClose) * 100
              : 0
        };
      });

    trendCache.set(secid, {
      time: Date.now(),
      data: result
    });

    return result;
  })().finally(() => trendInflight.delete(secid));

  trendInflight.set(secid, task);
  return task;
}

/**
 * 最新交易日优先东财指数日K；历史接口不可用时用腾讯上证指数日K兜底。
 */
export async function getLatestTradeDate(): Promise<string> {
  try {
    const rows = await getEastmoneyKline(
      '1.000001',
      101,
      5,
      0
    );
    const last = rows.at(-1);
    if (last?.date) return last.date.slice(0, 10);
  } catch (error) {
    console.warn(
      `东财交易日判断失败，切腾讯：${errorText(error)}`
    );
  }

  // 用高流动性的沪市股票判断交易日，避免把 000001 误识别为深市个股。
  const fallback = await getTencentDailyKline('600000', 5);
  const last = fallback.at(-1);

  if (!last?.date) {
    throw new Error('无法取得最新交易日');
  }

  return last.date.slice(0, 10);
}

export function getMarketDataSourceStatus() {
  return {
    eastmoney: sourceStatus,
    configuration: {
      liveHosts: liveBases.map(
        (item) => new URL(item).hostname
      ),
      historyHosts: historyBases.map(
        (item) => new URL(item).hostname
      ),
      minIntervalMs: config.eastmoneyMinIntervalMs,
      retryCount: config.eastmoneyRetryCount,
      pageSize: config.eastmoneyPageSize
    },
    fallback: {
      provider: 'tencent',
      dailyKline: true,
      minuteKline: true
    }
  };
}
