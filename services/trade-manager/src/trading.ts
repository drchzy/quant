import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { all, one, run } from './database.js';
import { getLiveStock } from './market-data.js';
import {
  getLatestSelection,
  getSelectionContext
} from './stock-select.js';
import {
  getMarketClock,
  isLateSession,
  localMarketTime
} from './time.js';
import type {
  LiveStock,
  TradePlanRule,
  TradeSignal,
  TradeState
} from './types.js';

function number(value: unknown, defaultValue = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : defaultValue;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function dateText(value: unknown): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function parsePlan(row: any): TradePlanRule {
  return JSON.parse(row.plan_json || '{}') as TradePlanRule;
}

async function addEvent(
  row: any,
  eventType: string,
  fromState: string | null,
  toState: string | null,
  signal: string | null,
  price: number | null,
  message: string,
  marketTime: string | null
) {
  await run(
    `INSERT INTO trade_event (
      id, plan_id, code, event_type,
      from_state, to_state, signal, price,
      message, market_time, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
    [
      randomUUID(),
      row.id,
      row.code,
      eventType,
      fromState,
      toState,
      signal,
      price,
      message,
      marketTime
    ]
  );
}

async function saveSignal(
  row: any,
  values: {
    state: TradeState;
    signal: TradeSignal;
    reason: string;
    live: LiveStock;
    highestPrice?: number | null;
    trailingStop?: number | null;
    holdDays?: number;
  }
) {
  const changed =
    row.state !== values.state ||
    row.signal !== values.signal ||
    row.signal_reason !== values.reason;

  await run(
    `UPDATE trade_plan SET
      state = ?,
      signal = ?,
      signal_reason = ?,
      current_price = ?,
      day_high = ?,
      day_low = ?,
      pct = ?,
      avg_price = ?,
      last_market_time = ?,
      last_seen_date = CAST(? AS DATE),
      highest_price = ?,
      trailing_stop = ?,
      hold_days = ?,
      updated_at = current_timestamp
     WHERE id = ?`,
    [
      values.state,
      values.signal,
      values.reason,
      values.live.price,
      values.live.high,
      values.live.low,
      values.live.pct,
      values.live.avgPrice,
      values.live.marketTime,
      values.live.marketDate,
      values.highestPrice ?? nullableNumber(row.highest_price),
      values.trailingStop ?? nullableNumber(row.trailing_stop),
      values.holdDays ?? number(row.hold_days),
      row.id
    ]
  );

  if (changed) {
    await addEvent(
      row,
      'signal',
      row.state,
      values.state,
      values.signal,
      values.live.price,
      values.reason,
      values.live.marketTime
    );
  }
}

/**
 * 把 stock-select 最新重点候选同步成本地执行计划。
 * 已存在的计划不会覆盖，避免盘中手工确认后的状态被重置。
 */
export async function syncLatestPlans() {
  const latest = await getLatestSelection(config.monitorTopCount);

  if (!latest.run) {
    return { runId: null, added: 0 };
  }

  let added = 0;

  for (const item of latest.data) {
    const id = `${latest.run.id}:${item.code}`;
    const exists = await one<{ id: string }>(
      'SELECT id FROM trade_plan WHERE id = ?',
      [id]
    );

    if (exists) continue;

    await run(
      `INSERT INTO trade_plan (
        id, source, run_id, select_date,
        code, name, rank, setup, score, plan_json,
        state, signal, signal_reason,
        current_price, day_high, day_low, pct, avg_price,
        last_market_time, last_seen_date,
        entry_date, entry_time, entry_price, quantity,
        highest_price, trailing_stop, hold_days,
        exit_date, exit_time, exit_price, exit_reason, return_pct,
        created_at, updated_at
      ) VALUES (
        ?, 'select', ?, CAST(? AS DATE),
        ?, ?, ?, ?, ?, ?,
        'waiting', 'WAIT_NEXT_DAY', '等待下一个交易日',
        NULL, NULL, NULL, NULL, NULL,
        NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, NULL, 0,
        NULL, NULL, NULL, NULL, NULL,
        current_timestamp, current_timestamp
      )`,
      [
        id,
        latest.run.id,
        dateText(latest.run.trade_date),
        item.code,
        item.name,
        item.rank,
        item.setup,
        item.score,
        JSON.stringify(item.plan)
      ]
    );

    const row = await one<any>(
      'SELECT * FROM trade_plan WHERE id = ?',
      [id]
    );

    if (row) {
      await addEvent(
        row,
        'plan_created',
        null,
        'waiting',
        'WAIT_NEXT_DAY',
        null,
        `导入选股计划 #${item.rank} ${item.name}`,
        null
      );
    }

    added += 1;
  }

  return {
    runId: latest.run.id,
    selectDate: dateText(latest.run.trade_date),
    added
  };
}

function pointsAfterEntry(live: LiveStock, entryTime: string | null) {
  if (!entryTime) return live.intraday;
  return live.intraday.filter(
    (item) => String(item.datetime) >= entryTime.slice(0, 16)
  );
}

async function evaluatePlan(row: any, live: LiveStock) {
  const marketDate = live.marketDate;
  if (!marketDate) return;

  const selectDate = dateText(row.select_date);
  const entryDate = dateText(row.entry_date);
  const plan = parsePlan(row);

  if (!row.entry_price) {
    if (selectDate && marketDate <= selectDate) {
      await saveSignal(row, {
        state: 'waiting',
        signal: 'WAIT_NEXT_DAY',
        reason: '当前仍是选股日，计划从下一个交易日生效',
        live
      });
      return;
    }

    if (live.price <= number(plan.stopPrice)) {
      await saveSignal(row, {
        state: 'invalid',
        signal: 'INVALID',
        reason: `未买入前已跌破计划止损价 ${plan.stopPrice}，候选失效`,
        live
      });
      return;
    }

    if (live.price > number(plan.noChasePrice)) {
      await saveSignal(row, {
        state: 'no_chase',
        signal: 'NO_CHASE',
        reason: `现价高于不追价 ${plan.noChasePrice}，不追高`,
        live
      });
      return;
    }

    if (
      live.price >= number(plan.entryLow) &&
      live.price <= number(plan.entryHigh)
    ) {
      await saveSignal(row, {
        state: 'buy_ready',
        signal: 'BUY',
        reason: `现价进入计划买入区 ${plan.entryLow} - ${plan.entryHigh}`,
        live
      });
      return;
    }

    if (live.price < number(plan.entryLow)) {
      await saveSignal(row, {
        state: 'waiting',
        signal: 'WAIT',
        reason: `现价低于买入区下沿 ${plan.entryLow}，等待重新转强进入计划区`,
        live
      });
      return;
    }

    await saveSignal(row, {
      state: 'waiting',
      signal: 'WAIT_PULLBACK',
      reason: `现价高于买入区上沿 ${plan.entryHigh}，但尚未超过不追价，等待回落`,
      live
    });
    return;
  }

  const entryPrice = number(row.entry_price);
  let holdDays = Math.max(number(row.hold_days), 1);

  if (entryDate && dateText(row.last_seen_date) !== marketDate) {
    holdDays += 1;
  }

  const afterEntry = pointsAfterEntry(live, row.entry_time);
  const postHigh = afterEntry.length
    ? Math.max(...afterEntry.map((item) => number(item.price)))
    : live.price;
  const postLow = afterEntry.length
    ? Math.min(...afterEntry.map((item) => number(item.price)))
    : live.price;

  const highest = Math.max(
    number(row.highest_price, entryPrice),
    postHigh,
    live.price
  );

  const trailingStarted =
    highest >=
    entryPrice *
      (1 + number(plan.trailingStartPct, config.defaultTrailingStartPct) / 100);

  const trailingStop = trailingStarted
    ? highest *
      (1 -
        number(
          plan.trailingDrawdownPct,
          config.defaultTrailingDrawdownPct
        ) /
          100)
    : null;

  const hardStop = number(
    plan.stopPrice,
    entryPrice * (1 - config.defaultStopPct / 100)
  );
  const effectiveStop =
    trailingStop === null
      ? hardStop
      : Math.max(hardStop, trailingStop);

  const stopTouched = postLow <= effectiveStop;
  const target2Touched =
    postHigh >= number(plan.takeProfit2, entryPrice * 1.06);
  const target1Touched =
    postHigh >= number(plan.takeProfit1, entryPrice * 1.04);

  // A股普通股票T+1：买入当天即使触发止损/止盈，也只能提示风险，不能给出可执行卖出状态。
  const canSell = !!entryDate && marketDate > entryDate;

  if (!canSell && (stopTouched || target2Touched)) {
    await saveSignal(row, {
      state: 't1_locked',
      signal: 'T1_LOCKED_RISK',
      reason: stopTouched
        ? `买入当日触及保护价 ${round(effectiveStop)}，但受T+1限制无法卖出`
        : `买入当日触及第二止盈 ${plan.takeProfit2}，但受T+1限制无法卖出`,
      live,
      highestPrice: highest,
      trailingStop,
      holdDays
    });
    return;
  }

  if (canSell && stopTouched) {
    const trailingExit =
      trailingStop !== null && effectiveStop === trailingStop;

    await saveSignal(row, {
      state: 'sell_ready',
      signal: trailingExit ? 'TRAILING_STOP' : 'STOP_LOSS',
      reason: trailingExit
        ? `价格触及移动保护价 ${round(effectiveStop)}，执行保护利润`
        : `价格触及止损价 ${round(effectiveStop)}，执行止损`,
      live,
      highestPrice: highest,
      trailingStop,
      holdDays
    });
    return;
  }

  if (canSell && target2Touched) {
    await saveSignal(row, {
      state: 'sell_ready',
      signal: 'TAKE_PROFIT_2',
      reason: `价格触及第二止盈 ${plan.takeProfit2}，可以按计划落袋`,
      live,
      highestPrice: highest,
      trailingStop,
      holdDays
    });
    return;
  }

  if (
    canSell &&
    holdDays >= number(plan.timeStopDays, config.defaultTimeStopDays) &&
    isLateSession()
  ) {
    await saveSignal(row, {
      state: 'sell_ready',
      signal: 'TIME_EXIT',
      reason: `已持有 ${holdDays} 个交易日，进入时间止损窗口`,
      live,
      highestPrice: highest,
      trailingStop,
      holdDays
    });
    return;
  }

  if (target1Touched) {
    await saveSignal(row, {
      state: trailingStarted ? 'trailing' : 'holding',
      signal: 'TAKE_PROFIT_1',
      reason: `已触及第一止盈 ${plan.takeProfit1}，可考虑锁定部分利润`,
      live,
      highestPrice: highest,
      trailingStop,
      holdDays
    });
    return;
  }

  if (trailingStarted) {
    await saveSignal(row, {
      state: 'trailing',
      signal: 'TRAILING_ACTIVE',
      reason: `移动止盈已启动，当前保护价约 ${round(effectiveStop)}`,
      live,
      highestPrice: highest,
      trailingStop,
      holdDays
    });
    return;
  }

  await saveSignal(row, {
    state: 'holding',
    signal: 'HOLD',
    reason: '持仓仍在计划范围内，继续观察',
    live,
    highestPrice: highest,
    trailingStop,
    holdDays
  });
}

/**
 * 刷新所有仍需要盘中跟踪的计划和持仓。
 * 每只股票只在本地调用 market-data，由 market-data 再访问东财。
 */
export async function refreshTrading() {
  await syncLatestPlans();

  const rows = await all<any>(
    `SELECT *
     FROM trade_plan
     WHERE state NOT IN ('closed', 'expired', 'invalid')
     ORDER BY
       CASE WHEN entry_price IS NOT NULL THEN 0 ELSE 1 END,
       rank NULLS LAST,
       created_at`
  );

  const codes = [...new Set(rows.map((row) => String(row.code)))];
  const liveResults = await Promise.allSettled(
    codes.map(async (code) => [code, await getLiveStock(code)] as const)
  );

  const liveMap = new Map<string, LiveStock>();
  for (const result of liveResults) {
    if (result.status === 'fulfilled') {
      liveMap.set(result.value[0], result.value[1]);
    }
  }

  const today = getMarketClock().date;
  let updated = 0;
  let stale = 0;

  for (const row of rows) {
    const live = liveMap.get(row.code);

    // 节假日、停牌或东财仍返回上一交易日分时时，不改变执行状态。
    if (!live || live.marketDate !== today) {
      stale += 1;
      continue;
    }

    await evaluatePlan(row, live);
    updated += 1;
  }

  return {
    date: today,
    total: rows.length,
    updated,
    stale
  };
}

/**
 * 收盘后把当天真实看过行情、但始终没有确认买入的候选标记为过期。
 * 节假日因为 last_seen_date 不会更新，不会误过期。
 */
export async function expireTodayPlans() {
  const today = getMarketClock().date;

  const rows = await all<any>(
    `SELECT *
     FROM trade_plan
     WHERE entry_price IS NULL
       AND state NOT IN ('closed', 'expired', 'invalid')
       AND last_seen_date = CAST(? AS DATE)`,
    [today]
  );

  for (const row of rows) {
    await run(
      `UPDATE trade_plan SET
        state = 'expired',
        signal = 'EXPIRED',
        signal_reason = '当日未确认买入，计划已过期',
        updated_at = current_timestamp
       WHERE id = ?`,
      [row.id]
    );

    await addEvent(
      row,
      'expired',
      row.state,
      'expired',
      'EXPIRED',
      nullableNumber(row.current_price),
      '当日未确认买入，计划已过期',
      row.last_market_time
    );
  }

  return { date: today, expired: rows.length };
}

export async function confirmBuy(
  id: string,
  price?: number,
  quantity?: number
) {
  const row = await one<any>(
    'SELECT * FROM trade_plan WHERE id = ?',
    [id]
  );

  if (!row) throw new Error('交易计划不存在');
  if (row.entry_price) throw new Error('该计划已经确认买入');
  if (['closed', 'expired', 'invalid'].includes(row.state)) {
    throw new Error('当前计划状态不能确认买入');
  }

  const livePrice = nullableNumber(row.current_price);
  const entryPrice = number(price, livePrice || 0);

  if (!(entryPrice > 0)) {
    throw new Error('买入价格必须大于0');
  }

  const marketTime = row.last_market_time || localMarketTime();
  const entryDate = String(marketTime).slice(0, 10);

  await run(
    `UPDATE trade_plan SET
      state = 'holding',
      signal = 'HOLD',
      signal_reason = '已手工确认买入，开始持仓监控',
      entry_date = CAST(? AS DATE),
      entry_time = ?,
      entry_price = ?,
      quantity = ?,
      highest_price = ?,
      trailing_stop = NULL,
      hold_days = 1,
      updated_at = current_timestamp
     WHERE id = ?`,
    [
      entryDate,
      marketTime,
      entryPrice,
      quantity && quantity > 0 ? Math.floor(quantity) : null,
      entryPrice,
      id
    ]
  );

  await addEvent(
    row,
    'buy_confirmed',
    row.state,
    'holding',
    'HOLD',
    entryPrice,
    '手工确认买入；A股T+1，当日不可卖出',
    marketTime
  );

  return getPlan(id);
}

export async function confirmSell(
  id: string,
  price?: number,
  reason?: string
) {
  const row = await one<any>(
    'SELECT * FROM trade_plan WHERE id = ?',
    [id]
  );

  if (!row) throw new Error('交易计划不存在');
  if (!row.entry_price) throw new Error('该计划尚未确认买入');
  if (row.state === 'closed') throw new Error('该持仓已经关闭');

  const currentDate = getMarketClock().date;
  const entryDate = dateText(row.entry_date);

  if (entryDate && currentDate <= entryDate) {
    throw new Error('A股T+1：买入当日不能确认卖出');
  }

  const livePrice = nullableNumber(row.current_price);
  const exitPrice = number(price, livePrice || 0);

  if (!(exitPrice > 0)) {
    throw new Error('卖出价格必须大于0');
  }

  const exitTime = row.last_market_time || localMarketTime();
  const returnPct =
    (exitPrice / number(row.entry_price) - 1) * 100;
  const exitReason = reason || row.signal_reason || '手工确认卖出';

  await run(
    `UPDATE trade_plan SET
      state = 'closed',
      signal = 'CLOSED',
      signal_reason = ?,
      exit_date = CAST(? AS DATE),
      exit_time = ?,
      exit_price = ?,
      exit_reason = ?,
      return_pct = ?,
      updated_at = current_timestamp
     WHERE id = ?`,
    [
      exitReason,
      String(exitTime).slice(0, 10),
      exitTime,
      exitPrice,
      exitReason,
      round(returnPct, 3),
      id
    ]
  );

  await addEvent(
    row,
    'sell_confirmed',
    row.state,
    'closed',
    'CLOSED',
    exitPrice,
    exitReason,
    exitTime
  );

  return getPlan(id);
}

function manualPlan(entryPrice: number, input: any): TradePlanRule {
  const stopPrice =
    number(input.stopPrice) ||
    entryPrice * (1 - config.defaultStopPct / 100);

  return {
    entryLow: entryPrice,
    entryHigh: entryPrice,
    noChasePrice: entryPrice,
    stopPrice: round(stopPrice),
    takeProfit1: round(
      number(input.takeProfit1) ||
        entryPrice *
          (1 + config.defaultTakeProfit1Pct / 100)
    ),
    takeProfit2: round(
      number(input.takeProfit2) ||
        entryPrice *
          (1 + config.defaultTakeProfit2Pct / 100)
    ),
    trailingStartPct: number(
      input.trailingStartPct,
      config.defaultTrailingStartPct
    ),
    trailingDrawdownPct: number(
      input.trailingDrawdownPct,
      config.defaultTrailingDrawdownPct
    ),
    timeStopDays: Math.max(
      number(input.timeStopDays, config.defaultTimeStopDays),
      1
    )
  };
}

/**
 * 支持把已有持仓直接录入监控，例如系统启用前已经买入的股票。
 */
export async function addManualPosition(input: {
  code: string;
  name?: string;
  entryDate?: string;
  entryPrice: number;
  quantity?: number;
  stopPrice?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  trailingStartPct?: number;
  trailingDrawdownPct?: number;
  timeStopDays?: number;
}) {
  if (!/^\d{6}$/.test(input.code)) {
    throw new Error('股票代码必须是6位数字');
  }

  if (!(Number(input.entryPrice) > 0)) {
    throw new Error('成本价必须大于0');
  }

  let live: LiveStock | null = null;
  try {
    live = await getLiveStock(input.code);
  } catch {
    // 行情不可用时仍允许录入已有持仓，盘中恢复后会继续监控。
  }

  const id = `manual:${randomUUID()}`;
  const entryDate =
    input.entryDate || getMarketClock().date;
  const plan = manualPlan(Number(input.entryPrice), input);
  const name = input.name || live?.name || input.code;

  await run(
    `INSERT INTO trade_plan (
      id, source, run_id, select_date,
      code, name, rank, setup, score, plan_json,
      state, signal, signal_reason,
      current_price, day_high, day_low, pct, avg_price,
      last_market_time, last_seen_date,
      entry_date, entry_time, entry_price, quantity,
      highest_price, trailing_stop, hold_days,
      exit_date, exit_time, exit_price, exit_reason, return_pct,
      created_at, updated_at
    ) VALUES (
      ?, 'manual', NULL, NULL,
      ?, ?, NULL, '手工持仓', NULL, ?,
      'holding', 'HOLD', '手工录入已有持仓',
      ?, ?, ?, ?, ?,
      ?, ?,
      CAST(? AS DATE), ?, ?, ?,
      ?, NULL, 1,
      NULL, NULL, NULL, NULL, NULL,
      current_timestamp, current_timestamp
    )`,
    [
      id,
      input.code,
      name,
      JSON.stringify(plan),
      live?.price || null,
      live?.high || null,
      live?.low || null,
      live?.pct || null,
      live?.avgPrice || null,
      live?.marketTime || null,
      live?.marketDate || null,
      entryDate,
      `${entryDate} 09:30`,
      Number(input.entryPrice),
      input.quantity && input.quantity > 0
        ? Math.floor(input.quantity)
        : null,
      Math.max(Number(input.entryPrice), live?.price || 0)
    ]
  );

  const row = await one<any>(
    'SELECT * FROM trade_plan WHERE id = ?',
    [id]
  );

  if (row) {
    await addEvent(
      row,
      'manual_position',
      null,
      'holding',
      'HOLD',
      Number(input.entryPrice),
      '手工录入已有持仓',
      row.entry_time
    );
  }

  return getPlan(id);
}

export async function getPlan(id: string) {
  const row = await one<any>(
    'SELECT * FROM trade_plan WHERE id = ?',
    [id]
  );

  if (!row) return null;

  return {
    ...row,
    plan: parsePlan(row)
  };
}

export async function getTradingOverview() {
  await syncLatestPlans();

  const rows = await all<any>(
    `SELECT *
     FROM trade_plan
     WHERE state <> 'closed'
     ORDER BY
       CASE
         WHEN state = 'sell_ready' THEN 0
         WHEN state = 't1_locked' THEN 1
         WHEN entry_price IS NOT NULL THEN 2
         WHEN state = 'buy_ready' THEN 3
         ELSE 4
       END,
       rank NULLS LAST,
       created_at DESC`
  );

  const data = rows.map((row) => ({
    ...row,
    plan: parsePlan(row)
  }));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      total: data.length,
      buyReady: data.filter((row) => row.state === 'buy_ready').length,
      holding: data.filter((row) =>
        ['holding', 'trailing', 't1_locked', 'sell_ready'].includes(
          row.state
        )
      ).length,
      sellReady: data.filter((row) => row.state === 'sell_ready').length,
      t1Locked: data.filter((row) => row.state === 't1_locked').length
    },
    actionable: data.filter((row) =>
      ['buy_ready', 'sell_ready', 't1_locked'].includes(row.state)
    ),
    plans: data
  };
}

export async function getClosedTrades(limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  const rows = await all<any>(
    `SELECT *
     FROM trade_plan
     WHERE state = 'closed'
     ORDER BY exit_date DESC, updated_at DESC
     LIMIT ?`,
    [safeLimit]
  );

  return rows.map((row) => ({
    ...row,
    plan: parsePlan(row)
  }));
}

export async function getEvents(limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  return all<any>(
    `SELECT *
     FROM trade_event
     ORDER BY created_at DESC
     LIMIT ?`,
    [safeLimit]
  );
}

export async function getTradingAi() {
  const [trading, selection, events] = await Promise.all([
    getTradingOverview(),
    getSelectionContext(),
    getEvents(30)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    note: 'trade-manager只提供执行状态与风险提示，不自动下单',
    trading,
    selection,
    recentEvents: events
  };
}
