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
 * 交易计划与盘中监控配置。
 * 本服务只生成执行提示，不连接券商、不自动下单。
 */
export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: numberValue('PORT', 8091),
  timeZone: process.env.TZ || 'Asia/Shanghai',
  databasePath:
    process.env.TRADE_DATABASE_PATH ||
    path.resolve(process.cwd(), 'data/trade.duckdb'),
  marketDataUrl:
    process.env.MARKET_DATA_URL || 'http://127.0.0.1:8080',
  stockSelectUrl:
    process.env.STOCK_SELECT_URL || 'http://127.0.0.1:8090',

  monitorEnabled: booleanValue('TRADE_MONITOR_ENABLED', true),
  monitorCron: process.env.TRADE_MONITOR_CRON || '* * * * 1-5',
  planSyncCron: process.env.TRADE_PLAN_SYNC_CRON || '45 16 * * 1-5',
  monitorTopCount: Math.min(
    Math.max(numberValue('TRADE_MONITOR_TOP_COUNT', 3), 1),
    10
  ),

  defaultStopPct: numberValue('TRADE_DEFAULT_STOP_PCT', 3),
  defaultTakeProfit1Pct: numberValue(
    'TRADE_DEFAULT_TAKE_PROFIT1_PCT',
    4
  ),
  defaultTakeProfit2Pct: numberValue(
    'TRADE_DEFAULT_TAKE_PROFIT2_PCT',
    6
  ),
  defaultTrailingStartPct: numberValue(
    'TRADE_DEFAULT_TRAILING_START_PCT',
    4
  ),
  defaultTrailingDrawdownPct: numberValue(
    'TRADE_DEFAULT_TRAILING_DRAWDOWN_PCT',
    2
  ),
  defaultTimeStopDays: Math.max(
    numberValue('TRADE_DEFAULT_TIME_STOP_DAYS', 2),
    1
  )
};
