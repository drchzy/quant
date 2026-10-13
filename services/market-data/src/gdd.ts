import { createHash } from 'node:crypto';
import type { DailyBar } from './providers.js';

/**
 * GDD 行情协议：HTTP POST /，通过 reqtype 区分 K 线(150)、逐笔(151)、分时(152)。
 * 业务接口及会话令牌仅用于动态发现网关；行情信封本身 session=""。
 * IP 与密码可能经明文 HTTP 传输，不应写入日志或提交仓库。
 */
const FALLBACK_GATEWAY = 'http://8.129.13.151:19920/';
const BUSINESS_BASE = 'http://120.76.229.148:1080';
let cachedGateway: { url: string; until: number } | undefined;
let discoveryPromise: Promise<string> | undefined;

function gatewayUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('GDD 网关必须为 HTTP(S) 地址');
  }
  return url.origin + '/';
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(process.env.GDD_TIMEOUT_MS || 12000)));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('GDD HTTP ' + response.status);
    const data: any = await response.json();
    if (!data || typeof data !== 'object') throw new Error('GDD 返回格式错误');
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function appHeaders(session = ''): Record<string, string> {
  const headers: Record<string, string> = {
    channelType: 'android',
    systemType: process.env.GDD_SYSTEM_TYPE || 'Android',
    versionNumber: process.env.GDD_VERSION_NUMBER || '1.20.0',
    orgCode: '0007'
  };
  if (session) headers.sessionCode = session;
  return headers;
}

async function discoverGateway(signal?: AbortSignal): Promise<string> {
  let session = (process.env.GDD_SESSION_CODE || '').trim();
  const account = (process.env.GDD_ACCOUNT || '').trim();
  const password = process.env.GDD_PASSWORD || '';
  const device = (process.env.GDD_DEVICE || '').trim();
  if (!session && account && password && device) {
    const pass = (process.env.GDD_PASSWORD_MODE || 'plain').toLowerCase() === 'md5'
      ? createHash('md5').update(password).digest('hex')
      : password;
    const res = await postJson(
      (process.env.GDD_BUSINESS_URL || BUSINESS_BASE).replace(/\/+$/, '') + '/investment-adviser/customer/login',
      { account, password: pass, device, orgCode: '0007', loginType: 1, verificationCode: '' },
      appHeaders(), signal
    );
    if (Number(res.code ?? res.ret) !== 0 || !res.result?.sessionCode) {
      throw new Error('GDD 登录失败：' + String(res.message || res.msg || res.code || '缺少sessionCode').slice(0, 100));
    }
    session = String(res.result.sessionCode);
  }
  if (!session) return gatewayUrl(process.env.GDD_GATEWAY_URL || FALLBACK_GATEWAY);

  const config = await postJson(
    (process.env.GDD_BUSINESS_URL || BUSINESS_BASE).replace(/\/+$/, '') + '/investment-adviser/config/query_server_info',
    { sessionCode: session },
    appHeaders(session), signal
  );
  if (Number(config.code ?? config.ret) !== 0) throw new Error('GDD 服务器清单获取失败');
  const gateway = config.result?.sers?.find((item: any) => Number(item.serverType) === 36);
  const port = Number(gateway?.serverPort);
  // 不接受任意域名或路径：服务端下发的网关应该是 IPv4 + 合法端口。
  if (!gateway || !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(gateway.ip)) ||
      String(gateway.ip).split('.').some((part: string) => Number(part) > 255) ||
      !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('GDD 未下发有效的 serverType=36 行情网关');
  }
  return gatewayUrl('http://' + gateway.ip + ':' + port + '/');
}

/** 启用了动态发现才会访问登录/配置接口；默认使用已实测网关地址。 */
export async function getGddGateway(signal?: AbortSignal): Promise<string> {
  if (cachedGateway && cachedGateway.until > Date.now()) return cachedGateway.url;
  if (!discoveryPromise) {
    discoveryPromise = discoverGateway(signal)
      .then((url) => {
        cachedGateway = { url, until: Date.now() + 30 * 60_000 };
        return url;
      }).finally(() => { discoveryPromise = undefined; });
  }
  return discoveryPromise;
}

export function gddMarketCode(code: string): number {
  if (!/^\d{6}$/.test(code)) throw new Error('GDD 股票代码必须为6位数字');
  if (/^30/.test(code)) return 1008;
  if (/^68/.test(code)) return 7;
  if (/^(6|5|9)/.test(code)) return 1;
  if (/^(0|2|3)/.test(code)) return 1001;
  // 北交所交易编码没有在已验证的 GDD 市场清单中，禁止猜测。
  throw new Error('GDD 暂不支持该市场编码：' + code);
}

async function requestQuote(reqtype: number, reqid: number, data: object, signal?: AbortSignal): Promise<any> {
  const url = await getGddGateway(signal);
  const response = await postJson(url, { reqtype, reqid, session: '', data }, {}, signal);
  if (response.reqtype !== undefined && Number(response.reqtype) !== reqtype) {
    throw new Error('GDD 响应 reqtype 不匹配');
  }
  const status = Number(response.status ?? 0);
  if (status !== 0) {
    throw new Error('GDD 行情失败 status=' + status + '：' + String(response.msg || '').slice(0, 160));
  }
  return response.data || {};
}

function timestamp(raw: unknown, minute = false): string {
  const value = String(raw ?? '').trim().replace('T', ' ');
  const date = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!date) throw new Error('GDD K线日期格式无法解析：' + value.slice(0, 40));
  const pad = (n: string) => n.padStart(2, '0');
  const day = date[1] + '-' + pad(date[2]) + '-' + pad(date[3]);
  if (minute && !date[4]) throw new Error('GDD 分钟K 缺少时分：' + value.slice(0, 40));
  return minute ? day + ' ' + pad(date[4]) + ':' + pad(date[5]) + ':' + pad(date[6] || '0') : day;
}

type GddRow = Array<unknown>;
const normalize = (name: unknown) =>
  String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
const aliases: Record<string, string[]> = {
  date: ['time', 'datetime', 'date', 'tradedate', 'kdate', 'day', '交易时间', '日期', '时间', '交易日'],
  open: ['open', 'openprice', '开盘', '开盘价'],
  close: ['close', 'closeprice', '收盘', '收盘价', '最新价'],
  high: ['high', 'highprice', '最高', '最高价'],
  low: ['low', 'lowprice', '最低', '最低价'],
  volume: ['volume', 'vol', 'totalvolume', '成交量'],
  amount: ['amount', 'turnoveramount', '成交额', '成交金额'],
  price: ['price', 'lastprice', '现价', '价格', '最新价'],
  avgPrice: ['avg', 'average', 'avgprice', 'averageprice', '均价'],
  tradeTime: ['time', 'datetime', 'tradetime', '时间', '成交时间']
};

function locate(header: GddRow, field: string): number {
  const candidates = (aliases[field] || [field]).map(normalize);
  return header.findIndex((item) => candidates.includes(normalize(item)));
}

function numeric(row: GddRow, index: number, required = true): number | null {
  if (index < 0) {
    if (required) throw new Error('GDD 必需字段缺失');
    return null;
  }
  const val = row[index];
  if (val === '' || val === undefined || val === null) {
    if (required) throw new Error('GDD 行情存在空数值');
    return null;
  }
  const n = Number(val);
  if (!Number.isFinite(n)) throw new Error('GDD 行情存在无效数值');
  return n;
}

function parsedRows(value: unknown, fields: string[]): { rows: GddRow[]; indexes: Record<string, number> } {
  if (!Array.isArray(value) || !Array.isArray(value[0]) || value.length < 2) {
    throw new Error('GDD 行情未返回有效的二维表格数据');
  }
  const header = value[0] as GddRow;
  const indexes: Record<string, number> = {};
  for (const field of fields) {
    indexes[field] = locate(header, field);
  }
  const missing = fields.filter((field) => indexes[field] < 0);
  if (missing.length) {
    // 仅输出字段名，不展示行情账号、会话或完整请求。
    throw new Error('GDD 表头无法匹配字段 ' + missing.join(',') + '；实际表头：' + header.map(String).join(',').slice(0, 240));
  }
  return { rows: (value as GddRow[]).slice(1), indexes };
}

export function parseGddKline(value: unknown, limit: number, minute = false): DailyBar[] {
  const { rows, indexes: idx } = parsedRows(value, ['date', 'open', 'close', 'high', 'low', 'volume']);
  idx.amount = locate((value as GddRow[])[0], 'amount');
  const result: DailyBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const open = numeric(row, idx.open)!;
    const high = numeric(row, idx.high)!;
    const low = numeric(row, idx.low)!;
    const close = numeric(row, idx.close)!;
    if (!(open > 0 && high >= Math.max(open, close, low) && low <= Math.min(open, close, high))) {
      throw new Error('GDD K线 OHLC 校验失败，已拒绝落库');
    }
    const volume = numeric(row, idx.volume)!;
    if (volume < 0) throw new Error('GDD 成交量异常');
    result.push({
      date: timestamp(row[idx.date], minute), open, high, low, close, volume,
      amount: numeric(row, idx.amount, false),
      pct: null, change: null, amplitude: null, turnover: null
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
}

export async function fetchGddDaily(code: string, limit: number, signal?: AbortSignal): Promise<DailyBar[]> {
  return fetchGddKline(code, 10, limit, signal);
}

export async function fetchGddKline(code: string, period: number, limit: number, signal?: AbortSignal): Promise<DailyBar[]> {
  const count = Math.min(Math.max(Math.floor(limit), 1), 1000);
  const market = gddMarketCode(code);
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = now.toISOString().slice(0, 10);
  const prior = new Date(now.getTime() - count * 4 * 86400_000).toISOString().slice(0, 10);
  const data = await requestQuote(150, 1, {
    market, code, pushflag: 0, klinetype: period, weight: 0, timetype: 2,
    time0: day + ' 0:0:0', time1: prior + ' 0:0:0', count
  }, signal);
  return parseGddKline(data.kline, count, period !== 10 && period !== 11 && period !== 20 && period !== 21 && period !== 30);
}

export interface GddTrendRow {
  datetime: string;
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
  amount: number;
  pct: number;
}

export function parseGddTrend(data: any, day: string): GddTrendRow[] {
  const value = data?.trend;
  const { rows, indexes: idx } = parsedRows(value, ['tradeTime', 'price']);
  const header = value[0] as GddRow;
  idx.avgPrice = locate(header, 'avgPrice');
  idx.volume = locate(header, 'volume');
  idx.amount = locate(header, 'amount');
  const previous = Number(data.prevclose);
  return rows.filter(Array.isArray).map((row) => {
    const price = numeric(row, idx.price)!;
    const timeRaw = String(row[idx.tradeTime] ?? '');
    const full = /^\d{4}-/.test(timeRaw) ? timeRaw : day + ' ' + timeRaw;
    const datetime = timestamp(full, true);
    const avg = numeric(row, idx.avgPrice, false);
    return {
      datetime, time: datetime.slice(11, 16), price,
      avgPrice: avg ?? price, volume: numeric(row, idx.volume, false) ?? 0,
      amount: numeric(row, idx.amount, false) ?? 0,
      pct: previous > 0 ? (price - previous) / previous * 100 : 0
    };
  }).sort((a, b) => a.datetime.localeCompare(b.datetime));
}

export async function fetchGddTrend(code: string, day?: string, signal?: AbortSignal): Promise<GddTrendRow[]> {
  const market = gddMarketCode(code);
  const now = new Date(Date.now() + 8 * 3600_000);
  const date = day || now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('GDD 日期必须为 YYYY-MM-DD');
  const response = await requestQuote(152, 152, {
    market, code, timetype: 0, timevalue0: 90, timevalue1: 420,
    day: date + ' 0:0:0'
  }, signal);
  return parseGddTrend(response, date);
}

/** 测试时只输出安全的抽样行情，不回传业务登录会话。 */
export async function testGdd(signal?: AbortSignal) {
  const rows = await fetchGddDaily('300505', 5, signal);
  if (!rows.length) throw new Error('GDD 未返回日K');
  return { count: rows.length, sample: rows.at(-1) };
}
