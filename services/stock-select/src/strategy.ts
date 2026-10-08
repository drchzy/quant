import { config } from './config.js';
import type {
  SelectResult,
  Setup,
  TechnicalStock,
  TradePlan
} from './types.js';

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function isSt(name: string): boolean {
  return /ST|退/i.test(name);
}

function isStar(code: string): boolean {
  return code.startsWith('688') || code.startsWith('689');
}

function isBse(stock: TechnicalStock): boolean {
  return (
    stock.marketName === '北京' ||
    /^(4|8|92)/.test(stock.code)
  );
}

function hasNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * 第一层硬过滤。
 * 只保留流动性足够、趋势完整、没有明显追高风险的股票。
 */
function passFilter(stock: TechnicalStock): boolean {
  if (config.excludeSt && isSt(stock.name)) return false;
  if (config.excludeStar && isStar(stock.code)) return false;
  if (config.excludeBse && isBse(stock)) return false;

  if (stock.historyDays < 20) return false;
  if (stock.close < config.minPrice) return false;
  if (stock.amount < config.minAmount) return false;

  if (
    stock.marketCap > 0 &&
    (stock.marketCap < config.minMarketCap ||
      stock.marketCap > config.maxMarketCap)
  ) {
    return false;
  }

  if (stock.pct < config.minPct || stock.pct > config.maxPct) {
    return false;
  }

  if (
    stock.turnover !== null &&
    (stock.turnover < config.minTurnover ||
      stock.turnover > config.maxTurnover)
  ) {
    return false;
  }

  if (
    !hasNumber(stock.ma5) ||
    !hasNumber(stock.ma10) ||
    !hasNumber(stock.ma20) ||
    !hasNumber(stock.ma5Prev) ||
    !hasNumber(stock.ma10Prev)
  ) {
    return false;
  }

  // 核心趋势：5/10/20 日均线多头，同时短中期均线继续向上。
  if (!(stock.close > stock.ma5 && stock.ma5 > stock.ma10 && stock.ma10 > stock.ma20)) {
    return false;
  }

  if (!(stock.ma5 > stock.ma5Prev && stock.ma10 >= stock.ma10Prev)) {
    return false;
  }

  return true;
}

function detectSetup(stock: TechnicalStock): {
  setup: Setup;
  bonus: number;
  reasons: string[];
} {
  const reasons: string[] = [];

  const closeToMa5 = stock.closeToMa5 ?? 99;
  const volumeRate = stock.volumeRate5 ?? 1;
  const closeStrength = stock.closeStrength ?? 0.5;

  const shrinkPullback =
    closeToMa5 >= -0.8 &&
    closeToMa5 <= 2.0 &&
    volumeRate > 0 &&
    volumeRate <= 0.95;

  if (shrinkPullback) {
    reasons.push(
      `价格贴近MA5（${round(closeToMa5)}%），成交量约为近5日均量的${round(volumeRate, 2)}倍`
    );
    return {
      setup: '缩量回踩',
      bonus: 28,
      reasons
    };
  }

  const breakout =
    hasNumber(stock.previousHigh20) &&
    stock.close >= stock.previousHigh20 * 0.985 &&
    volumeRate >= 1.2 &&
    closeStrength >= 0.6;

  if (breakout) {
    reasons.push(
      `接近/突破前20日高点 ${round(stock.previousHigh20!)}，量能放大到${round(volumeRate, 2)}倍`
    );
    return {
      setup: '放量突破',
      bonus: 30,
      reasons
    };
  }

  const firstPullback =
    hasNumber(stock.previousPct) &&
    stock.previousPct >= 8 &&
    stock.pct >= -4 &&
    stock.pct <= 2.5 &&
    stock.close >= stock.ma5! * 0.98;

  if (firstPullback) {
    reasons.push(
      `前一交易日上涨 ${round(stock.previousPct!)}%，今天首次回踩但仍守住短期趋势`
    );
    return {
      setup: '强势后首次回踩',
      bonus: 24,
      reasons
    };
  }

  reasons.push('MA5、MA10、MA20多头排列，趋势仍在延续');
  return {
    setup: '趋势延续',
    bonus: 12,
    reasons
  };
}

function scoreStock(stock: TechnicalStock) {
  const detected = detectSetup(stock);
  const reasons = [...detected.reasons];
  let score = 34 + detected.bonus;

  const closeToMa5 = stock.closeToMa5 ?? 99;
  if (closeToMa5 >= 0 && closeToMa5 <= 2.5) {
    score += 10;
    reasons.push('收盘位置离MA5不远，次日追高风险相对较小');
  } else if (closeToMa5 > 4) {
    score -= 15;
    reasons.push('离MA5偏远，短线乖离偏大');
  }

  if (
    hasNumber(stock.return5) &&
    stock.return5 >= 1 &&
    stock.return5 <= 12
  ) {
    score += 9;
    reasons.push(`近5日涨幅 ${round(stock.return5)}%，趋势强度适中`);
  } else if (hasNumber(stock.return5) && stock.return5 > 18) {
    score -= 10;
  }

  if (
    hasNumber(stock.return20) &&
    stock.return20 >= 2 &&
    stock.return20 <= 25
  ) {
    score += 7;
  } else if (hasNumber(stock.return20) && stock.return20 > 35) {
    score -= 8;
  }

  if (
    stock.turnover !== null &&
    stock.turnover >= 2 &&
    stock.turnover <= 10
  ) {
    score += 5;
    reasons.push(`换手率 ${round(stock.turnover)}%，流动性处于可接受区间`);
  }

  if ((stock.closeStrength ?? 0) >= 0.65) {
    score += 7;
    reasons.push('收盘靠近日内相对高位');
  } else if ((stock.closeStrength ?? 0.5) <= 0.3) {
    score -= 8;
    reasons.push('收盘靠近日内低位');
  }

  if (stock.amount >= 300_000_000) {
    score += 4;
  }

  if (stock.pct >= 5.5) {
    score -= 8;
    reasons.push('当日涨幅已经偏大，次日不适合继续追高');
  }

  if ((stock.highToClose ?? 0) >= 0.65) {
    score -= 8;
    reasons.push('当日冲高回落较明显');
  }

  return {
    setup: detected.setup,
    score: round(score),
    reasons: reasons.slice(0, 6)
  };
}

function buildPlan(stock: TechnicalStock): TradePlan {
  const close = stock.close;
  const ma5 = stock.ma5!;
  const ma10 = stock.ma10!;

  // 入场区偏向MA5附近，最多允许比前一日收盘高约1.5%。
  const entryLow = Math.max(ma5, close * 0.985);
  const entryHigh = close * 1.015;

  // 初始止损同时考虑10日线和最大亏损3%，取更严格的位置。
  const structureStop = ma10 * 0.995;
  const lossStop = close * (1 - config.maxLossPct / 100);
  const stopPrice = Math.min(
    close * 0.995,
    Math.max(structureStop, lossStop)
  );

  const noChasePrice = close * (1 + config.noChasePct / 100);

  return {
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    noChasePrice: round(noChasePrice),
    stopPrice: round(stopPrice),
    takeProfit1: round(
      close * (1 + config.firstTakeProfitPct / 100)
    ),
    takeProfit2: round(
      close * (1 + config.secondTakeProfitPct / 100)
    ),
    trailingStartPct: config.trailingStartPct,
    trailingDrawdownPct: config.trailingDrawdownPct,
    maxPositionPct: config.maxPositionPct,
    timeStopDays: config.timeStopDays,
    rules: [
      `高于 ${round(noChasePrice)} 原则上不追`,
      `跌到 ${round(stopPrice)} 附近且不能快速收回，执行止损/减仓`,
      `浮盈达到 ${config.trailingStartPct}% 后启动移动止盈，高点回撤 ${config.trailingDrawdownPct}% 执行保护利润`,
      `持有 ${config.timeStopDays} 个交易日仍没有按预期走强，执行时间止损`,
      `单只股票仓位原则上不超过 ${config.maxPositionPct}%`
    ]
  };
}

/**
 * 全市场候选筛选。
 *
 * 算法只使用收盘后已经确定的数据，不做“预测明天一定上涨”的判断。
 * 输出的是第二天需要观察和执行计划的候选池。
 */
export function selectStocks(stocks: TechnicalStock[]): SelectResult[] {
  const scored = stocks
    .filter(passFilter)
    .map((stock) => {
      const scored = scoreStock(stock);
      return {
        stock,
        ...scored
      };
    })
    .filter((item) => item.score >= config.minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.stock.amount - a.stock.amount;
    })
    .slice(0, config.topCount);

  return scored.map((item, index) => ({
    rank: index + 1,
    isMain: index < config.mainCount,
    code: item.stock.code,
    name: item.stock.name,
    setup: item.setup,
    score: item.score,
    close: item.stock.close,
    pct: item.stock.pct,
    amount: item.stock.amount,
    turnover: item.stock.turnover,
    marketCap: item.stock.marketCap,
    ma5: item.stock.ma5!,
    ma10: item.stock.ma10!,
    ma20: item.stock.ma20!,
    volumeRate5: item.stock.volumeRate5,
    return5: item.stock.return5,
    return20: item.stock.return20,
    previousHigh20: item.stock.previousHigh20,
    closeStrength: item.stock.closeStrength,
    reasons: item.reasons,
    plan: buildPlan(item.stock)
  }));
}
