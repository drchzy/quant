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

  // 东财 push2/push2his 有 IP 级风控。默认把所有请求串行并保持至少 1 秒间隔。
  eastmoneyMinIntervalMs: Math.max(
    readNumber('EASTMONEY_MIN_INTERVAL_MS', 1_000),
    200
  ),
  eastmoneyRetryCount: Math.min(
    Math.max(readNumber('EASTMONEY_RETRY_COUNT', 2), 0),
    5
  ),
  eastmoneyRetryBaseMs: Math.max(
    readNumber('EASTMONEY_RETRY_BASE_MS', 1_500),
    200
  ),

  // push2delay 实测单页最多约 100 条，因此这里最多按 100 分页。
  eastmoneyPageSize: Math.min(
    Math.max(readNumber('EASTMONEY_PAGE_SIZE', 100), 50),
    100
  ),

  marketCacheTtlMs: Math.max(
    readNumber('MARKET_CACHE_TTL_MS', 60_000),
    5_000
  ),
  sectorCacheTtlMs: Math.max(
    readNumber('SECTOR_CACHE_TTL_MS', 300_000),
    30_000
  ),
  quoteCacheTtlMs: Math.max(
    readNumber('QUOTE_CACHE_TTL_MS', 5_000),
    1_000
  ),
  trendCacheTtlMs: Math.max(
    readNumber('TREND_CACHE_TTL_MS', 10_000),
    1_000
  ),

  // 腾讯备用源也做轻量限速，避免东财失效时瞬间把请求全部切过去。
  fallbackMinIntervalMs: Math.max(
    readNumber('FALLBACK_MIN_INTERVAL_MS', 300),
    100
  ),
  fallbackRetryCount: Math.min(
    Math.max(readNumber('FALLBACK_RETRY_COUNT', 1), 0),
    3
  ),
  fallbackRetryBaseMs: Math.max(
    readNumber('FALLBACK_RETRY_BASE_MS', 500),
    100
  )
};
