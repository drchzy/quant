import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { all, one, run } from './database.js';
import {
  getFuturePrices,
  getTechnicalStocks,
  getTradeDates
} from './market-data.js';
import { selectStocks } from './strategy.js';
import type { SelectResult } from './types.js';

interface DailyBar {
  code: string;
  trade_date: string;
  open: number;
  close: number;
  high: number;
  low: number;
}

interface Params {
  stopPct: number;
  targetPct: number;
  trailingStartPct: number;
  trailingDrawdownPct: number;
  holdDays: number;
}

interface Signal {
  date: string;
  rank: number;
  candidate: SelectResult;
  bars: DailyBar[];
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function chooseEntry(
  candidate: SelectResult,
  bar: DailyBar
): number | null {
  const plan = candidate.plan;

  if (bar.low > plan.entryHigh || bar.high < plan.entryLow) {
    return null;
  }

  if (
    bar.open >= plan.entryLow &&
    bar.open <= plan.entryHigh &&
    bar.open <= plan.noChasePrice
  ) {
    return Number(bar.open);
  }

  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) {
    return plan.entryHigh;
  }

  if (bar.open < plan.entryLow && bar.high >= plan.entryLow) {
    return plan.entryLow;
  }

  return null;
}

/**
 * 参数回测只优化“退出纪律”。
 * 入场仍使用实际选股计划的买入区和不追价规则，保证不同参数之间可比较。
 */
function simulate(
  candidate: SelectResult,
  bars: DailyBar[],
  params: Params
): number | null {
  const first = bars[0];
  if (!first) return null;

  const entry = chooseEntry(candidate, first);
  if (entry === null) return null;

  const used = bars.slice(0, params.holdDays);
  const hardStop = entry * (1 - params.stopPct / 100);
  const target = entry * (1 + params.targetPct / 100);

  let runningHigh = entry;
  let trailingStop: number | null = null;

  for (const bar of used) {
    const high = Number(bar.high);
    const low = Number(bar.low);

    const stop =
      trailingStop === null
        ? hardStop
        : Math.max(hardStop, trailingStop);

    // 与每日复盘保持一致：日K同日碰上下边界时按更保守的止损优先。
    if (low <= stop) {
      return (stop / entry - 1) * 100;
    }

    if (high >= target) {
      return (target / entry - 1) * 100;
    }

    runningHigh = Math.max(runningHigh, high);

    if (
      runningHigh >=
      entry * (1 + params.trailingStartPct / 100)
    ) {
      trailingStop =
        runningHigh *
        (1 - params.trailingDrawdownPct / 100);
    }
  }

  if (used.length < params.holdDays) return null;

  return (Number(used.at(-1)!.close) / entry - 1) * 100;
}

function metrics(signals: Signal[], params: Params) {
  const trades = signals
    .map((signal) => ({
      date: signal.date,
      rank: signal.rank,
      value: simulate(signal.candidate, signal.bars, params)
    }))
    .filter(
      (item): item is { date: string; rank: number; value: number } =>
        item.value !== null && Number.isFinite(item.value)
    )
    .sort((a, b) =>
      a.date === b.date ? a.rank - b.rank : a.date.localeCompare(b.date)
    );

  if (trades.length === 0) {
    return {
      trades: 0,
      winRate: 0,
      avgReturn: 0,
      profitLossRatio: null,
      maxDrawdown: 0,
      totalReturn: 0,
      score: -999
    };
  }

  const values = trades.map((item) => item.value);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);

  const avg = (list: number[]) =>
    list.length
      ? list.reduce((sum, value) => sum + value, 0) / list.length
      : 0;

  const avgReturn = avg(values);
  const avgWin = avg(wins);
  const avgLoss = avg(losses);
  const pl =
    avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null;

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (const value of values) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(
      maxDrawdown,
      (equity / peak - 1) * 100
    );
  }

  const winRate = (wins.length / values.length) * 100;
  const totalReturn = (equity - 1) * 100;

  // 综合分只用于参数排序，不代表未来收益。
  // 平均收益和盈亏比权重更高，同时惩罚回撤。
  const score =
    avgReturn * 10 +
    winRate * 0.05 +
    Math.min(pl || 0, 5) * 2 -
    Math.abs(maxDrawdown) * 0.1;

  return {
    trades: values.length,
    winRate: round(winRate, 2),
    avgReturn: round(avgReturn, 3),
    profitLossRatio:
      pl === null ? null : round(pl, 3),
    maxDrawdown: round(maxDrawdown, 2),
    totalReturn: round(totalReturn, 2),
    score: round(score, 3)
  };
}

async function collectSignals(
  tradeDays: number,
  topCount: number
): Promise<Signal[]> {
  const dateResult = await getTradeDates(
    Math.min(tradeDays + 10, 250)
  );
  const allDates = dateResult.data;

  // 预留3个未来交易日给持有期回放。
  const dates = allDates
    .slice(0, Math.max(allDates.length - 3, 0))
    .slice(-tradeDays);

  const signals: Signal[] = [];

  for (const date of dates) {
    const technical = await getTechnicalStocks(date);
    if (!technical.tradeDate || technical.count < 100) continue;

    const candidates = selectStocks(technical.data)
      .slice(0, topCount);

    if (candidates.length === 0) continue;

    const future = await getFuturePrices(
      candidates.map((item) => item.code),
      technical.tradeDate,
      3
    );

    const grouped = new Map<string, DailyBar[]>();
    for (const row of future.data as DailyBar[]) {
      const list = grouped.get(row.code) || [];
      list.push(row);
      grouped.set(row.code, list);
    }

    for (const candidate of candidates) {
      signals.push({
        date: technical.tradeDate,
        rank: candidate.rank,
        candidate,
        bars: grouped.get(candidate.code) || []
      });
    }
  }

  return signals;
}

function parameterGrid(): Params[] {
  const stops = [2, 2.5, 3, 3.5];
  const targets = [4, 5, 6, 8];
  const starts = [3, 4, 5];
  const drawdowns = [1.5, 2, 2.5];
  const holds = [1, 2, 3];
  const result: Params[] = [];

  for (const stopPct of stops) {
    for (const targetPct of targets) {
      for (const trailingStartPct of starts) {
        for (const trailingDrawdownPct of drawdowns) {
          for (const holdDays of holds) {
            result.push({
              stopPct,
              targetPct,
              trailingStartPct,
              trailingDrawdownPct,
              holdDays
            });
          }
        }
      }
    }
  }

  return result;
}

async function executeBacktest(
  id: string,
  tradeDays: number,
  topCount: number
) {
  try {
    const signals = await collectSignals(tradeDays, topCount);

    await run(
      `UPDATE backtest_run
       SET signals = ?, message = ?
       WHERE id = ?`,
      [
        signals.length,
        `已生成 ${signals.length} 个历史候选，开始比较参数`,
        id
      ]
    );

    const defaultParams: Params = {
      stopPct: config.maxLossPct,
      targetPct: config.secondTakeProfitPct,
      trailingStartPct: config.trailingStartPct,
      trailingDrawdownPct: config.trailingDrawdownPct,
      holdDays: config.timeStopDays
    };

    const defaultMetrics = {
      params: defaultParams,
      ...metrics(signals, defaultParams)
    };

    const tested = parameterGrid()
      .map((params) => ({
        params,
        ...metrics(signals, params)
      }))
      .filter((item) => item.trades >= Math.min(10, signals.length))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.avgReturn !== a.avgReturn) {
          return b.avgReturn - a.avgReturn;
        }
        return b.totalReturn - a.totalReturn;
      });

    const top = tested.slice(0, 20);
    const best = top[0] || null;

    await run('BEGIN TRANSACTION');
    try {
      await run(
        'DELETE FROM backtest_parameter WHERE backtest_id = ?',
        [id]
      );

      for (let index = 0; index < top.length; index += 1) {
        const item = top[index];
        await run(
          `INSERT INTO backtest_parameter (
            backtest_id, rank, stop_pct, target_pct,
            trailing_start_pct, trailing_drawdown_pct,
            hold_days, trades, win_rate, avg_return,
            profit_loss_ratio, max_drawdown,
            total_return, score
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            index + 1,
            item.params.stopPct,
            item.params.targetPct,
            item.params.trailingStartPct,
            item.params.trailingDrawdownPct,
            item.params.holdDays,
            item.trades,
            item.winRate,
            item.avgReturn,
            item.profitLossRatio,
            item.maxDrawdown,
            item.totalReturn,
            item.score
          ]
        );
      }

      const dates = signals
        .map((item) => item.date)
        .sort();

      await run(
        `UPDATE backtest_run SET
          status = 'success',
          start_date = ?,
          end_date = ?,
          trade_days = ?,
          trades = ?,
          message = ?,
          default_json = ?,
          best_json = ?,
          finished_at = current_timestamp
         WHERE id = ?`,
        [
          dates[0] || null,
          dates.at(-1) || null,
          tradeDays,
          best?.trades || 0,
          `完成 ${parameterGrid().length} 组参数比较`,
          JSON.stringify(defaultMetrics),
          JSON.stringify(best),
          id
        ]
      );

      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    await run(
      `UPDATE backtest_run SET
        status = 'failed',
        message = ?,
        finished_at = current_timestamp
       WHERE id = ?`,
      [
        error instanceof Error ? error.message : String(error),
        id
      ]
    );
  }
}

export async function startBacktest(
  tradeDays = 60,
  topCount = 3
) {
  const running = await one<any>(
    `SELECT id, trade_days, message
     FROM backtest_run
     WHERE status = 'running'
     ORDER BY created_at DESC
     LIMIT 1`
  );

  if (running) {
    throw new Error(
      `已有回测任务正在运行：${running.id}`
    );
  }

  const id = randomUUID();
  const safeDays = Math.min(Math.max(tradeDays, 20), 180);
  const safeTop = Math.min(Math.max(topCount, 1), 10);

  await run(
    `INSERT INTO backtest_run (
      id, status, start_date, end_date,
      trade_days, signals, trades, message,
      default_json, best_json, created_at, finished_at
    ) VALUES (?, 'running', NULL, NULL, ?, 0, 0, ?, NULL, NULL, current_timestamp, NULL)`,
    [
      id,
      safeDays,
      `开始回测最近 ${safeDays} 个交易日，取每日前 ${safeTop} 只`
    ]
  );

  void executeBacktest(id, safeDays, safeTop);

  return {
    id,
    status: 'running',
    tradeDays: safeDays,
    topCount: safeTop
  };
}

export async function getBacktests(limit = 20) {
  return all<any>(
    `SELECT *
     FROM backtest_run
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );
}

export async function getBacktest(id: string) {
  const row = await one<any>(
    'SELECT * FROM backtest_run WHERE id = ?',
    [id]
  );
  if (!row) return null;

  const parameters = await all<any>(
    `SELECT *
     FROM backtest_parameter
     WHERE backtest_id = ?
     ORDER BY rank`,
    [id]
  );

  return {
    run: {
      ...row,
      default:
        row.default_json ? JSON.parse(row.default_json) : null,
      best:
        row.best_json ? JSON.parse(row.best_json) : null
    },
    parameters
  };
}

export async function getLatestBacktest() {
  const row = await one<any>(
    `SELECT id
     FROM backtest_run
     ORDER BY created_at DESC
     LIMIT 1`
  );

  return row ? getBacktest(row.id) : null;
}
