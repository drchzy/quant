import { config } from './config.js';
import type { MarketStock, SectorRow, SectorType } from './types.js';

export type DataSourceId =
  | 'sina'
  | 'tencent'
  | 'eastmoney_datacenter'
  | 'eastmoney_push2'
  | 'tushare';

export type DataCapability =
  | 'snapshot'
  | 'daily'
  | 'minute'
  | 'sector'
  | 'index'
  | 'quote';

export interface DailyBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  preClose?: number | null;
  volume: number;
  amount: number | null;
  amplitude: number | null;
  pct: number | null;
  change: number | null;
  turnover: number | null;
}

export interface DataSourceDefinition {
  id: DataSourceId;
  name: string;
  description: string;
  independent: boolean;
  needsToken: boolean;
  capabilities: DataCapability[];
  defaultEnabled: boolean;
  defaultPriority: number;
}

export const dataSourceDefinitions: DataSourceDefinition[] = [
  {
    id: 'sina',
    name: '新浪财经',
    description: '独立全市场快照源，适合每日全市场同步。',
    independent: true,
    needsToken: false,
    capabilities: ['snapshot', 'index', 'quote'],
    defaultEnabled: true,
    defaultPriority: 10
  },
  {
    id: 'tencent',
    name: '腾讯财经',
    description: '独立日K/分钟K备用源，适合历史行情初始化。',
    independent: true,
    needsToken: false,
    capabilities: ['daily', 'minute', 'index', 'quote'],
    defaultEnabled: true,
    defaultPriority: 20
  },
  {
    id: 'eastmoney_datacenter',
    name: '东方财富数据中心',
    description: '东方财富选股数据中心接口，不走 push2 集群。',
    independent: false,
    needsToken: false,
    capabilities: ['snapshot'],
    defaultEnabled: true,
    defaultPriority: 30
  },
  {
    id: 'eastmoney_push2',
    name: '东方财富行情',
    description: 'push2delay/push2 实时快照、push2his K线和板块。',
    independent: false,
    needsToken: false,
    capabilities: ['snapshot', 'daily', 'minute', 'sector', 'index', 'quote'],
    defaultEnabled: true,
    defaultPriority: 40
  },
  {
    id: 'tushare',
    name: 'Tushare Pro',
    description: '官方 Token API；配置 TUSHARE_TOKEN 后可用于快照和日K。',
    independent: true,
    needsToken: true,
    capabilities: ['snapshot', 'daily'],
    defaultEnabled: false,
    defaultPriority: 50
  }
];

function number(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullable(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function marketByCode(code: string): number {
  return /^(5|6|9)/.test(code) ? 1 : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('同步任务已取消', 'AbortError');
  }
}

const sourceQueues = new Map<DataSourceId, Promise<void>>();
const sourceLastStart = new Map<DataSourceId, number>();

function sourceInterval(source: DataSourceId): number {
  switch (source) {
    case 'eastmoney_push2':
    case 'eastmoney_datacenter':
      return config.eastmoneyMinIntervalMs;
    case 'tencent':
      return config.fallbackMinIntervalMs;
    case 'sina':
      return 180;
    case 'tushare':
      return 350;
  }
}

async function waitWithAbort(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('同步任务已取消', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function withSourceLimit<T>(
  source: DataSourceId,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const previous =
    sourceQueues.get(source) || Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  sourceQueues.set(source, current);

  await previous;

  const last = sourceLastStart.get(source) || 0;
  const jitter =
    source.startsWith('eastmoney')
      ? Math.floor(Math.random() * 250)
      : 0;
  const wait = Math.max(
    0,
    sourceInterval(source) + jitter - (Date.now() - last)
  );

  try {
    throwIfAborted(signal);
    await waitWithAbort(wait, signal);
    sourceLastStart.set(source, Date.now());
    return await fn();
  } finally {
    release();
    if (sourceQueues.get(source) === current) {
      sourceQueues.delete(source);
    }
  }
}

async function fetchText(
  url: string,
  options: RequestInit,
  signal?: AbortSignal,
  timeoutMs = config.eastmoneyTimeoutMs
): Promise<string> {
  throwIfAborted(signal);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${new URL(url).hostname}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchJson(
  url: string,
  options: RequestInit,
  signal?: AbortSignal,
  timeoutMs = config.eastmoneyTimeoutMs
): Promise<any> {
  const text = await fetchText(url, options, signal, timeoutMs);
  if (!text.trim()) throw new Error('上游返回空响应');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`上游返回非 JSON：${text.slice(0, 120)}`);
  }
}

const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

async function fetchSinaPage(
  page: number,
  pageSize: number,
  signal?: AbortSignal
): Promise<any[]> {
  const params = new URLSearchParams({
    page: String(page),
    num: String(pageSize),
    sort: 'symbol',
    asc: '1',
    node: 'hs_a',
    symbol: '',
    _s_r_a: 'page'
  });
  const url =
    'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?' +
    params.toString();

  const json = await withSourceLimit(
    'sina',
    signal,
    () =>
      fetchJson(
        url,
        {
          headers: {
            ...browserHeaders,
            Referer: 'https://vip.stock.finance.sina.com.cn/mkt/'
          }
        },
        signal,
        15_000
      )
  );

  if (!Array.isArray(json)) {
    throw new Error('新浪全市场返回格式异常');
  }
  return json;
}

export async function fetchSinaSnapshot(
  signal?: AbortSignal,
  testOnly = false
): Promise<MarketStock[]> {
  const pageSize = testOnly ? 10 : 100;
  const allRows: any[] = [];

  for (let page = 1; page <= (testOnly ? 1 : 80); page += 1) {
    throwIfAborted(signal);
    const rows = await fetchSinaPage(page, pageSize, signal);
    if (rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
  }

  return allRows
    .map((row) => {
      const code = String(row.code || row.symbol || '').replace(/^(sh|sz|bj)/i, '');
      return {
        code,
        name: String(row.name || ''),
        market: marketByCode(code),
        price: number(row.trade),
        pct: number(row.changepercent),
        change: number(row.pricechange),
        volume: number(row.volume),
        amount: number(row.amount),
        amplitude: number(row.amplitude),
        turnover: number(row.turnoverratio),
        pe: nullable(row.per),
        volumeRatio: nullable(row.volume_ratio),
        high: number(row.high),
        low: number(row.low),
        open: number(row.open),
        preClose: number(row.settlement),
        totalMarketCap: number(row.mktcap) * 10_000,
        floatMarketCap: number(row.nmc) * 10_000,
        pb: nullable(row.pb)
      } satisfies MarketStock;
    })
    .filter((row) => /^\d{6}$/.test(row.code) && row.name);
}

async function fetchEastmoneyDataCenterPage(
  page: number,
  pageSize: number,
  signal?: AbortSignal
): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({
    st: 'SECURITY_CODE',
    sr: '1',
    ps: String(pageSize),
    p: String(page),
    sty:
      'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,NEW_PRICE,CHANGE_RATE,VOLUME_RATIO,DEAL_AMOUNT,TURNOVERRATE,PE9,PBNEWMRQ,TOTAL_MARKET_CAP,CIRCULATION_MARKET_CAP',
    filter:
      '(MARKET+in+("上交所主板","深交所主板","深交所创业板","上交所科创板","北交所"))',
    source: 'SELECT_SECURITIES',
    client: 'WEB'
  });

  const json = await withSourceLimit(
    'eastmoney_datacenter',
    signal,
    () =>
      fetchJson(
        'https://data.eastmoney.com/dataapi/xuangu/list?' + params.toString(),
        {
          headers: {
            ...browserHeaders,
            Referer: 'https://data.eastmoney.com/xuangu/'
          }
        },
        signal,
        30_000
      )
  );

  if (!json?.success) {
    throw new Error(`东财数据中心业务错误：${json?.message || 'unknown'}`);
  }

  return {
    rows: Array.isArray(json?.result?.data) ? json.result.data : [],
    total: number(json?.result?.count)
  };
}

export async function fetchEastmoneyDataCenterSnapshot(
  signal?: AbortSignal,
  testOnly = false
): Promise<MarketStock[]> {
  const pageSize = testOnly ? 10 : 500;
  const allRows: any[] = [];

  for (let page = 1; page <= (testOnly ? 1 : 20); page += 1) {
    throwIfAborted(signal);
    const { rows, total } = await fetchEastmoneyDataCenterPage(
      page,
      pageSize,
      signal
    );
    allRows.push(...rows);
    if (rows.length === 0 || allRows.length >= total || rows.length < pageSize) {
      break;
    }
  }

  return allRows
    .map((row) => {
      const code = String(row.SECURITY_CODE || '');
      return {
        code,
        name: String(row.SECURITY_NAME_ABBR || ''),
        market: marketByCode(code),
        price: number(row.NEW_PRICE),
        pct: number(row.CHANGE_RATE),
        change: 0,
        volume: 0,
        amount: number(row.DEAL_AMOUNT),
        amplitude: 0,
        turnover: number(row.TURNOVERRATE),
        pe: nullable(row.PE9),
        volumeRatio: nullable(row.VOLUME_RATIO),
        high: 0,
        low: 0,
        open: 0,
        preClose: 0,
        totalMarketCap: number(row.TOTAL_MARKET_CAP),
        floatMarketCap: number(row.CIRCULATION_MARKET_CAP),
        pb: nullable(row.PBNEWMRQ)
      } satisfies MarketStock;
    })
    .filter((row) => /^\d{6}$/.test(row.code) && row.name);
}

const eastmoneyLiveBases = [
  'https://push2delay.eastmoney.com',
  'https://push2.eastmoney.com'
];

async function eastmoneyJson(
  path: string,
  params: URLSearchParams,
  signal?: AbortSignal,
  historical = false
): Promise<any> {
  const bases = historical
    ? ['https://push2his.eastmoney.com']
    : eastmoneyLiveBases;
  let lastError: unknown;

  for (const base of bases) {
    try {
      return await withSourceLimit(
        'eastmoney_push2',
        signal,
        () =>
          fetchJson(
            `${base}${path}?${params.toString()}`,
            {
              headers: {
                ...browserHeaders,
                Referer: 'https://quote.eastmoney.com/',
                Connection: 'close'
              }
            },
            signal
          )
      );
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export async function fetchEastmoneyPush2Snapshot(
  signal?: AbortSignal,
  testOnly = false
): Promise<MarketStock[]> {
  const pageSize = testOnly ? 10 : 100;
  const result: MarketStock[] = [];

  for (let page = 1; page <= (testOnly ? 1 : 100); page += 1) {
    throwIfAborted(signal);

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

    const json = await eastmoneyJson(
      '/api/qt/clist/get',
      params,
      signal
    );
    const rows = json?.data?.diff;
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      result.push({
        code: String(row.f12 || ''),
        name: String(row.f14 || ''),
        market: number(row.f13),
        price: number(row.f2),
        pct: number(row.f3),
        change: number(row.f4),
        volume: number(row.f5),
        amount: number(row.f6),
        amplitude: number(row.f7),
        turnover: number(row.f8),
        pe: nullable(row.f9),
        volumeRatio: nullable(row.f10),
        high: number(row.f15),
        low: number(row.f16),
        open: number(row.f17),
        preClose: number(row.f18),
        totalMarketCap: number(row.f20),
        floatMarketCap: number(row.f21),
        pb: nullable(row.f23)
      });
    }

    const total = number(json?.data?.total);
    if (testOnly || (total > 0 && result.length >= total) || rows.length < pageSize) {
      break;
    }
  }

  return result;
}

function tencentSymbol(code: string): string {
  if (/^(4|8|92)/.test(code)) return `bj${code}`;
  if (/^(5|6|9)/.test(code)) return `sh${code}`;
  return `sz${code}`;
}

export async function fetchTencentDaily(
  code: string,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  const symbol = tencentSymbol(code);
  const params = new URLSearchParams({
    param: `${symbol},day,,,${Math.min(Math.max(limit, 1), 1000)},qfq`
  });

  const endpoints = [
    'https://ifzq.gtimg.cn/appstock/app/newfqkline/get',
    'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get',
    'https://ifzq.gtimg.cn/appstock/app/fqkline/get'
  ];

  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const json = await withSourceLimit(
        'tencent',
        signal,
        () =>
          fetchJson(
            endpoint + '?' + params.toString(),
            {
              headers: {
                ...browserHeaders,
                Referer: 'https://gu.qq.com/'
              }
            },
            signal
          )
      );
      const stock = json?.data?.[symbol] || {};
      const raw = stock.qfqday || stock.day || [];
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('腾讯日K返回为空');
      }

      let previousClose: number | null = null;
      return raw.map((item: any[]) => {
        const close = number(item[2]);
        const change =
          previousClose && previousClose > 0
            ? close - previousClose
            : null;
        const pct =
          previousClose && previousClose > 0
            ? (change! / previousClose) * 100
            : null;
        const amplitude =
          previousClose && previousClose > 0
            ? ((number(item[3]) - number(item[4])) / previousClose) * 100
            : null;
        const row: DailyBar = {
          date: String(item[0]),
          open: number(item[1]),
          close,
          high: number(item[3]),
          low: number(item[4]),
          volume: number(item[5]),
          amount: null,
          amplitude,
          pct,
          change,
          turnover: null
        };
        previousClose = close;
        return row;
      });
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}


export async function fetchTencentMinute(
  code: string,
  period: 1 | 5 | 15 | 30 | 60,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  const symbol = tencentSymbol(code);
  const params = new URLSearchParams({
    param:
      symbol +
      ',m' +
      String(period) +
      ',,' +
      String(Math.min(Math.max(limit, 1), 1000))
  });

  const endpoints = [
    'https://ifzq.gtimg.cn/appstock/app/kline/mkline',
    'https://web.ifzq.gtimg.cn/appstock/app/kline/mkline'
  ];

  let lastError: unknown;

  for (const endpoint of endpoints) {
    try {
      const json = await withSourceLimit(
        'tencent',
        signal,
        () =>
          fetchJson(
            endpoint + '?' + params.toString(),
            {
              headers: {
                ...browserHeaders,
                Referer: 'https://gu.qq.com/'
              }
            },
            signal
          )
      );

      const raw =
        json?.data?.[symbol]?.['m' + String(period)] || [];

      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('腾讯分钟K返回为空');
      }

      return raw.map((item: any[]) => {
        const time = String(item[0] || '');
        const date =
          /^\d{12}$/.test(time)
            ? time.slice(0, 4) +
              '-' +
              time.slice(4, 6) +
              '-' +
              time.slice(6, 8) +
              ' ' +
              time.slice(8, 10) +
              ':' +
              time.slice(10, 12)
            : time;

        return {
          date,
          open: number(item[1]),
          close: number(item[2]),
          high: number(item[3]),
          low: number(item[4]),
          volume: number(item[5]),
          amount: null,
          amplitude: null,
          pct: null,
          change: null,
          turnover: null
        };
      });
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export async function fetchEastmoneyMinute(
  code: string,
  period: 1 | 5 | 15 | 30 | 60,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  const secid = String(marketByCode(code)) + '.' + code;
  const params = new URLSearchParams({
    secid,
    klt: String(period),
    fqt: '0',
    lmt: String(limit),
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2:
      'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    _: String(Date.now())
  });

  const json = await eastmoneyJson(
    '/api/qt/stock/kline/get',
    params,
    signal,
    true
  );

  const rows = json?.data?.klines;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('东财分钟K返回为空');
  }

  return rows.map((line: string) => {
    const row = String(line).split(',');
    return {
      date: row[0],
      open: number(row[1]),
      close: number(row[2]),
      high: number(row[3]),
      low: number(row[4]),
      volume: number(row[5]),
      amount: nullable(row[6]),
      amplitude: nullable(row[7]),
      pct: nullable(row[8]),
      change: nullable(row[9]),
      turnover: nullable(row[10])
    };
  });
}

export async function fetchEastmoneyDaily(
  code: string,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  const secid = `${marketByCode(code)}.${code}`;
  const params = new URLSearchParams({
    secid,
    klt: '101',
    fqt: '1',
    lmt: String(limit),
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2:
      'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    _: String(Date.now())
  });

  const json = await eastmoneyJson(
    '/api/qt/stock/kline/get',
    params,
    signal,
    true
  );
  const rows = json?.data?.klines;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('东财历史日K返回为空');
  }

  return rows.map((line: string) => {
    const row = String(line).split(',');
    return {
      date: row[0],
      open: number(row[1]),
      close: number(row[2]),
      high: number(row[3]),
      low: number(row[4]),
      volume: number(row[5]),
      amount: nullable(row[6]),
      amplitude: nullable(row[7]),
      pct: nullable(row[8]),
      change: nullable(row[9]),
      turnover: nullable(row[10])
    };
  });
}

interface TushareResponse {
  code: number;
  msg: string;
  data?: {
    fields: string[];
    items: unknown[][];
  };
}

async function tushareCall(
  apiName: string,
  params: Record<string, unknown>,
  fields: string[],
  signal?: AbortSignal
): Promise<Record<string, unknown>[]> {
  const token = String(process.env.TUSHARE_TOKEN || '').trim();
  if (!token) {
    throw new Error('未配置 TUSHARE_TOKEN');
  }

  const json = (await withSourceLimit(
    'tushare',
    signal,
    () =>
      fetchJson(
        'https://api.tushare.pro',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': browserHeaders['User-Agent']
          },
          body: JSON.stringify({
            api_name: apiName,
            token,
            params,
            fields: fields.join(',')
          })
        },
        signal,
        30_000
      )
  )) as TushareResponse;

  if (json.code !== 0) {
    throw new Error(`Tushare错误：${json.msg || json.code}`);
  }

  const responseFields = json.data?.fields || [];
  const items = json.data?.items || [];

  return items.map((values) =>
    Object.fromEntries(
      responseFields.map((field, index) => [field, values[index]])
    )
  );
}

async function tushareTradeDate(signal?: AbortSignal): Promise<string> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400_000);
  const fmt = (date: Date) =>
    date.toISOString().slice(0, 10).replaceAll('-', '');

  const rows = await tushareCall(
    'trade_cal',
    {
      exchange: '',
      start_date: fmt(start),
      end_date: fmt(end),
      is_open: '1'
    },
    ['cal_date', 'is_open'],
    signal
  );

  const dates = rows
    .map((row) => String(row.cal_date || ''))
    .filter(Boolean)
    .sort();

  const last = dates.at(-1);
  if (!last) throw new Error('Tushare没有返回最近交易日');
  return last;
}

export async function fetchTushareSnapshot(
  signal?: AbortSignal,
  testOnly = false
): Promise<MarketStock[]> {
  const tradeDate = await tushareTradeDate(signal);

  const [daily, basics, stocks] = await Promise.all([
    tushareCall(
      'daily',
      { trade_date: tradeDate },
      [
        'ts_code',
        'open',
        'high',
        'low',
        'close',
        'pre_close',
        'change',
        'pct_chg',
        'vol',
        'amount'
      ],
      signal
    ),
    tushareCall(
      'daily_basic',
      { trade_date: tradeDate },
      [
        'ts_code',
        'turnover_rate',
        'volume_ratio',
        'pe',
        'pb',
        'total_mv',
        'circ_mv'
      ],
      signal
    ),
    tushareCall(
      'stock_basic',
      { exchange: '', list_status: 'L' },
      ['ts_code', 'symbol', 'name', 'exchange'],
      signal
    )
  ]);

  const basicMap = new Map(
    basics.map((row) => [String(row.ts_code), row])
  );
  const stockMap = new Map(
    stocks.map((row) => [String(row.ts_code), row])
  );

  const rows = daily.map((row) => {
    const tsCode = String(row.ts_code || '');
    const stock = stockMap.get(tsCode) || {};
    const basic = basicMap.get(tsCode) || {};
    const code =
      String(stock.symbol || '') ||
      tsCode.split('.')[0] ||
      '';

    return {
      code,
      name: String(stock.name || code),
      market: marketByCode(code),
      price: number(row.close),
      pct: number(row.pct_chg),
      change: number(row.change),
      volume: number(row.vol),
      amount: number(row.amount) * 1_000,
      amplitude:
        number(row.pre_close) > 0
          ? ((number(row.high) - number(row.low)) /
              number(row.pre_close)) *
            100
          : 0,
      turnover: number(basic.turnover_rate),
      pe: nullable(basic.pe),
      volumeRatio: nullable(basic.volume_ratio),
      high: number(row.high),
      low: number(row.low),
      open: number(row.open),
      preClose: number(row.pre_close),
      totalMarketCap: number(basic.total_mv) * 10_000,
      floatMarketCap: number(basic.circ_mv) * 10_000,
      pb: nullable(basic.pb)
    } satisfies MarketStock;
  });

  return (testOnly ? rows.slice(0, 10) : rows).filter(
    (row) => /^\d{6}$/.test(row.code)
  );
}

export async function fetchTushareDaily(
  code: string,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  const exchange = /^(5|6|9)/.test(code) ? 'SH' : /^(4|8|92)/.test(code) ? 'BJ' : 'SZ';
  const rows = await tushareCall(
    'daily',
    { ts_code: `${code}.${exchange}` },
    [
      'trade_date',
      'open',
      'high',
      'low',
      'close',
      'pre_close',
      'change',
      'pct_chg',
      'vol',
      'amount'
    ],
    signal
  );

  return rows
    .slice(0, limit)
    .reverse()
    .map((row) => {
      const date = String(row.trade_date || '');
      return {
        date:
          date.length === 8
            ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
            : date,
        open: number(row.open),
        close: number(row.close),
        high: number(row.high),
        low: number(row.low),
        preClose: nullable(row.pre_close),
        volume: number(row.vol),
        amount: number(row.amount) * 1_000,
        amplitude:
          number(row.pre_close) > 0
            ? ((number(row.high) - number(row.low)) /
                number(row.pre_close)) *
              100
            : null,
        pct: nullable(row.pct_chg),
        change: nullable(row.change),
        turnover: null
      };
    });
}

export async function fetchEastmoneySectors(
  type: SectorType,
  signal?: AbortSignal
): Promise<SectorRow[]> {
  const result: SectorRow[] = [];

  for (let page = 1; page <= 20; page += 1) {
    throwIfAborted(signal);
    const params = new URLSearchParams({
      pn: String(page),
      pz: '100',
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

    const json = await eastmoneyJson(
      '/api/qt/clist/get',
      params,
      signal
    );
    const rows = json?.data?.diff;
    if (!Array.isArray(rows) || rows.length === 0) break;

    result.push(
      ...rows.map((row: any) => ({
        type,
        code: String(row.f12 || ''),
        name: String(row.f14 || ''),
        price: number(row.f2),
        pct: number(row.f3),
        mainInflow: number(row.f62),
        upCount: number(row.f104),
        downCount: number(row.f105),
        leadStock: String(row.f128 || '')
      }))
    );

    const total = number(json?.data?.total);
    if ((total > 0 && result.length >= total) || rows.length < 100) {
      break;
    }
  }

  return result;
}

export async function testDataSource(
  source: DataSourceId,
  capability?: DataCapability,
  signal?: AbortSignal
): Promise<{
  capability: DataCapability;
  count: number;
  sample: unknown;
}> {
  const definition = dataSourceDefinitions.find(
    (item) => item.id === source
  );

  if (!definition) {
    throw new Error('未知数据源：' + source);
  }

  const target =
    capability && definition.capabilities.includes(capability)
      ? capability
      : definition.capabilities[0];

  switch (source) {
    case 'sina': {
      if (target === 'quote') {
        const quote = await fetchStockQuoteBySource('sina', '600000', signal);
        return { capability: 'quote', count: quote.price > 0 ? 1 : 0, sample: quote };
      }
      if (target === 'index') {
        const rows = await fetchIndexesBySource('sina', [{ code: '000001', secid: '1.000001' }], signal);
        return { capability: 'index', count: rows.size, sample: rows.get('000001') || null };
      }
      const rows = await fetchSinaSnapshot(signal, true);
      return {
        capability: 'snapshot',
        count: rows.length,
        sample: rows[0] || null
      };
    }

    case 'eastmoney_datacenter': {
      const rows = await fetchEastmoneyDataCenterSnapshot(
        signal,
        true
      );
      return {
        capability: 'snapshot',
        count: rows.length,
        sample: rows[0] || null
      };
    }

    case 'eastmoney_push2': {
      if (target === 'quote') {
        const quote = await fetchStockQuoteBySource('eastmoney_push2', '600000', signal);
        return { capability: 'quote', count: quote.price > 0 ? 1 : 0, sample: quote };
      }
      if (target === 'index') {
        const rows = await fetchIndexesBySource('eastmoney_push2', [{ code: '000001', secid: '1.000001' }], signal);
        return { capability: 'index', count: rows.size, sample: rows.get('000001') || null };
      }
      if (target === 'daily') {
        const rows = await fetchEastmoneyDaily(
          '600000',
          5,
          signal
        );
        return {
          capability: 'daily',
          count: rows.length,
          sample: rows.at(-1) || null
        };
      }

      if (target === 'minute') {
        const rows = await fetchEastmoneyMinute(
          '600000',
          1,
          10,
          signal
        );
        return {
          capability: 'minute',
          count: rows.length,
          sample: rows.at(-1) || null
        };
      }

      if (target === 'sector') {
        const rows = await fetchEastmoneySectors(
          'industry',
          signal
        );
        return {
          capability: 'sector',
          count: rows.length,
          sample: rows[0] || null
        };
      }

      const rows = await fetchEastmoneyPush2Snapshot(
        signal,
        true
      );
      return {
        capability: 'snapshot',
        count: rows.length,
        sample: rows[0] || null
      };
    }

    case 'tencent': {
      if (target === 'quote') {
        const quote = await fetchStockQuoteBySource('tencent', '600000', signal);
        return { capability: 'quote', count: quote.price > 0 ? 1 : 0, sample: quote };
      }
      if (target === 'index') {
        const rows = await fetchIndexesBySource('tencent', [{ code: '000001', secid: '1.000001' }], signal);
        return { capability: 'index', count: rows.size, sample: rows.get('000001') || null };
      }
      if (target === 'minute') {
        const rows = await fetchTencentMinute(
          '600000',
          1,
          10,
          signal
        );
        return {
          capability: 'minute',
          count: rows.length,
          sample: rows.at(-1) || null
        };
      }

      const rows = await fetchTencentDaily(
        '600000',
        5,
        signal
      );
      return {
        capability: 'daily',
        count: rows.length,
        sample: rows.at(-1) || null
      };
    }

    case 'tushare': {
      if (target === 'daily') {
        const rows = await fetchTushareDaily(
          '600000',
          5,
          signal
        );
        return {
          capability: 'daily',
          count: rows.length,
          sample: rows.at(-1) || null
        };
      }

      const rows = await fetchTushareSnapshot(
        signal,
        true
      );
      return {
        capability: 'snapshot',
        count: rows.length,
        sample: rows[0] || null
      };
    }
  }
}


export interface IndexQuote {
  code: string;
  price: number;
  pct: number;
  change: number;
  open?: number;
  high?: number;
  low?: number;
  preClose?: number;
  volume?: number;
  amount?: number;
}

export interface IndexIdentity {
  code: string;
  secid: string;
}

/** 一次按 Provider 批量请求指数，不通过旧的东财固定接口。 */
export async function fetchIndexesBySource(
  source: DataSourceId,
  indexes: IndexIdentity[],
  signal?: AbortSignal
): Promise<Map<string, IndexQuote>> {
  if (indexes.length === 0) return new Map();
  const result = new Map<string, IndexQuote>();
  if (source === 'sina') {
    const symbols = indexes.map((item) => {
      const prefix = item.secid.startsWith('1.') ? 'sh' : 'sz';
      return 's_' + prefix + item.code;
    });
    const raw = await withSourceLimit('sina', signal, () =>
      fetchText(
        'https://hq.sinajs.cn/list=' + symbols.join(','),
        { headers: { ...browserHeaders, Referer: 'https://finance.sina.com.cn/' } },
        signal,
        12_000
      )
    );
    const pattern = /hq_str_s_(?:sh|sz)(\d{6})="([^"]*)"/g;
    for (const match of raw.matchAll(pattern)) {
      const fields = match[2].split(',');
      const price = Number(fields[1]);
      const change = Number(fields[2]);
      const pct = Number(fields[3]);
      if (!Number.isFinite(price) || price <= 0 ||
          !Number.isFinite(change) || !Number.isFinite(pct)) continue;
      result.set(match[1], {
        code: match[1], price, change, pct,
        preClose: price - change
      });
    }
    return result;
  }
  if (source === 'tencent') {
    const symbols = indexes.map((item) =>
      (item.secid.startsWith('1.') ? 'sh' : 'sz') + item.code
    );
    const raw = await withSourceLimit('tencent', signal, () =>
      fetchText(
        'https://qt.gtimg.cn/q=' + symbols.join(','),
        { headers: { ...browserHeaders, Referer: 'https://gu.qq.com/' } },
        signal,
        12_000
      )
    );
    const pattern = /v_(?:sh|sz)(\d{6})="([^"]*)"/g;
    for (const match of raw.matchAll(pattern)) {
      const row = match[2].split('~');
      const price = Number(row[3]);
      const preClose = Number(row[4]);
      if (!Number.isFinite(price) || price <= 0 ||
          !Number.isFinite(preClose) || preClose <= 0) continue;
      result.set(match[1], {
        code: match[1], price, preClose,
        change: price - preClose,
        pct: ((price - preClose) / preClose) * 100,
        open: number(row[5]),
        volume: number(row[6]),
        high: number(row[33]),
        low: number(row[34]),
        amount: number(row[37])
      });
    }
    return result;
  }
  if (source === 'eastmoney_push2') {
    const json = await eastmoneyJson('/api/qt/ulist.np/get', new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18',
      secids: indexes.map((item) => item.secid).join(',')
    }), signal);
    for (const row of json?.data?.diff || []) {
      const price = Number(row.f2);
      const code = String(row.f12 || '');
      if (!Number.isFinite(price) || price <= 0 || !code) continue;
      result.set(code, {
        code, price, pct: number(row.f3), change: number(row.f4),
        volume: number(row.f5), amount: number(row.f6),
        high: number(row.f15), low: number(row.f16),
        open: number(row.f17), preClose: number(row.f18)
      });
    }
    return result;
  }
  throw new Error(source + ' 不支持指数');
}

/** 个股报价与指数同样按照启用 Provider 的能力和排序路由。 */
export async function fetchStockQuoteBySource(
  source: DataSourceId,
  code: string,
  signal?: AbortSignal
): Promise<IndexQuote & { name?: string }> {
  if (!/^\d{6}$/.test(code)) throw new Error('股票代码必须为六位数字');
  const symbol = tencentSymbol(code);
  if (source === 'sina') {
    const raw = await withSourceLimit('sina', signal, () =>
      fetchText('https://hq.sinajs.cn/list=' + symbol, {
        headers: { ...browserHeaders, Referer: 'https://finance.sina.com.cn/' }
      }, signal, 12_000)
    );
    const line = raw.match(/hq_str_(?:sh|sz)(\d{6})="([^"]*)"/);
    if (!line || line[1] !== code) throw new Error('新浪个股报价返回为空');
    const cols = line[2].split(',');
    const price = Number(cols[3]), preClose = Number(cols[2]);
    if (!(price > 0) || !(preClose > 0)) throw new Error('新浪个股报价无有效价格');
    return {
      code, price, preClose, change: price - preClose,
      pct: (price - preClose) / preClose * 100,
      open: number(cols[1]), high: number(cols[4]), low: number(cols[5]),
      volume: number(cols[8]), amount: number(cols[9])
    };
  }
  if (source === 'tencent') {
    const raw = await withSourceLimit('tencent', signal, () =>
      fetchText('https://qt.gtimg.cn/q=' + symbol, {
        headers: { ...browserHeaders, Referer: 'https://gu.qq.com/' }
      }, signal, 12_000)
    );
    const line = raw.match(/v_(?:sh|sz)(\d{6})="([^"]*)"/);
    if (!line || line[1] !== code) throw new Error('腾讯个股报价返回为空');
    const row = line[2].split('~');
    const price = Number(row[3]), preClose = Number(row[4]);
    if (!(price > 0) || !(preClose > 0)) throw new Error('腾讯个股报价无有效价格');
    return {
      code, name: row[1], price, preClose, change: price - preClose,
      pct: (price - preClose) / preClose * 100,
      open: number(row[5]), volume: number(row[6]),
      high: number(row[33]), low: number(row[34]), amount: number(row[37])
    };
  }
  if (source === 'eastmoney_push2') {
    const secid = (/^(5|6|9)/.test(code) ? '1.' : '0.') + code;
    const json = await eastmoneyJson('/api/qt/stock/get', new URLSearchParams({
      secid, fltt: '2', invt: '2',
      fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170'
    }), signal);
    const row = json?.data;
    if (!row || !(number(row.f43) > 0)) throw new Error('东财个股报价为空');
    return {
      code, name: String(row.f58 || ''), price: number(row.f43),
      preClose: number(row.f60), pct: number(row.f170),
      change: number(row.f169), open: number(row.f46),
      high: number(row.f44), low: number(row.f45),
      volume: number(row.f47), amount: number(row.f48)
    };
  }
  throw new Error(source + ' 不支持个股实时报价');
}

export async function fetchSnapshotBySource(
  source: DataSourceId,
  signal?: AbortSignal
): Promise<MarketStock[]> {
  switch (source) {
    case 'sina':
      return fetchSinaSnapshot(signal);
    case 'eastmoney_datacenter':
      return fetchEastmoneyDataCenterSnapshot(signal);
    case 'eastmoney_push2':
      return fetchEastmoneyPush2Snapshot(signal);
    case 'tushare':
      return fetchTushareSnapshot(signal);
    default:
      throw new Error(`${source} 不支持全市场快照`);
  }
}

export async function fetchDailyBySource(
  source: DataSourceId,
  code: string,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  switch (source) {
    case 'tencent':
      return fetchTencentDaily(code, limit, signal);
    case 'eastmoney_push2':
      return fetchEastmoneyDaily(code, limit, signal);
    case 'tushare':
      return fetchTushareDaily(code, limit, signal);
    default:
      throw new Error(`${source} 不支持历史日K`);
  }
}

export async function fetchMinuteBySource(
  source: DataSourceId,
  code: string,
  period: 1 | 5 | 15 | 30 | 60,
  limit: number,
  signal?: AbortSignal
): Promise<DailyBar[]> {
  switch (source) {
    case 'tencent':
      return fetchTencentMinute(
        code,
        period,
        limit,
        signal
      );
    case 'eastmoney_push2':
      return fetchEastmoneyMinute(
        code,
        period,
        limit,
        signal
      );
    default:
      throw new Error(source + ' 不支持分钟K');
  }
}


export async function fetchSectorsBySource(
  source: DataSourceId,
  type: SectorType,
  signal?: AbortSignal
): Promise<SectorRow[]> {
  if (source !== 'eastmoney_push2') {
    throw new Error(`${source} 暂不支持板块同步`);
  }
  return fetchEastmoneySectors(type, signal);
}
