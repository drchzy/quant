import { config } from './config.js';

export interface FallbackKLine {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number | null;
  amplitude: number | null;
  pct: number | null;
  change: number | null;
  turnover: number | null;
}

const endpoints = [
  'https://ifzq.gtimg.cn/appstock/app/fqkline/get',
  'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get',
  'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
];

const minuteEndpoints = [
  'https://ifzq.gtimg.cn/appstock/app/kline/mkline',
  'https://web.ifzq.gtimg.cn/appstock/app/kline/mkline'
];

let queue: Promise<void> = Promise.resolve();
let lastStart = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  const wait = Math.max(
    0,
    config.fallbackMinIntervalMs - (Date.now() - lastStart)
  );
  if (wait > 0) await sleep(wait);

  lastStart = Date.now();

  try {
    return await fn();
  } finally {
    release();
  }
}

function symbol(code: string): string {
  if (/^(4|8|92)/.test(code)) return `bj${code}`;
  if (/^(5|6|9)/.test(code)) return `sh${code}`;
  return `sz${code}`;
}

async function fetchJson(
  urls: string[],
  params: URLSearchParams
): Promise<any> {
  let lastError: unknown;

  for (const base of urls) {
    for (let attempt = 0; attempt <= config.fallbackRetryCount; attempt += 1) {
      try {
        return await throttle(async () => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            config.eastmoneyTimeoutMs
          );

          try {
            const response = await fetch(
              `${base}?${params.toString()}`,
              {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
                  Referer: 'https://gu.qq.com/',
                  Accept: 'application/json,text/plain,*/*',
                  'Accept-Language': 'zh-CN,zh;q=0.9'
                },
                signal: controller.signal
              }
            );

            if (!response.ok) {
              throw new Error(
                `腾讯行情返回 HTTP ${response.status}：${base}`
              );
            }

            const text = await response.text();
            if (!text.trim()) {
              throw new Error(`腾讯行情返回空响应：${base}`);
            }

            const json = JSON.parse(text);
            if (Number(json?.code ?? 0) !== 0) {
              throw new Error(
                `腾讯行情返回业务错误：${JSON.stringify(json).slice(0, 200)}`
              );
            }

            return json;
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (error) {
        lastError = error;

        if (attempt < config.fallbackRetryCount) {
          await sleep(
            config.fallbackRetryBaseMs * Math.pow(2, attempt)
          );
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

function calculateDerived(rows: FallbackKLine[]): FallbackKLine[] {
  let previousClose: number | null = null;

  return rows.map((row) => {
    const change =
      previousClose && previousClose > 0
        ? row.close - previousClose
        : null;
    const pct =
      previousClose && previousClose > 0
        ? (change! / previousClose) * 100
        : null;
    const amplitude =
      previousClose && previousClose > 0
        ? ((row.high - row.low) / previousClose) * 100
        : null;

    previousClose = row.close;

    return {
      ...row,
      change,
      pct,
      amplitude
    };
  });
}

/**
 * 腾讯前复权日K作为东财历史接口的备用源。
 * 返回字段只保留策略真正需要的 OHLCV，成交额和换手率留空。
 */
export async function getTencentDailyKline(
  code: string,
  limit: number
): Promise<FallbackKLine[]> {
  const key = symbol(code);
  const params = new URLSearchParams({
    param: `${key},day,,,${Math.min(Math.max(limit, 1), 1000)},qfq`
  });

  const json = await fetchJson(endpoints, params);
  const stock = json?.data?.[key] || {};
  const raw = stock.qfqday || stock.day || [];

  const rows: FallbackKLine[] = raw
    .filter((item: any[]) => Array.isArray(item) && item.length >= 6)
    .map((item: any[]) => ({
      date: String(item[0]),
      open: Number(item[1]) || 0,
      close: Number(item[2]) || 0,
      high: Number(item[3]) || 0,
      low: Number(item[4]) || 0,
      volume: Number(item[5]) || 0,
      amount: null,
      amplitude: null,
      pct: null,
      change: null,
      turnover: null
    }));

  return calculateDerived(rows);
}

/**
 * 腾讯分钟K作为东财分钟接口的备用源。
 */
export async function getTencentMinuteKline(
  code: string,
  period: 1 | 5 | 15 | 30 | 60,
  limit: number
): Promise<FallbackKLine[]> {
  const key = symbol(code);
  const params = new URLSearchParams({
    param: `${key},m${period},,${Math.min(Math.max(limit, 1), 1000)}`
  });

  const json = await fetchJson(minuteEndpoints, params);
  const raw = json?.data?.[key]?.[`m${period}`] || [];

  const rows: FallbackKLine[] = raw
    .filter((item: any[]) => Array.isArray(item) && item.length >= 6)
    .map((item: any[]) => {
      const time = String(item[0]);
      const date =
        /^\d{12}$/.test(time)
          ? `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)} ${time.slice(8, 10)}:${time.slice(10, 12)}`
          : time;

      return {
        date,
        open: Number(item[1]) || 0,
        close: Number(item[2]) || 0,
        high: Number(item[3]) || 0,
        low: Number(item[4]) || 0,
        volume: Number(item[5]) || 0,
        amount: null,
        amplitude: null,
        pct: null,
        change: null,
        turnover: null
      };
    });

  return calculateDerived(rows);
}
