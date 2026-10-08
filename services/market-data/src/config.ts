import path from 'node:path';

function readNumber(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * market-data 的统一配置。
 * 业务代码不直接读取环境变量，后续新增配置更容易维护。
 */
export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: readNumber('PORT', 8080),
  timeZone: process.env.TZ || 'Asia/Shanghai',
  databasePath:
    process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data/market.duckdb'),
  syncEnabled: readBoolean('SYNC_ENABLED', true),
  dailySyncCron: process.env.DAILY_SYNC_CRON || '10 16 * * 1-5',
  eastmoneyTimeoutMs: readNumber('EASTMONEY_TIMEOUT_MS', 10_000),
  eastmoneyPageSize: Math.min(
    Math.max(readNumber('EASTMONEY_PAGE_SIZE', 500), 50),
    1000
  )
};
