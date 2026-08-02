import { describe, expect, test } from "bun:test"
import type { Candle } from "@trade/shared"
import { aggregateCandles } from "./aggregate"

function m1(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1,
): Candle {
  return {
    openTime,
    open: String(open),
    high: String(high),
    low: String(low),
    close: String(close),
    volume: String(volume),
    closeTime: openTime + 60_000 - 1,
    quoteVolume: String(volume * close),
    isClosed: true,
  }
}

describe("aggregateCandles", () => {
  test("aggregates 15 contiguous 1m bars into one 15m candle", () => {
    const start = Date.UTC(2026, 0, 1, 12, 0, 0)
    const now = start + 15 * 60_000
    const bars = Array.from({ length: 15 }, (_, i) =>
      m1(start + i * 60_000, 100 + i, 110 + i, 90 + i, 105 + i, 2),
    )

    const out = aggregateCandles(bars, "15m", { now })
    expect(out).toHaveLength(1)
    expect(out[0]!.openTime).toBe(start)
    expect(out[0]!.open).toBe("100")
    expect(out[0]!.close).toBe("119")
    expect(Number(out[0]!.high)).toBe(110 + 14)
    expect(Number(out[0]!.low)).toBe(90)
    expect(Number(out[0]!.volume)).toBe(30)
    expect(out[0]!.isClosed).toBe(true)
  })

  test("skips buckets with large internal gaps", () => {
    const start = Date.UTC(2026, 0, 1, 12, 0, 0)
    const now = start + 15 * 60_000
    const bars = [
      m1(start, 100, 101, 99, 100),
      m1(start + 60_000, 100, 101, 99, 100),
      // 5-minute hole
      m1(start + 6 * 60_000, 100, 101, 99, 100),
    ]

    const out = aggregateCandles(bars, "15m", { now, maxGapMs: 3 * 60_000 })
    expect(out).toHaveLength(0)
  })

  test("omits the in-progress HTF bucket", () => {
    const start = Date.UTC(2026, 0, 1, 12, 0, 0)
    const now = start + 5 * 60_000 // mid-bucket
    const bars = Array.from({ length: 5 }, (_, i) =>
      m1(start + i * 60_000, 100, 101, 99, 100),
    )

    expect(aggregateCandles(bars, "15m", { now })).toHaveLength(0)
  })
})
