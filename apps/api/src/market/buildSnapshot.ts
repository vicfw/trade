import type {
  BtcTicker,
  Candle,
  IntervalIndicators,
  KlineInterval,
  MultiTfContext,
} from "@trade/shared";
import {
  computeIntervalIndicators,
  computeMultiTfContext,
} from "@trade/market";

export interface CompactOhlcvBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface IntervalSnapshot {
  interval: KlineInterval;
  barCount: number;
  indicators: IntervalIndicators;
  /** Completed candles only (oldest → newest). */
  recentCandles: CompactOhlcvBar[];
  /**
   * In-progress bar for this TF. When a live ticker is present, `c` (and the
   * high/low envelope) matches ticker.price so the model does not trade off a
   * stale last close.
   */
  currentCandle: CompactOhlcvBar | null;
}

export interface MarketSnapshot {
  symbol: string;
  snapshotAt: number;
  ticker: {
    price: number | null;
    changePercent24h: number | null;
    high24h: number | null;
    low24h: number | null;
    volume24h: number | null;
    eventTime: number | null;
  };
  intervals: IntervalSnapshot[];
  context: MultiTfContext;
  warnings: string[];
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compactCandle(candle: Candle): CompactOhlcvBar {
  return {
    t: candle.openTime,
    o: Number(candle.open),
    h: Number(candle.high),
    l: Number(candle.low),
    c: Number(candle.close),
    v: Number(candle.volume),
  };
}

function compactCandles(candles: Candle[], window: number): CompactOhlcvBar[] {
  const slice = window > 0 ? candles.slice(-window) : candles;
  return slice.map(compactCandle);
}

function withLivePrice(candle: Candle, livePrice: number | null): Candle {
  if (livePrice == null || !Number.isFinite(livePrice) || livePrice <= 0) {
    return candle;
  }
  const high = Math.max(Number(candle.high), livePrice);
  const low = Math.min(Number(candle.low), livePrice);
  return {
    ...candle,
    high: String(Number.isFinite(high) ? high : livePrice),
    low: String(Number.isFinite(low) ? low : livePrice),
    close: String(livePrice),
  };
}

export function buildMarketSnapshot(input: {
  symbol: string;
  intervals: readonly KlineInterval[];
  getCandles: (interval: KlineInterval) => Candle[];
  ticker: BtcTicker | null;
  candleWindow: number;
}): MarketSnapshot {
  const warnings: string[] = [];
  const byInterval: Partial<Record<KlineInterval, IntervalIndicators>> = {};
  const intervals: IntervalSnapshot[] = [];
  const livePrice = toNumber(input.ticker?.price);

  for (const interval of input.intervals) {
    const candles = input.getCandles(interval);
    const closedCandles = candles.filter((candle) => candle.isClosed);
    const forming = candles.findLast((candle) => !candle.isClosed) ?? null;
    const indicators = computeIntervalIndicators(closedCandles);
    if (closedCandles.length > 0) {
      byInterval[interval] = indicators;
    } else if (candles.length > 0) {
      warnings.push(`No closed candles for ${interval}`);
    } else {
      warnings.push(`No candles for ${interval}`);
    }

    intervals.push({
      interval,
      barCount: closedCandles.length,
      indicators,
      recentCandles: compactCandles(closedCandles, input.candleWindow),
      currentCandle: forming
        ? compactCandle(withLivePrice(forming, livePrice))
        : null,
    });
  }

  if (!input.ticker) {
    warnings.push("Live ticker unavailable; use last closes as reference");
  }

  return {
    symbol: input.symbol,
    snapshotAt: Date.now(),
    ticker: {
      price: livePrice,
      changePercent24h: toNumber(input.ticker?.changePercent24h),
      high24h: toNumber(input.ticker?.high24h),
      low24h: toNumber(input.ticker?.low24h),
      volume24h: toNumber(input.ticker?.volume24h),
      eventTime: input.ticker?.eventTime ?? null,
    },
    intervals,
    context: computeMultiTfContext(byInterval, livePrice),
    warnings,
  };
}

/** Minimum closed bars per interval before suggest treats the market as ready. */
export const MIN_SNAPSHOT_CLOSED_BARS = 30;

export function isMarketDataReady(
  snapshot: MarketSnapshot,
  minBars = MIN_SNAPSHOT_CLOSED_BARS,
): boolean {
  return (
    snapshot.intervals.length > 0 &&
    snapshot.intervals.every((item) => item.barCount >= minBars)
  );
}
