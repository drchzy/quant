import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { DailyBar } from './providers.js';

/**
 * GDD 行情 HTTP 网关地址只能通过账号密码登录后查询 serverType=36 得到。
 * 不接受固定网关作为静默兜底，避免 IP 变化后把请求发往旧服务器。
 * sessionCode 只保留在本进程内存中，不写入磁盘或输出到日志。
 */
const BUSINESS_BASE = 'http://120.76.229.148:1080';
const DISCOVERY_TTL_MS = 15 * 60_000;
let cachedServers: { urls: Partial<Record<35 | 36, string>>; until: number } | undefined;
let discoveryPromise: Promise<Partial<Record<35 | 36, string>>> | undefined;

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
  const timeout = Number(process.env.GDD_TIMEOUT_MS || 12000);
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number.isFinite(timeout) ? timeout : 12000));
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
    systemType: process.env.GDD_SYSTEM_TYPE || 'Android 15',
    versionNumber: process.env.GDD_VERSION_NUMBER || '1.20.0',
    orgCode: '0007'
  };
  if (session) headers.sessionCode = session;
  return headers;
}

/**
 * 设备号在首次启用 GDD 时创建，持久化到 web/data/.gdd-device-id；
 * 这样 Docker 容器替换后仍使用同一设备标识，无需用户配置 UUID。
 */
export function getGddDeviceId(): string {
  const explicit = String(process.env.GDD_DEVICE || '').trim();
  if (explicit) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(explicit)) throw new Error('GDD_DEVICE 格式无效');
    return explicit;
  }
  const file = path.join(path.dirname(config.databasePath), '.gdd-device-id');
  const read = () => {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!/^[a-f0-9-]{36}-dz_astock_gdd$/.test(value)) {
      throw new Error('GDD 设备标识文件格式错误：' + file);
    }
    return value;
  };
  if (fs.existsSync(file)) return read();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const device = randomUUID() + '-dz_astock_gdd';
  try {
    fs.writeFileSync(file, device + '\n', { flag: 'wx', mode: 0o600 });
    return device;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return read();
    throw error;
  }
}

async function discoverServers(signal?: AbortSignal): Promise<Partial<Record<35 | 36, string>>> {
  const account = String(process.env.GDD_ACCOUNT || '').trim();
  const password = process.env.GDD_PASSWORD || '';
  if (!account || !password) {
    throw new Error('GDD 未配置账号密码：请在 web/.env 设置 GDD_ACCOUNT 和 GDD_PASSWORD');
  }
  const device = getGddDeviceId();
  const pass = (process.env.GDD_PASSWORD_MODE || 'plain').toLowerCase() === 'md5'
    ? createHash('md5').update(password).digest('hex') : password;
  const businessBase = (process.env.GDD_BUSINESS_URL || BUSINESS_BASE).replace(/\/+$/, '');
  const login = await postJson(
    businessBase + '/investment-adviser/customer/login',
    { account, password: pass, device, orgCode: '0007', loginType: 1, verificationCode: '' },
    appHeaders(), signal
  );
  if (Number(login.code ?? login.ret) !== 0 || !login.result?.sessionCode) {
    // 错误响应可能包含用户名或会话，不透传服务端原始字符串。
    throw new Error('GDD 登录失败，请检查账号密码、设备限制或客户端版本');
  }
  const session = String(login.result.sessionCode);
  const servers = await postJson(
    businessBase + '/investment-adviser/config/query_server_info',
    { sessionCode: session },
    appHeaders(session), signal
  );
  if (Number(servers.code ?? servers.ret) !== 0) throw new Error('GDD 服务器清单查询失败');
  const urls: Partial<Record<35 | 36, string>> = {};
  for (const item of Array.isArray(servers.result?.sers) ? servers.result.sers : []) {
    const type = Number(item.serverType);
    if (type !== 35 && type !== 36) continue;
    const port = Number(item.serverPort);
    const ip = String(item.ip ?? '');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ||
        ip.split('.').some((segment) => Number(segment) > 255) ||
        !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    urls[type as 35 | 36] = gatewayUrl('http://' + ip + ':' + port + '/');
  }
  if (!urls[36]) throw new Error('GDD 未下发有效的 serverType=36 行情网关');
  return urls;
}

export function invalidateGddGateway(): void {
  cachedServers = undefined;
}

/**
 * 一次登录获取完整服务器清单：36 行情统一网关、35 龙虎榜服务。
 * 缓存15分钟；连接失败后调用 invalidateGddGateway 重新登录发现。
 */
export async function getGddServerAddress(type: 35 | 36, signal?: AbortSignal): Promise<string> {
  if (cachedServers && cachedServers.until > Date.now()) {
    const url = cachedServers.urls[type];
    if (!url) throw new Error('GDD 服务清单中不存在 serverType=' + type);
    return url;
  }
  if (!discoveryPromise) {
    discoveryPromise = discoverServers(signal).then((urls) => {
      cachedServers = { urls, until: Date.now() + DISCOVERY_TTL_MS };
      return urls;
    }).finally(() => { discoveryPromise = undefined; });
  }
  const servers = await discoveryPromise;
  const url = servers[type];
  if (!url) throw new Error('GDD 服务清单中不存在 serverType=' + type);
  return url;
}

export async function getGddGateway(signal?: AbortSignal): Promise<string> {
  return getGddServerAddress(36, signal);
}

export function gddMarketCode(code: string): number {
  if (!/^\d{6}$/.test(code)) throw new Error('GDD 股票代码必须为6位数字');
  if (/^3/.test(code)) return 1008;
  if (/^68/.test(code)) return 7;
  if (/^(6|5|9)/.test(code)) return 1;
  if (/^(0|2|3)/.test(code)) return 1001;
  // 北交所交易编码没有在已验证的 GDD 市场清单中，禁止猜测。
  throw new Error('GDD 暂不支持该市场编码：' + code);
}

async function requestQuote(reqtype: number, reqid: number, data: object, signal?: AbortSignal): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await getGddGateway(signal);
    let response: any;
    try {
      response = await postJson(url, { reqtype, reqid, session: '', data }, {}, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof TypeError || /GDD HTTP (502|503|504)|fetch failed|aborted/i.test(message);
      if (attempt === 0 && retryable && !signal?.aborted) {
        invalidateGddGateway();
        continue;
      }
      throw error;
    }
    if (response.reqtype !== undefined && Number(response.reqtype) !== reqtype) {
      throw new Error('GDD 响应 reqtype 不匹配');
    }
    const status = Number(response.status ?? 0);
    if (status !== 0) {
      throw new Error('GDD 行情失败 status=' + status + '：' + String(response.msg || '').slice(0, 160));
    }
    return response.data || {};
  }
  throw new Error('GDD 动态网关重试失败');
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
    const timeRaw = String(row[idx.tradeTime] ?? '').trim();
    let datetime: string;
    if (/^\d+$/.test(timeRaw)) {
      // GDD A股分时分钟偏移相对 UTC 当天：90→北京时间09:30，420→15:00。
      // 只接受有效分钟范围，防止把秒级时间戳误当分钟。
      const minutes = Number(timeRaw);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) {
        throw new Error('GDD 分时时间分钟偏移无效');
      }
      const base = Date.parse(day + 'T00:00:00Z');
      if (!Number.isFinite(base)) throw new Error('GDD 分时日期无效');
      datetime = new Date(base + (minutes + 480) * 60_000)
        .toISOString().slice(0, 19).replace('T', ' ');
    } else {
      const full = /^\d{4}-/.test(timeRaw) ? timeRaw : day + ' ' + timeRaw;
      datetime = timestamp(full, true);
    }
    const avg = numeric(row, idx.avgPrice, false);
    return {
      datetime, time: datetime.slice(11, 16), price,
      avgPrice: avg ?? price, volume: numeric(row, idx.volume, false) ?? 0,
      amount: numeric(row, idx.amount, false) ?? 0,
      pct: previous > 0 ? (price - previous) / previous * 100 : 0
    };
  }).sort((a, b) => a.datetime.localeCompare(b.datetime));
}

export interface GddTickRow {
  time: string;
  millisecond: number;
  flag: number;
  price: number;
  volume: number;
  amount: number;
  type: number;
}

/** reqtype=151 历史分笔：按原客户端 Candle/Tick 数组位序解析。 */
export async function fetchGddTicks(code: string, day: string, signal?: AbortSignal): Promise<GddTickRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) ||
      new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) {
    throw new Error('GDD 分笔日期必须为有效 YYYY-MM-DD');
  }
  const body = await requestQuote(151, 1, {
    market: gddMarketCode(code), code,
    timetype: 0, timevalue0: 90, timevalue1: 420,
    day: day + ' 0:0:0'
  }, signal);
  const raw = body.tick;
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) throw new Error('GDD 分笔返回缺少 tick 表格');
  const items: GddTickRow[] = [];
  for (const row of raw.slice(1, 2001)) {
    if (!Array.isArray(row) || row.length < 7) throw new Error('GDD 分笔行格式错误');
    const [time, millisecond, flag, price, volume, amount, type] = row;
    const nums = [millisecond,flag,price,volume,amount,type].map(Number);
    if (nums.some((n) => !Number.isFinite(n)) || nums[2] <= 0 || nums[3] < 0 || nums[4] < 0) {
      throw new Error('GDD 分笔数据包含异常数值');
    }
    items.push({ time:String(time), millisecond:nums[0], flag:nums[1],
      price:nums[2], volume:nums[3], amount:nums[4], type:nums[5] });
  }
  return items;
}

export async function fetchGddTrend(code: string, day?: string, signal?: AbortSignal, includeAuction = false): Promise<GddTrendRow[]> {
  const market = gddMarketCode(code);
  const now = new Date(Date.now() + 8 * 3600_000);
  const date = day || now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('GDD 日期必须为 YYYY-MM-DD');
  const response = await requestQuote(152, 152, {
    market, code, timetype: 0, timevalue0: includeAuction ? 75 : 90, timevalue1: 420,
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
