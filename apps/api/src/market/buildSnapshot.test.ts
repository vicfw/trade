import { describe, expect, test } from "bun:test";
import type { Candle } from "@trade/shared";
import { buildMarketSnapshot, isMarketDataReady } from "./buildSnapshot";

function makeCandle(index: number, close: number, isClosed = true): Candle {
  return {
    openTime: index * 60_000,
    open: String(close - 1),
    high: String(close + 2),
    low: String(close - 2),
    close: String(close),
    volume: "10",
    closeTime: index * 60_000 + 59_999,
    quoteVolume: "1000",
    isClosed,
  };
}

describe("buildMarketSnapshot", () => {
  test("builds compact tails and indicators", () => {
    const candles15 = Array.from({ length: 80 }, (_, i) =>
      makeCandle(i, 100 + i),
    );
    const candles1h = Array.from({ length: 50 }, (_, i) =>
      makeCandle(i, 100 + i),
    );
    const candles4h = Array.from({ length: 40 }, (_, i) =>
      makeCandle(i, 100 + i),
    );

    const snapshot = buildMarketSnapshot({
      symbol: "BTCUSDT",
      intervals: ["15m", "1h", "4h"],
      getCandles: (interval) => {
        if (interval === "15m") return candles15;
        if (interval === "1h") return candles1h;
        return candles4h;
      },
      ticker: {
        symbol: "BTCUSDT",
        price: "180",
        changePercent24h: "1.2",
        high24h: "190",
        low24h: "170",
        volume24h: "100",
        quoteVolume24h: "18000",
        eventTime: 123,
      },
      candleWindow: 60,
    });

    expect(snapshot.symbol).toBe("BTCUSDT");
    expect(snapshot.ticker.price).toBe(180);
    expect(snapshot.intervals).toHaveLength(3);

    const m15 = snapshot.intervals.find((i) => i.interval === "15m")!;
    expect(m15.barCount).toBe(80);
    expect(m15.recentCandles).toHaveLength(60);
    expect(m15.currentCandle).toBeNull();
    expect(m15.indicators.lastClose).toBe(179);
    expect(isMarketDataReady(snapshot)).toBe(true);
  });

  test("excludes active candles from indicators and OHLCV tails but exposes live-synced currentCandle", () => {
    const completed = Array.from({ length: 200 }, (_, i) =>
      makeCandle(i, 100 + i),
    );
    const active = makeCandle(200, 10_000, false);

    const snapshot = buildMarketSnapshot({
      symbol: "BTCUSDT",
      intervals: ["15m"],
      getCandles: () => [...completed, active],
      ticker: {
        symbol: "BTCUSDT",
        price: "64572.3",
        changePercent24h: "1",
        high24h: "65000",
        low24h: "64000",
        volume24h: "100",
        quoteVolume24h: "1000",
        eventTime: 1,
      },
      candleWindow: 60,
    });

    const m15 = snapshot.intervals[0]!;
    expect(m15.barCount).toBe(200);
    expect(m15.recentCandles).toHaveLength(60);
    expect(m15.recentCandles.at(-1)?.c).toBe(299);
    expect(m15.indicators.lastClose).toBe(299);
    expect(m15.indicators.ema200).not.toBeNull();
    expect(m15.currentCandle).toEqual({
      t: active.openTime,
      o: 9_999,
      h: 64_572.3,
      l: 9_998,
      c: 64_572.3,
      v: 10,
    });
    expect(snapshot.ticker.price).toBe(64_572.3);
  });

  test("requires completed candles for every configured interval", () => {
    const snapshot = buildMarketSnapshot({
      symbol: "BTCUSDT",
      intervals: ["15m", "1h"],
      getCandles: (interval) =>
        interval === "15m" ? [makeCandle(0, 100)] : [],
      ticker: null,
      candleWindow: 60,
    });

    expect(isMarketDataReady(snapshot)).toBe(false);
  });

  test("flags empty store and missing ticker", () => {
    const snapshot = buildMarketSnapshot({
      symbol: "BTCUSDT",
      intervals: ["15m"],
      getCandles: () => [],
      ticker: null,
      candleWindow: 60,
    });
    expect(isMarketDataReady(snapshot)).toBe(false);
    expect(snapshot.warnings.some((w) => /No candles/.test(w))).toBe(true);
    expect(snapshot.warnings.some((w) => /ticker/.test(w))).toBe(true);
  });
});
