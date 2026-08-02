import type {
  Candle,
  IntervalIndicators,
  KlineInterval,
  MarketBias,
  MarketStructure,
  MultiTfContext,
} from "@trade/shared";
import { atr } from "./atr";
import { ema } from "./ema";
import { lastFinite, toCloses, toOhlc } from "./ohlc";
import { rsi } from "./rsi";
import { findSwings } from "./swings";

const SWING_TAIL = 5;

export function computeIntervalIndicators(
  candles: Candle[],
): IntervalIndicators {
  if (candles.length === 0) {
    return {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      atr14: null,
      lastClose: null,
      openTime: null,
      swings: [],
    };
  }

  const bars = toOhlc(candles);
  const closes = toCloses(candles);
  const swings = findSwings(bars);
  const last = candles.at(-1)!;

  return {
    ema20: lastFinite(ema(closes, 20)),
    ema50: lastFinite(ema(closes, 50)),
    ema200: lastFinite(ema(closes, 200)),
    rsi14: lastFinite(rsi(closes, 14)),
    atr14: lastFinite(atr(bars, 14)),
    lastClose: Number(last.close),
    openTime: last.openTime,
    swings: swings.slice(-SWING_TAIL),
  };
}

export function computeBias4h(indicators: IntervalIndicators): MarketBias {
  const { lastClose, ema50, ema200, rsi14 } = indicators;
  if (lastClose == null || ema50 == null || ema200 == null || rsi14 == null) {
    return "neutral";
  }

  if (lastClose > ema50 && ema50 > ema200 && rsi14 >= 45) return "bull";
  if (lastClose < ema50 && ema50 < ema200 && rsi14 <= 55) return "bear";
  return "neutral";
}

export function computeStructure1h(
  indicators: IntervalIndicators,
): MarketStructure {
  const highs = indicators.swings.filter((s) => s.kind === "high");
  const lows = indicators.swings.filter((s) => s.kind === "low");

  if (highs.length < 2 || lows.length < 2) return "unclear";

  const h1 = highs.at(-2)!;
  const h2 = highs.at(-1)!;
  const l1 = lows.at(-2)!;
  const l2 = lows.at(-1)!;

  const higherHighs = h2.price > h1.price;
  const higherLows = l2.price > l1.price;
  const lowerHighs = h2.price < h1.price;
  const lowerLows = l2.price < l1.price;

  if (higherHighs && higherLows) return "uptrend";
  if (lowerHighs && lowerLows) return "downtrend";
  if ((higherHighs && lowerLows) || (lowerHighs && higherLows)) return "range";
  return "unclear";
}

export function computeMultiTfContext(
  byInterval: Partial<Record<KlineInterval, IntervalIndicators>>,
): MultiTfContext {
  const bias4h = byInterval["4h"] ? computeBias4h(byInterval["4h"]) : "neutral";
  const structure1h = byInterval["1h"]
    ? computeStructure1h(byInterval["1h"])
    : "unclear";

  return { bias4h, structure1h };
}
