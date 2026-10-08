import { all, run } from './database.js';

// 外部采集桥接：只接收已经解析、校验过的数据，不接收 SQL 或任意表名。
// 所有请求强制指定固定类型，每批最多 200 条，避免客户端误操作写爆内存。
export type BridgeDataType = 'snapshot' | 'daily' | 'minute' | 'intraday' | 'sector' | 'index';
type Row = Record<string, unknown>;
const allowed = new Set<BridgeDataType>(['snapshot', 'daily', 'minute', 'intraday', 'sector', 'index']);

function field(row: Row, key: string, required = false): string {
  const value = row[key];
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (required && !text) throw new Error(key + ' 不能为空');
  if (text.length > 100) throw new Error(key + ' 过长');
  return text;
}
function numeric(row: Row, key: string, required = false): number | null {
  const value = row[key];
  if (value === undefined || value === null || value === '' || value === '-') {
    if (required) throw new Error(key + ' 不能为空');
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(key + ' 必须是有限数字');
  return number;
}
function code(row: Row): string {
  const value = field(row, 'code', true);
  if (!/^\d{6}$/.test(value)) throw new Error('股票代码必须是六位数字');
  return value;
}
function date(row: Row, key: string): string {
  const value = field(row, key, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new Error(key + ' 必须是有效日期 YYYY-MM-DD');
  }
  return value;
}
function datetime(row: Row): string {
  const value = field(row, 'tradeTime', true).replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) {
    throw new Error('tradeTime 格式应为 YYYY-MM-DD HH:mm[:ss]');
  }
  date({ d: value.slice(0, 10) }, 'd');
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16));
  if (hour > 23 || minute > 59 || (value.length > 16 && Number(value.slice(17, 19)) > 59)) {
    throw new Error('tradeTime 时间无效');
  }
  return value;
}
async function upsertStock(row: Row): Promise<void> {
  const stockCode = code(row);
  const name = field(row, 'name') || stockCode;
  const market = /^(5|6|9)/.test(stockCode) ? 1 : 0;
  const marketName = /^(4|8|92)/.test(stockCode) ? '北京' : market === 1 ? '上海' : '深圳';
  await run(
    \`INSERT INTO stock (code, name, market, market_name, updated_at)
     VALUES (?, ?, ?, ?, now()) ON CONFLICT (code) DO UPDATE SET
       name = CASE WHEN excluded.name = excluded.code THEN stock.name ELSE excluded.name END,
       market = excluded.market, market_name = excluded.market_name, updated_at = now()\`,
    [stockCode, name, market, marketName]
  );
}
async function saveSnapshot(row: Row) {
  await upsertStock(row);
  const stockCode = code(row);
  const tradeDate = date(row, 'tradeDate');
  await run(
    \`INSERT INTO daily_price
      (code, trade_date, open, close, high, low, pre_close, volume, amount,
       pct, change, amplitude, turnover, pe, pb, volume_ratio, total_market_cap,
       float_market_cap, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external_eastmoney', now())
      ON CONFLICT (code, trade_date) DO UPDATE SET
       open = COALESCE(excluded.open, daily_price.open),
       close = COALESCE(excluded.close, daily_price.close),
       high = COALESCE(excluded.high, daily_price.high),
       low = COALESCE(excluded.low, daily_price.low),
       pre_close = COALESCE(excluded.pre_close, daily_price.pre_close),
       volume = COALESCE(excluded.volume, daily_price.volume),
       amount = COALESCE(excluded.amount, daily_price.amount),
       pct = COALESCE(excluded.pct, daily_price.pct),
       change = COALESCE(excluded.change, daily_price.change),
       amplitude = COALESCE(excluded.amplitude, daily_price.amplitude),
       turnover = COALESCE(excluded.turnover, daily_price.turnover),
       pe = COALESCE(excluded.pe, daily_price.pe),
       pb = COALESCE(excluded.pb, daily_price.pb),
       volume_ratio = COALESCE(excluded.volume_ratio, daily_price.volume_ratio),
       total_market_cap = COALESCE(excluded.total_market_cap, daily_price.total_market_cap),
       float_market_cap = COALESCE(excluded.float_market_cap, daily_price.float_market_cap),
       source = excluded.source, updated_at = now()\`,
    [stockCode, tradeDate, numeric(row, 'open'), numeric(row, 'close', true),
     numeric(row, 'high'), numeric(row, 'low'), numeric(row, 'preClose'),
     numeric(row, 'volume'), numeric(row, 'amount'), numeric(row, 'pct'),
     numeric(row, 'change'), numeric(row, 'amplitude'), numeric(row, 'turnover'),
     numeric(row, 'pe'), numeric(row, 'pb'), numeric(row, 'volumeRatio'),
     numeric(row, 'totalMarketCap'), numeric(row, 'floatMarketCap')]
  );
}
async function saveDaily(row: Row) {
  // 日K和快照存入同一张标准行情表；未提供的扩展字段不会擦除已有信息。
  await saveSnapshot({ ...row, tradeDate: date(row, 'date') });
}
async function saveMinute(row: Row) {
  await upsertStock(row);
  const period = numeric(row, 'period', true);
  if (![1, 5, 15, 30, 60].includes(period!)) throw new Error('period 必须是 1/5/15/30/60');
  await run(
    \`INSERT INTO minute_price
     (code, period, trade_time, open, close, high, low, volume, amount, pct,
      change, turnover, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external_eastmoney', now())
     ON CONFLICT (code, period, trade_time) DO UPDATE SET
      open = excluded.open, close = excluded.close, high = excluded.high,
      low = excluded.low, volume = excluded.volume, amount = excluded.amount,
      pct = excluded.pct, change = excluded.change, turnover = excluded.turnover,
      source = excluded.source, updated_at = now()\`,
    [code(row), period, datetime(row),
     numeric(row, 'open'), numeric(row, 'close', true),
     numeric(row, 'high'), numeric(row, 'low'),
     numeric(row, 'volume'), numeric(row, 'amount'),
     numeric(row, 'pct'), numeric(row, 'change'), numeric(row, 'turnover')]
  );
}
async function saveIntraday(row: Row) {
  await upsertStock(row);
  await run(
    \`INSERT INTO intraday_trend
      (code, trade_time, price, avg_price, volume, amount, pct, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'external_eastmoney', now())
     ON CONFLICT (code, trade_time) DO UPDATE SET
       price = excluded.price, avg_price = excluded.avg_price,
       volume = excluded.volume, amount = excluded.amount, pct = excluded.pct,
       source = excluded.source, updated_at = now()\`,
    [code(row), datetime(row), numeric(row, 'price', true),
     numeric(row, 'avgPrice'), numeric(row, 'volume'),
     numeric(row, 'amount'), numeric(row, 'pct')]
  );
}
async function saveSector(row: Row) {
  const type = field(row, 'type', true);
  if (type !== 'industry' && type !== 'concept') throw new Error('type 必须是 industry 或 concept');
  const code = field(row, 'code', true);
  if (!/^[A-Za-z0-9]{2,20}$/.test(code)) throw new Error('板块代码不合法');
  await run(
    \`INSERT INTO sector
     (type, code, name, price, pct, main_inflow, up_count, down_count, lead_stock, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (type, code) DO UPDATE SET
       name = excluded.name, price = excluded.price, pct = excluded.pct,
       main_inflow = excluded.main_inflow, up_count = excluded.up_count,
       down_count = excluded.down_count, lead_stock = excluded.lead_stock, updated_at = now()\`,
    [type, code, field(row, 'name', true), numeric(row, 'price'),
     numeric(row, 'pct'), numeric(row, 'mainInflow'),
     numeric(row, 'upCount'), numeric(row, 'downCount'), field(row, 'leadStock')]
  );
}
async function saveIndex(row: Row) {
  const indexCode = code(row);
  await run(
    \`INSERT INTO market_index
     (code, name, price, open, high, low, pre_close, pct, change, volume, amount, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (code) DO UPDATE SET
      name = excluded.name, price = excluded.price, open = excluded.open,
      high = excluded.high, low = excluded.low, pre_close = excluded.pre_close,
      pct = excluded.pct, change = excluded.change, volume = excluded.volume,
      amount = excluded.amount, updated_at = now()\`,
    [indexCode, field(row, 'name', true), numeric(row, 'price', true),
     numeric(row, 'open'), numeric(row, 'high'), numeric(row, 'low'),
     numeric(row, 'preClose'), numeric(row, 'pct'),
     numeric(row, 'change'), numeric(row, 'volume'), numeric(row, 'amount')]
  );
}

const writers: Record<BridgeDataType, (row: Row) => Promise<void>> = {
  snapshot: saveSnapshot, daily: saveDaily, minute: saveMinute,
  intraday: saveIntraday, sector: saveSector, index: saveIndex
};

// 统一串行处理桥接批次，阻止多个浏览器同时导入而互相争抢写入顺序。
let writeQueue: Promise<void> = Promise.resolve();
export async function importBridgeRows(payload: unknown): Promise<{ type: BridgeDataType; count: number }> {
  const body = payload as { type?: string; rows?: unknown[] } | null;
  if (!body || !allowed.has(body.type as BridgeDataType) ||
      !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 200) {
    throw new Error('请求必须包含 type 和 1~200 条 rows');
  }
  const type = body.type as BridgeDataType;
  for (const row of body.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('rows 必须是对象数组');
  }
  const job = writeQueue.catch(() => {}).then(async () => {
    for (const row of body.rows!) await writers[type](row as Row);
  });
  writeQueue = job;
  await job;
  return { type, count: body.rows.length };
}

export async function getBridgeCounts() {
  const tables = ['stock', 'daily_price', 'minute_price', 'intraday_trend', 'sector', 'market_index'];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await all<{ total: number }>(\`SELECT COUNT(*)::INTEGER AS total FROM \${table}\`);
    counts[table] = Number(rows[0]?.total || 0);
  }
  return counts;
}
