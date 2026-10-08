export type TradeState =
  | 'waiting'
  | 'buy_ready'
  | 'no_chase'
  | 'invalid'
  | 'holding'
  | 'trailing'
  | 't1_locked'
  | 'sell_ready'
  | 'closed'
  | 'expired';

export type TradeSignal =
  | 'WAIT_NEXT_DAY'
  | 'WAIT'
  | 'WAIT_PULLBACK'
  | 'BUY'
  | 'NO_CHASE'
  | 'INVALID'
  | 'HOLD'
  | 'TAKE_PROFIT_1'
  | 'TAKE_PROFIT_2'
  | 'TRAILING_ACTIVE'
  | 'TRAILING_STOP'
  | 'STOP_LOSS'
  | 'TIME_EXIT'
  | 'T1_LOCKED_RISK'
  | 'CLOSED'
  | 'EXPIRED';

export interface TradePlanRule {
  entryLow: number;
  entryHigh: number;
  noChasePrice: number;
  stopPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStartPct: number;
  trailingDrawdownPct: number;
  maxPositionPct?: number;
  timeStopDays: number;
  rules?: string[];
}

export interface SelectionItem {
  rank: number;
  isMain: boolean;
  code: string;
  name: string;
  setup: string;
  score: number;
  close: number;
  plan: TradePlanRule;
}

export interface LiveStock {
  code: string;
  name: string;
  price: number;
  high: number;
  low: number;
  open: number;
  preClose: number;
  pct: number;
  avgPrice: number | null;
  marketTime: string | null;
  marketDate: string | null;
  intraday: Array<{
    datetime: string;
    price: number;
    avgPrice: number;
    volume: number;
    amount: number;
    pct: number;
  }>;
}
