import fs from 'node:fs';
import path from 'node:path';
import duckdb from 'duckdb';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

// DuckDB 只允许 market-data 服务直接访问。
// Web 和 AI 都通过 HTTP API 读写，避免多进程直接抢数据库文件。
const db = new duckdb.Database(config.databasePath);

export function run(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    (db as any).run(sql, ...params, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    (db as any).all(sql, ...params, (error: Error | null, rows: T[]) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

export async function one<T>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await all<T>(sql, params);
  return rows[0] ?? null;
}

export async function initDatabase(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS stock (
      code VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      market INTEGER NOT NULL,
      market_name VARCHAR NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS daily_price (
      code VARCHAR NOT NULL,
      trade_date DATE NOT NULL,
      open DOUBLE,
      close DOUBLE,
      high DOUBLE,
      low DOUBLE,
      pre_close DOUBLE,
      volume DOUBLE,
      amount DOUBLE,
      pct DOUBLE,
      change DOUBLE,
      amplitude DOUBLE,
      turnover DOUBLE,
      pe DOUBLE,
      pb DOUBLE,
      volume_ratio DOUBLE,
      total_market_cap DOUBLE,
      float_market_cap DOUBLE,
      source VARCHAR NOT NULL,
      updated_at TIMESTAMP NOT NULL,
      PRIMARY KEY (code, trade_date)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS minute_price (
      code VARCHAR NOT NULL,
      period INTEGER NOT NULL,
      trade_time TIMESTAMP NOT NULL,
      open DOUBLE,
      close DOUBLE,
      high DOUBLE,
      low DOUBLE,
      volume DOUBLE,
      amount DOUBLE,
      pct DOUBLE,
      change DOUBLE,
      turnover DOUBLE,
      source VARCHAR NOT NULL,
      updated_at TIMESTAMP NOT NULL,
      PRIMARY KEY (code, period, trade_time)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sector (
      type VARCHAR NOT NULL,
      code VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      price DOUBLE,
      pct DOUBLE,
      main_inflow DOUBLE,
      up_count INTEGER,
      down_count INTEGER,
      lead_stock VARCHAR,
      updated_at TIMESTAMP NOT NULL,
      PRIMARY KEY (type, code)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS market_index (
      code VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      price DOUBLE,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      pre_close DOUBLE,
      pct DOUBLE,
      change DOUBLE,
      volume DOUBLE,
      amount DOUBLE,
      updated_at TIMESTAMP NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sync_job (
      id VARCHAR PRIMARY KEY,
      job_type VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      total INTEGER NOT NULL,
      done INTEGER NOT NULL,
      message VARCHAR,
      started_at TIMESTAMP NOT NULL,
      finished_at TIMESTAMP
    )
  `);
}

export async function closeDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    (db as any).close(() => resolve());
  });
}
