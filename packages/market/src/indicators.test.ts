import { describe, expect, test } from "bun:test";
import { ema } from "./ema";
import { rsi } from "./rsi";
import { atr } from "./atr";
import { findSwings } from "./swings";
import type { OhlcBar } from "./ohlc";
import { computeBias4h, computeStructure1h } from "./snapshot";
import type { IntervalIndicators } from "@trade/shared";

describe("ema", () => {
  test("seeds with SMA then applies Wilder-style EMA multiplier", () => {
    const values = [1, 2, 3, 4, 5, 6, 7];
    const result = ema(values, 3);

    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(result[3]).toBeCloseTo(3, 10);
    // 5*0.5 + 3*0.5 = 4
    expect(result[4]).toBeCloseTo(4, 10);
  });

  test("returns all nulls when not enough bars", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe("rsi", () => {
  test("computes Wilder RSI after period + 1 closes", () => {
    // Steady uptrends: all gains → RSI 100 at first readable bar
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rsi(closes, 14);

    for (let i = 0; i < 14; i++) {
      expect(result[i]).toBeNull();
    }
    expect(result[14]).toBeCloseTo(100, 8);
    expect(result[19]).toBeCloseTo(100, 8);
  });

  test("handles pure losses as RSI 0", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    const result = rsi(closes, 14);
    expect(result[14]).toBeCloseTo(0, 8);
  });
});

describe("atr", () => {
  test("seeds with SMA of true ranges then Wilder-smooths", () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push({
        openTime: i,
        open: 100,
        high: 110,
        low: 90,
        close: 100,
      });
    }

    const result = atr(bars, 14);
    for (let i = 0; i < 14; i++) {
      expect(result[i]).toBeNull();
    }
    // each TR = max(20, |110-100|, |90-100|) = 20
    expect(result[14]).toBeCloseTo(20, 10);
    expect(result[19]).toBeCloseTo(20, 10);
  });
});

describe("findSwings", () => {
  test("detects pivot high and low with left/right=2", () => {
    const bars: OhlcBar[] = [
      { openTime: 0, open: 10, high: 11, low: 9, close: 10 },
      { openTime: 1, open: 10, high: 12, low: 8, close: 10 },
      { openTime: 2, open: 10, high: 20, low: 10, close: 15 }, // high pivot
      { openTime: 3, open: 10, high: 13, low: 9, close: 10 },
      { openTime: 4, open: 10, high: 12, low: 8, close: 10 },
      { openTime: 5, open: 10, high: 11, low: 1, close: 5 }, // low pivot
      { openTime: 6, open: 10, high: 12, low: 8, close: 10 },
      { openTime: 7, open: 10, high: 13, low: 9, close: 10 },
    ];

    const swings = findSwings(bars, { left: 2, right: 2 });
    const highs = swings.filter((s) => s.kind === "high");
    const lows = swings.filter((s) => s.kind === "low");

    expect(highs.some((s) => s.index === 2 && s.price === 20)).toBe(true);
    expect(lows.some((s) => s.index === 5 && s.price === 1)).toBe(true);
  });
});

describe("multi-tf context helpers", () => {
  test("bias4h bull when stacked EMAs and RSI supportive", () => {
    const indicators: IntervalIndicators = {
      ema20: 105,
      ema50: 100,
      ema200: 90,
      rsi14: 55,
      atr14: 2,
      lastClose: 110,
      openTime: 1,
      swings: [],
    };
    expect(computeBias4h(indicators)).toBe("bull");
  });

  test("structure1h uptrend on HH + HL", () => {
    const indicators: IntervalIndicators = {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      atr14: null,
      lastClose: 110,
      openTime: 1,
      swings: [
        { kind: "high", index: 1, openTime: 1, price: 100 },
        { kind: "low", index: 2, openTime: 2, price: 80 },
        { kind: "high", index: 3, openTime: 3, price: 120 },
        { kind: "low", index: 4, openTime: 4, price: 90 },
      ],
    };
    expect(computeStructure1h(indicators)).toBe("uptrend");
  });

  test("structure1h downtrend on LH + LL when price stays inside last swing", () => {
    const indicators: IntervalIndicators = {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      atr14: null,
      lastClose: 95,
      openTime: 5,
      swings: [
        { kind: "high", index: 1, openTime: 1, price: 120 },
        { kind: "low", index: 2, openTime: 2, price: 90 },
        { kind: "high", index: 3, openTime: 3, price: 110 },
        { kind: "low", index: 4, openTime: 4, price: 80 },
      ],
    };
    expect(computeStructure1h(indicators)).toBe("downtrend");
  });

  test("structure1h flips to uptrend on bullish break of structure", () => {
    // Last confirmed pivots are LH+LL (local downtrend), but price reclaimed
    // above the latest swing high — the production chart failure mode.
    const indicators: IntervalIndicators = {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      atr14: null,
      lastClose: 64_800,
      openTime: 5,
      swings: [
        { kind: "high", index: 1, openTime: 1, price: 65_200 },
        { kind: "low", index: 2, openTime: 2, price: 63_500 },
        { kind: "high", index: 3, openTime: 3, price: 64_961.9 },
        { kind: "low", index: 4, openTime: 4, price: 63_200 },
      ],
    };
    expect(computeStructure1h(indicators)).toBe("downtrend");
    expect(computeStructure1h(indicators, 65_333.8)).toBe("uptrend");
    expect(computeStructure1h({ ...indicators, lastClose: 65_100 })).toBe(
      "uptrend",
    );
  });

  test("structure1h flips to downtrend on bearish break of structure", () => {
    const indicators: IntervalIndicators = {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      atr14: null,
      lastClose: 105,
      openTime: 5,
      swings: [
        { kind: "high", index: 1, openTime: 1, price: 100 },
        { kind: "low", index: 2, openTime: 2, price: 80 },
        { kind: "high", index: 3, openTime: 3, price: 120 },
        { kind: "low", index: 4, openTime: 4, price: 90 },
      ],
    };
    expect(computeStructure1h(indicators)).toBe("uptrend");
    expect(computeStructure1h(indicators, 85)).toBe("downtrend");
  });

  test("structure1h range on mixed HH + LL", () => {
    const indicators: IntervalIndicators = {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      atr14: null,
      lastClose: 105,
      openTime: 5,
      swings: [
        { kind: "high", index: 1, openTime: 1, price: 100 },
        { kind: "low", index: 2, openTime: 2, price: 90 },
        { kind: "high", index: 3, openTime: 3, price: 120 },
        { kind: "low", index: 4, openTime: 4, price: 80 },
      ],
    };
    expect(computeStructure1h(indicators)).toBe("range");
  });
});
