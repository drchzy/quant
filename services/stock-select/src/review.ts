import { all, run } from './database.js';
import { getFuturePrices, getTradeDates } from './market-data.js';

interface DailyBar {
  code: string;
  trade_date: string;
  open: number;
  close: number;
  high: number;
  low: number;
}

interface Plan {
  entryLow: number;
  entryHigh: number;
  noChasePrice: number;
  stopPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStartPct: number;
  trailingDrawdownPct: number;
  timeStopDays: number;
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function chooseEntry(bar: DailyBar, plan: Plan): number | null {
  // 次日没有进入计划买入区，就视为没有成交。
  if (bar.low > plan.entryHigh || bar.high < plan.entryLow) {
    return null;
  }

  // 开盘就在区间内，按开盘价成交；超过“不追价”则不在开盘追。
  if (
    bar.open >= plan.entryLow &&
    bar.open <= plan.entryHigh &&
    bar.open <= plan.noChasePrice
  ) {
    return bar.open;
  }

  // 高开后回落到计划区，按区间上沿近似成交。
  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) {
    return plan.entryHigh;
  }

  // 低开后重新回到计划区，按区间下沿近似成交。
  if (bar.open < plan.entryLow && bar.high >= plan.entryLow) {
    return plan.entryLow;
  }

  return null;
}

/**
 * 用日K近似回放真实交易计划。
 *
 * 保守原则：
 * 1. 同一交易日同时触发止损和止盈时，先按止损处理。
 * 2. 当天新触发的移动止盈，从下一交易日开始生效，避免假设日内先后顺序。
 */
export function simulatePlan(
  selectClose: number,
  plan: Plan,
  bars: DailyBar[]
) {
  const next = bars[0];

  if (!next) {
    return {
      status: 'waiting',
      entryPrice: null,
      exitDate: null,
      exitPrice: null,
      exitReason: null,
      returnPct: null,
      maxProfitPct: null,
      maxLossPct: null,
      nextTradeDate: null,
      nextOpen: null,
      nextHigh: null,
      nextLow: null,
      nextClose: null,
      nextCloseReturnPct: null,
      hitTakeProfit1: false,
      hitTakeProfit2: false,
      daysHeld: 0
    };
  }

  const nextBase = {
    nextTradeDate: String(next.trade_date).slice(0, 10),
    nextOpen: Number(next.open),
    nextHigh: Number(next.high),
    nextLow: Number(next.low),
    nextClose: Number(next.close),
    nextCloseReturnPct: round(
      (Number(next.close) / selectClose - 1) * 100
    )
  };

  const entryPrice = chooseEntry(next, plan);

  if (entryPrice === null) {
    return {
      status: 'not_entered',
      entryPrice: null,
      exitDate: null,
      exitPrice: null,
      exitReason: '次日未进入计划买入区',
      returnPct: null,
      maxProfitPct: null,
      maxLossPct: null,
      ...nextBase,
      hitTakeProfit1: false,
      hitTakeProfit2: false,
      daysHeld: 0
    };
  }

  const holdDays = Math.max(Number(plan.timeStopDays || 2), 1);
  const usedBars = bars.slice(0, holdDays);

  let runningHigh = entryPrice;
  let trailingStop: number | null = null;
  let maxProfitPct = -Infinity;
  let maxLossPct = Infinity;
  let hitTakeProfit1 = false;
  let hitTakeProfit2 = false;
  let exitPrice: number | null = null;
  let exitDate: string | null = null;
  let exitReason: string | null = null;
  let daysHeld = 0;

  for (const bar of usedBars) {
    daysHeld += 1;
    const high = Number(bar.high);
    const low = Number(bar.low);

    maxProfitPct = Math.max(
      maxProfitPct,
      (high / entryPrice - 1) * 100
    );
    maxLossPct = Math.min(
      maxLossPct,
      (low / entryPrice - 1) * 100
    );

    const activeStop =
      trailingStop === null
        ? plan.stopPrice
        : Math.max(plan.stopPrice, trailingStop);

    // 日K无法知道盘中先后顺序，因此同日同时碰上下边界时按止损优先。
    if (low <= activeStop) {
      exitPrice = activeStop;
      exitDate = String(bar.trade_date).slice(0, 10);
      exitReason =
        trailingStop !== null && activeStop === trailingStop
          ? '移动止盈'
          : '止损';
      break;
    }

    if (high >= plan.takeProfit1) hitTakeProfit1 = true;

    if (high >= plan.takeProfit2) {
      hitTakeProfit2 = true;
      exitPrice = plan.takeProfit2;
      exitDate = String(bar.trade_date).slice(0, 10);
      exitReason = '第二止盈';
      break;
    }

    runningHigh = Math.max(runningHigh, high);

    if (
      runningHigh >=
      entryPrice * (1 + plan.trailingStartPct / 100)
    ) {
      trailingStop =
        runningHigh * (1 - plan.trailingDrawdownPct / 100);
    }
  }

  if (exitPrice === null && usedBars.length >= holdDays) {
    const last = usedBars.at(-1)!;
    exitPrice = Number(last.close);
    exitDate = String(last.trade_date).slice(0, 10);
    exitReason = '时间退出';
  }

  const status =
    exitPrice !== null
      ? 'done'
      : usedBars.length > 0
        ? 'holding'
        : 'waiting';

  return {
    status,
    entryPrice: round(entryPrice),
    exitDate,
    exitPrice: round(exitPrice),
    exitReason,
    returnPct:
      exitPrice === null
        ? null
        : round((exitPrice / entryPrice - 1) * 100),
    maxProfitPct:
      maxProfitPct === -Infinity ? null : round(maxProfitPct),
    maxLossPct:
      maxLossPct === Infinity ? null : round(maxLossPct),
    ...nextBase,
    hitTakeProfit1,
    hitTakeProfit2,
    daysHeld
  };
}

export async function reviewPending() {
  const dateResult = await getTradeDates(10);
  const latestDate = dateResult.data.at(-1);

  if (!latestDate) {
    return { reviewedRuns: 0, reviewedStocks: 0 };
  }

  const runs = await all<any>(
    `SELECT *
     FROM select_run
     WHERE status = 'success'
       AND trade_date < CAST(? AS DATE)
     ORDER BY trade_date DESC
     LIMIT 30`,
    [latestDate]
  );

  let reviewedRuns = 0;
  let reviewedStocks = 0;

  for (const selectRun of runs) {
    const results = await all<any>(
      `SELECT *
       FROM select_result
       WHERE run_id = ?
       ORDER BY rank`,
      [selectRun.id]
    );

    if (results.length === 0) continue;

    const maxDays = Math.max(
      ...results.map((row) => {
        const plan = JSON.parse(row.plan_json || '{}');
        return Number(plan.timeStopDays || 2);
      }),
      2
    );

    const future = await getFuturePrices(
      results.map((row) => row.code),
      String(selectRun.trade_date).slice(0, 10),
      Math.min(maxDays, 10)
    );

    const byCode = new Map<string, DailyBar[]>();
    for (const row of future.data as DailyBar[]) {
      const list = byCode.get(row.code) || [];
      list.push(row);
      byCode.set(row.code, list);
    }

    for (const row of results) {
      const plan = JSON.parse(row.plan_json || '{}') as Plan;
      const simulation = simulatePlan(
        Number(row.close),
        plan,
        byCode.get(row.code) || []
      );

      await run(
        `INSERT OR REPLACE INTO select_review (
          run_id, code, is_main, select_date, next_trade_date,
          status, entry_price, exit_date, exit_price, exit_reason,
          return_pct, max_profit_pct, max_loss_pct,
          next_open, next_high, next_low, next_close,
          next_close_return_pct, hit_take_profit1, hit_take_profit2,
          days_held, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
        [
          selectRun.id,
          row.code,
          Boolean(row.is_main),
          String(selectRun.trade_date).slice(0, 10),
          simulation.nextTradeDate,
          simulation.status,
          simulation.entryPrice,
          simulation.exitDate,
          simulation.exitPrice,
          simulation.exitReason,
          simulation.returnPct,
          simulation.maxProfitPct,
          simulation.maxLossPct,
          simulation.nextOpen,
          simulation.nextHigh,
          simulation.nextLow,
          simulation.nextClose,
          simulation.nextCloseReturnPct,
          simulation.hitTakeProfit1,
          simulation.hitTakeProfit2,
          simulation.daysHeld
        ]
      );

      reviewedStocks += 1;
    }

    reviewedRuns += 1;
  }

  return {
    latestDate,
    reviewedRuns,
    reviewedStocks
  };
}

function maxDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;

  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, (equity / peak - 1) * 100);
  }

  return round(drawdown, 2) || 0;
}

export async function getReviewSummary(mainOnly = true) {
  const where = mainOnly ? 'AND r.is_main = true' : '';

  const rows = await all<any>(
    `SELECT
       r.*,
       s.name,
       s.setup,
       s.rank
     FROM select_review r
     JOIN select_result s
       ON s.run_id = r.run_id
      AND s.code = r.code
     WHERE 1 = 1
       ${where}
     ORDER BY r.select_date, s.rank`
  );

  const reviewed = rows.filter(
    (row) => row.status !== 'waiting'
  );
  const entered = rows.filter(
    (row) => row.entry_price !== null
  );
  const done = entered.filter(
    (row) => row.status === 'done' && row.return_pct !== null
  );
  const winners = done.filter(
    (row) => Number(row.return_pct) > 0
  );
  const losers = done.filter(
    (row) => Number(row.return_pct) < 0
  );

  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

  const avgReturn = average(
    done.map((row) => Number(row.return_pct))
  );
  const avgWin = average(
    winners.map((row) => Number(row.return_pct))
  );
  const avgLoss = average(
    losers.map((row) => Number(row.return_pct))
  );

  const nextReturns = reviewed
    .map((row) => Number(row.next_close_return_pct))
    .filter(Number.isFinite);

  const setupMap = new Map<string, number[]>();
  for (const row of done) {
    const list = setupMap.get(row.setup) || [];
    list.push(Number(row.return_pct));
    setupMap.set(row.setup, list);
  }

  const bySetup = [...setupMap.entries()]
    .map(([setup, values]) => ({
      setup,
      trades: values.length,
      winRate: round(
        (values.filter((value) => value > 0).length / values.length) * 100,
        2
      ),
      avgReturn: round(average(values), 3)
    }))
    .sort((a, b) => (b.avgReturn || 0) - (a.avgReturn || 0));

  return {
    mainOnly,
    reviewed: reviewed.length,
    entered: entered.length,
    completed: done.length,
    entryRate: round(
      reviewed.length ? (entered.length / reviewed.length) * 100 : 0,
      2
    ),
    winRate: round(
      done.length ? (winners.length / done.length) * 100 : 0,
      2
    ),
    avgReturn: round(avgReturn, 3),
    avgWin: round(avgWin, 3),
    avgLoss: round(avgLoss, 3),
    profitLossRatio:
      avgLoss < 0 ? round(avgWin / Math.abs(avgLoss), 3) : null,
    maxDrawdown: maxDrawdown(
      done.map((row) => Number(row.return_pct))
    ),
    avgNextCloseReturn: round(average(nextReturns), 3),
    takeProfit1Rate: round(
      entered.length
        ? (entered.filter((row) => row.hit_take_profit1).length /
            entered.length) *
            100
        : 0,
      2
    ),
    bySetup
  };
}

export async function getLatestReviews(limit = 50) {
  return all<any>(
    `SELECT
       r.*,
       s.name,
       s.setup,
       s.rank,
       s.score
     FROM select_review r
     JOIN select_result s
       ON s.run_id = r.run_id
      AND s.code = r.code
     ORDER BY r.select_date DESC, s.rank
     LIMIT ?`,
    [limit]
  );
}
