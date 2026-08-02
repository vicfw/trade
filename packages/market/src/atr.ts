import type { OhlcBar } from "./ohlc"

function trueRange(bar: OhlcBar, prevClose: number): number {
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  )
}

/** ATR with Wilder smoothing. Null until enough bars. */
export function atr(bars: OhlcBar[], period = 14): Array<number | null> {
  if (period <= 0) {
    throw new Error(`ATR period must be > 0, got ${period}`)
  }

  const out: Array<number | null> = Array.from(
    { length: bars.length },
    () => null,
  )
  if (bars.length <= period) return out

  let sum = 0
  for (let i = 1; i <= period; i++) {
    sum += trueRange(bars[i]!, bars[i - 1]!.close)
  }

  let prev = sum / period
  out[period] = prev

  for (let i = period + 1; i < bars.length; i++) {
    const tr = trueRange(bars[i]!, bars[i - 1]!.close)
    prev = (prev * (period - 1) + tr) / period
    out[i] = prev
  }

  return out
}
