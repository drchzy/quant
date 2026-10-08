export type SectorType = 'industry' | 'concept';

export interface MarketStock {
  code: string;
  name: string;
  market: number;
  price: number;
  pct: number;
  change: number;
  volume: number;
  amount: number;
  amplitude: number;
  turnover: number;
  pe: number | null;
  volumeRatio: number | null;
  high: number;
  low: number;
  open: number;
  preClose: number;
  totalMarketCap: number;
  floatMarketCap: number;
  pb: number | null;
}

export interface SectorRow {
  type: SectorType;
  code: string;
  name: string;
  price: number;
  pct: number;
  mainInflow: number;
  upCount: number;
  downCount: number;
  leadStock: string;
}

export interface MainIndex {
  code: string;
  name: string;
  secid: string;
}
