import type { KlineInterval } from "./candle";

export type MarketBias = "bull" | "bear" | "neutral";

export type MarketStructure = "uptrend" | "downtrend" | "range" | "unclear";

export interface SwingPoint {
  kind: "high" | "low";
  index: number;
  openTime: number;
  price: number;
}

export interface IntervalIndicators {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  lastClose: number | null;
  openTime: number | null;
  swings: SwingPoint[];
}

export interface IndicatorSeries {
  symbol: string;
  interval: KlineInterval;
  indicators: IntervalIndicators;
}

export interface MultiTfContext {
  bias4h: MarketBias;
  structure1h: MarketStructure;
}

export interface BtcIndicatorsResponse {
  symbol: string;
  updatedAt: number;
  series: IndicatorSeries[];
  context: MultiTfContext;
}
