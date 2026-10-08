import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { all, one, run } from './database.js';
import {
  getMarketOverview,
  getTechnicalStocks
} from './market-data.js';
import { selectStocks } from './strategy.js';
import type { SelectResult } from './types.js';
import { getReviewSummary } from './review.js';
import { getLatestBacktest } from './backtest.js';

export async function runSelect() {
  const id = randomUUID();
  const technical = await getTechnicalStocks();

  if (!technical.tradeDate) {
    throw new Error(
      'market-data 还没有历史日K，请先在数据同步页面初始化历史日K'
    );
  }

  if (technical.count < 100) {
    throw new Error(
      `可用于选股的股票只有 ${technical.count} 只，历史数据可能尚未初始化完成`
    );
  }

  const results = selectStocks(technical.data);

  await run('BEGIN TRANSACTION');
  try {
    await run(
      `INSERT INTO select_run
        (id, trade_date, strategy, status, total, passed, message, created_at)
       VALUES (?, ?, '超短趋势', 'success', ?, ?, ?, current_timestamp)`,
      [
        id,
        technical.tradeDate,
        technical.count,
        results.length,
        results.length > 0
          ? `从 ${technical.count} 只股票中选出 ${results.length} 只候选`
          : '没有股票达到当前策略最低分'
      ]
    );

    for (const item of results) {
      await run(
        `INSERT INTO select_result (
          run_id, rank, is_main, code, name, setup, score,
          close, pct, amount, turnover, market_cap,
          ma5, ma10, ma20, volume_rate5, return5, return20,
          previous_high20, close_strength,
          reasons_json, plan_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
        [
          id,
          item.rank,
          item.isMain,
          item.code,
          item.name,
          item.setup,
          item.score,
          item.close,
          item.pct,
          item.amount,
          item.turnover,
          item.marketCap,
          item.ma5,
          item.ma10,
          item.ma20,
          item.volumeRate5,
          item.return5,
          item.return20,
          item.previousHigh20,
          item.closeStrength,
          JSON.stringify(item.reasons),
          JSON.stringify(item.plan)
        ]
      );
    }

    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }

  return {
    runId: id,
    tradeDate: technical.tradeDate,
    total: technical.count,
    count: results.length,
    mainCount: results.filter((item) => item.isMain).length,
    data: results
  };
}

function parseResult(row: any): SelectResult {
  return {
    rank: Number(row.rank),
    isMain: Boolean(row.is_main),
    code: row.code,
    name: row.name,
    setup: row.setup,
    score: Number(row.score),
    close: Number(row.close),
    pct: Number(row.pct || 0),
    amount: Number(row.amount || 0),
    turnover:
      row.turnover === null ? null : Number(row.turnover),
    marketCap: Number(row.market_cap || 0),
    ma5: Number(row.ma5),
    ma10: Number(row.ma10),
    ma20: Number(row.ma20),
    volumeRate5:
      row.volume_rate5 === null
        ? null
        : Number(row.volume_rate5),
    return5:
      row.return5 === null ? null : Number(row.return5),
    return20:
      row.return20 === null ? null : Number(row.return20),
    previousHigh20:
      row.previous_high20 === null
        ? null
        : Number(row.previous_high20),
    closeStrength:
      row.close_strength === null
        ? null
        : Number(row.close_strength),
    reasons: JSON.parse(row.reasons_json || '[]'),
    plan: JSON.parse(row.plan_json || '{}')
  };
}

export async function getLatest(limit = config.topCount) {
  const latestRun = await one<any>(
    `SELECT *
     FROM select_run
     WHERE status = 'success'
     ORDER BY created_at DESC
     LIMIT 1`
  );

  if (!latestRun) {
    return {
      run: null,
      data: []
    };
  }

  const rows = await all<any>(
    `SELECT *
     FROM select_result
     WHERE run_id = ?
     ORDER BY rank
     LIMIT ?`,
    [latestRun.id, limit]
  );

  return {
    run: latestRun,
    data: rows.map(parseResult)
  };
}

export async function getRuns(limit = 30) {
  return all<any>(
    `SELECT *
     FROM select_run
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );
}

export async function getRun(id: string) {
  const runRow = await one<any>(
    'SELECT * FROM select_run WHERE id = ?',
    [id]
  );

  if (!runRow) return null;

  const rows = await all<any>(
    `SELECT *
     FROM select_result
     WHERE run_id = ?
     ORDER BY rank`,
    [id]
  );

  return {
    run: runRow,
    data: rows.map(parseResult)
  };
}

/**
 * AI 专用接口：
 * 一次返回当日市场背景、主候选3只和完整候选列表。
 */
export async function getAiSelect() {
  const [latest, market, review, backtest] = await Promise.all([
    getLatest(config.topCount),
    getMarketOverview(),
    getReviewSummary(true),
    getLatestBacktest()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    strategy: '超短趋势',
    rules: {
      mainCount: config.mainCount,
      topCount: config.topCount,
      maxPositionPct: config.maxPositionPct,
      trailingStartPct: config.trailingStartPct,
      trailingDrawdownPct: config.trailingDrawdownPct,
      timeStopDays: config.timeStopDays
    },
    market,
    review,
    backtest,
    run: latest.run,
    main: latest.data.filter((item) => item.isMain),
    candidates: latest.data
  };
}
