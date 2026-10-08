export interface TechnicalStock {
  code: string;
  name: string;
  marketName: string;
  tradeDate: string;
  open: number;
  close: number;
  high: number;
  low: number;
  preClose: number;
  pct: number;
  amount: number;
  volume: number;
  turnover: number | null;
  volumeRatio: number | null;
  pe: number | null;
  pb: number | null;
  marketCap: number;
  floatMarketCap: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma5Prev: number | null;
  ma10Prev: number | null;
  return5: number | null;
  return20: number | null;
  previousHigh20: number | null;
  previousLow20: number | null;
  volumeRate5: number | null;
  avgAmount5: number | null;
  closeStrength: number | null;
  closeToMa5: number | null;
  highToClose: number | null;
  previousPct: number | null;
  previousOpen: number | null;
  previousClose: number | null;
  historyDays: number;
}

export type Setup =
  | '缩量回踩'
  | '放量突破'
  | '强势后首次回踩'
  | '趋势延续';

export interface TradePlan {
  entryLow: number;
  entryHigh: number;
  noChasePrice: number;
  stopPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStartPct: number;
  trailingDrawdownPct: number;
  maxPositionPct: number;
  timeStopDays: number;
  rules: string[];
}

export interface SelectResult {
  rank: number;
  isMain: boolean;
  code: string;
  name: string;
  setup: Setup;
  score: number;
  close: number;
  pct: number;
  amount: number;
  turnover: number | null;
  marketCap: number;
  ma5: number;
  ma10: number;
  ma20: number;
  volumeRate5: number | null;
  return5: number | null;
  return20: number | null;
  previousHigh20: number | null;
  closeStrength: number | null;
  reasons: string[];
  plan: TradePlan;
}
