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

export function one<T>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  return all<T>(sql, params).then((rows) => rows[0] ?? null);
}

export async function initDatabase(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS select_run (
      id VARCHAR PRIMARY KEY,
      trade_date DATE,
      strategy VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      total INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      message VARCHAR,
      created_at TIMESTAMP NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS select_result (
      run_id VARCHAR NOT NULL,
      rank INTEGER NOT NULL,
      is_main BOOLEAN NOT NULL,
      code VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      setup VARCHAR NOT NULL,
      score DOUBLE NOT NULL,
      close DOUBLE NOT NULL,
      pct DOUBLE,
      amount DOUBLE,
      turnover DOUBLE,
      market_cap DOUBLE,
      ma5 DOUBLE,
      ma10 DOUBLE,
      ma20 DOUBLE,
      volume_rate5 DOUBLE,
      return5 DOUBLE,
      return20 DOUBLE,
      previous_high20 DOUBLE,
      close_strength DOUBLE,
      reasons_json VARCHAR NOT NULL,
      plan_json VARCHAR NOT NULL,
      created_at TIMESTAMP NOT NULL,
      PRIMARY KEY (run_id, code)
    )
  `);
}

export async function closeDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    (db as any).close(() => resolve());
  });
}
