import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { MarketSnapshot } from "../market/buildSnapshot";
import { logLlmSnapshot } from "./logSnapshot";

const LOG_FILE = join(import.meta.dir, "../../logs/llm-snapshots.log");

describe("logLlmSnapshot", () => {
  afterEach(() => {
    if (existsSync(LOG_FILE)) {
      unlinkSync(LOG_FILE);
    }
  });

  test("prints nested snapshot and appends dated log file", () => {
    const snapshot: MarketSnapshot = {
      symbol: "BTCUSDT",
      snapshotAt: Date.UTC(2026, 6, 29, 6, 0, 0),
      ticker: {
        price: 100_000,
        changePercent24h: 1.25,
        high24h: 101_000,
        low24h: 99_000,
        volume24h: 12_345,
        eventTime: Date.UTC(2026, 6, 29, 6, 0, 0),
      },
      intervals: [
        {
          interval: "15m",
          barCount: 2,
          indicators: {
            ema20: 99_900,
            ema50: 99_800,
            ema200: 98_000,
            rsi14: 55,
            atr14: 250,
            lastClose: 100_000,
            openTime: Date.UTC(2026, 6, 29, 5, 45, 0),
            swings: [
              {
                kind: "low",
                index: 0,
                openTime: Date.UTC(2026, 6, 29, 5, 0, 0),
                price: 99_500,
              },
              {
                kind: "high",
                index: 1,
                openTime: Date.UTC(2026, 6, 29, 5, 30, 0),
                price: 100_200,
              },
            ],
          },
          recentCandles: [
            {
              t: Date.UTC(2026, 6, 29, 5, 30, 0),
              o: 99_800,
              h: 100_100,
              l: 99_700,
              c: 100_000,
              v: 10,
            },
            {
              t: Date.UTC(2026, 6, 29, 5, 45, 0),
              o: 100_000,
              h: 100_200,
              l: 99_900,
              c: 100_050,
              v: 12,
            },
          ],
          currentCandle: {
            t: Date.UTC(2026, 6, 29, 6, 0, 0),
            o: 100_050,
            h: 100_100,
            l: 99_980,
            c: 100_000,
            v: 3,
          },
        },
      ],
      context: { bias4h: "bull", structure1h: "uptrend" },
      warnings: [],
    };

    expect(() => logLlmSnapshot(snapshot)).not.toThrow();
    expect(existsSync(LOG_FILE)).toBe(true);

    const body = readFileSync(LOG_FILE, "utf8");
    expect(body).toContain("loggedAt=");
    expect(body).toContain("BTCUSDT");
    expect(body).toMatch(
      /\[suggest\] LLM snapshot \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
    );
  });
});
