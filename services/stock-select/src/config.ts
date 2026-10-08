import path from 'node:path';

function numberValue(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

function booleanValue(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * 超短趋势策略的默认配置。
 * 所有值都集中在这里，后续回测后可以逐项调整。
 */
export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: numberValue('PORT', 8090),
  timeZone: process.env.TZ || 'Asia/Shanghai',
  databasePath:
    process.env.SELECT_DATABASE_PATH ||
    path.resolve(process.cwd(), 'data/select.duckdb'),
  marketDataUrl:
    process.env.MARKET_DATA_URL || 'http://127.0.0.1:8080',
  autoSelectEnabled: booleanValue('AUTO_SELECT_ENABLED', true),
  selectCron: process.env.SELECT_CRON || '40 16 * * 1-5',

  // 每次最终保存多少只候选，页面默认重点展示前三名。
  topCount: numberValue('SELECT_TOP_COUNT', 10),
  mainCount: numberValue('SELECT_MAIN_COUNT', 3),

  // 硬过滤条件。
  excludeBse: booleanValue('SELECT_EXCLUDE_BSE', true),
  excludeStar: booleanValue('SELECT_EXCLUDE_STAR', true),
  excludeSt: booleanValue('SELECT_EXCLUDE_ST', true),
  minPrice: numberValue('SELECT_MIN_PRICE', 3),
  minAmount: numberValue('SELECT_MIN_AMOUNT', 100_000_000),
  minMarketCap: numberValue('SELECT_MIN_MARKET_CAP', 2_000_000_000),
  maxMarketCap: numberValue('SELECT_MAX_MARKET_CAP', 100_000_000_000),
  minTurnover: numberValue('SELECT_MIN_TURNOVER', 1),
  maxTurnover: numberValue('SELECT_MAX_TURNOVER', 18),
  minPct: numberValue('SELECT_MIN_PCT', -3),
  maxPct: numberValue('SELECT_MAX_PCT', 7),
  minScore: numberValue('SELECT_MIN_SCORE', 55),

  // 次日执行规则。
  noChasePct: numberValue('PLAN_NO_CHASE_PCT', 4),
  firstTakeProfitPct: numberValue('PLAN_TAKE_PROFIT_1_PCT', 4),
  secondTakeProfitPct: numberValue('PLAN_TAKE_PROFIT_2_PCT', 6),
  maxLossPct: numberValue('PLAN_MAX_LOSS_PCT', 3),
  trailingStartPct: numberValue('PLAN_TRAILING_START_PCT', 4),
  trailingDrawdownPct: numberValue('PLAN_TRAILING_DRAWDOWN_PCT', 2),
  maxPositionPct: numberValue('PLAN_MAX_POSITION_PCT', 50),
  timeStopDays: numberValue('PLAN_TIME_STOP_DAYS', 2)
};
