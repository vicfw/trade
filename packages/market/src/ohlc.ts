import type { Candle } from "@trade/shared";

export interface OhlcBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function toCloses(candles: Candle[]): number[] {
  return candles.map((c) => Number(c.close));
}

export function toOhlc(candles: Candle[]): OhlcBar[] {
  return candles.map((c) => ({
    openTime: c.openTime,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));
}

export function lastFinite(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}
