import fs from 'node:fs';
import path from 'node:path';
import duckdb from 'duckdb';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

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
    CREATE TABLE IF NOT EXISTS trade_plan (
      id VARCHAR PRIMARY KEY,
      source VARCHAR NOT NULL,
      run_id VARCHAR,
      select_date DATE,
      code VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      rank INTEGER,
      setup VARCHAR,
      score DOUBLE,
      plan_json VARCHAR NOT NULL,

      state VARCHAR NOT NULL,
      signal VARCHAR NOT NULL,
      signal_reason VARCHAR,

      current_price DOUBLE,
      day_high DOUBLE,
      day_low DOUBLE,
      pct DOUBLE,
      avg_price DOUBLE,
      last_market_time VARCHAR,
      last_seen_date DATE,

      entry_date DATE,
      entry_time VARCHAR,
      entry_price DOUBLE,
      quantity INTEGER,
      highest_price DOUBLE,
      trailing_stop DOUBLE,
      hold_days INTEGER NOT NULL DEFAULT 0,

      exit_date DATE,
      exit_time VARCHAR,
      exit_price DOUBLE,
      exit_reason VARCHAR,
      return_pct DOUBLE,

      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS trade_event (
      id VARCHAR PRIMARY KEY,
      plan_id VARCHAR NOT NULL,
      code VARCHAR NOT NULL,
      event_type VARCHAR NOT NULL,
      from_state VARCHAR,
      to_state VARCHAR,
      signal VARCHAR,
      price DOUBLE,
      message VARCHAR,
      market_time VARCHAR,
      created_at TIMESTAMP NOT NULL
    )
  `);
}

export async function closeDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    (db as any).close(() => resolve());
  });
}
