import type { SwingPoint } from "@trade/shared"
import type { OhlcBar } from "./ohlc"

export interface SwingOptions {
  left?: number
  right?: number
}

/** Fractal-style pivot highs/lows. */
export function findSwings(
  bars: OhlcBar[],
  options: SwingOptions = {},
): SwingPoint[] {
  const left = options.left ?? 2
  const right = options.right ?? 2
  const swings: SwingPoint[] = []

  if (bars.length < left + right + 1) return swings

  for (let i = left; i < bars.length - right; i++) {
    const bar = bars[i]!
    let isHigh = true
    let isLow = true

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      const other = bars[j]!
      if (other.high >= bar.high) isHigh = false
      if (other.low <= bar.low) isLow = false
      if (!isHigh && !isLow) break
    }

    if (isHigh) {
      swings.push({
        kind: "high",
        index: i,
        openTime: bar.openTime,
        price: bar.high,
      })
    }
    if (isLow) {
      swings.push({
        kind: "low",
        index: i,
        openTime: bar.openTime,
        price: bar.low,
      })
    }
  }

  return swings
}
