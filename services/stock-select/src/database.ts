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


  await run(`
    CREATE TABLE IF NOT EXISTS select_review (
      run_id VARCHAR NOT NULL,
      code VARCHAR NOT NULL,
      is_main BOOLEAN NOT NULL,
      select_date DATE NOT NULL,
      next_trade_date DATE,
      status VARCHAR NOT NULL,
      entry_price DOUBLE,
      exit_date DATE,
      exit_price DOUBLE,
      exit_reason VARCHAR,
      return_pct DOUBLE,
      max_profit_pct DOUBLE,
      max_loss_pct DOUBLE,
      next_open DOUBLE,
      next_high DOUBLE,
      next_low DOUBLE,
      next_close DOUBLE,
      next_close_return_pct DOUBLE,
      hit_take_profit1 BOOLEAN,
      hit_take_profit2 BOOLEAN,
      days_held INTEGER,
      updated_at TIMESTAMP NOT NULL,
      PRIMARY KEY (run_id, code)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS backtest_run (
      id VARCHAR PRIMARY KEY,
      status VARCHAR NOT NULL,
      start_date DATE,
      end_date DATE,
      trade_days INTEGER NOT NULL,
      signals INTEGER NOT NULL,
      trades INTEGER NOT NULL,
      message VARCHAR,
      default_json VARCHAR,
      best_json VARCHAR,
      created_at TIMESTAMP NOT NULL,
      finished_at TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS backtest_parameter (
      backtest_id VARCHAR NOT NULL,
      rank INTEGER NOT NULL,
      stop_pct DOUBLE NOT NULL,
      target_pct DOUBLE NOT NULL,
      trailing_start_pct DOUBLE NOT NULL,
      trailing_drawdown_pct DOUBLE NOT NULL,
      hold_days INTEGER NOT NULL,
      trades INTEGER NOT NULL,
      win_rate DOUBLE,
      avg_return DOUBLE,
      profit_loss_ratio DOUBLE,
      max_drawdown DOUBLE,
      total_return DOUBLE,
      score DOUBLE,
      PRIMARY KEY (backtest_id, rank)
    )
  `);
}

export async function closeDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    (db as any).close(() => resolve());
  });
}
