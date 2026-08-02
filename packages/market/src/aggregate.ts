import type { Candle, KlineInterval } from "@trade/shared"

const MINUTE_MS = 60_000

/** Default contiguity tolerance between consecutive 1m bars inside a bucket. */
export const DEFAULT_AGGREGATE_MAX_GAP_MS = 3 * MINUTE_MS

const INTERVAL_MS: Record<KlineInterval, number> = {
  "15m": 15 * MINUTE_MS,
  "1h": 60 * MINUTE_MS,
  "4h": 4 * 60 * MINUTE_MS,
}

export function intervalDurationMs(interval: KlineInterval): number {
  return INTERVAL_MS[interval]
}

function sumVolumes(bars: Candle[]): { volume: string; quoteVolume: string } {
  let volume = 0
  let quote = 0
  for (const bar of bars) {
    const v = Number(bar.volume)
    const q = Number(bar.quoteVolume)
    if (Number.isFinite(v)) volume += v
    if (Number.isFinite(q)) quote += q
  }
  return {
    volume: String(volume),
    quoteVolume: String(quote),
  }
}

function bucketHasLargeGap(bars: Candle[], maxGapMs: number): boolean {
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i]!.openTime - bars[i - 1]!.openTime > maxGapMs) {
      return true
    }
  }
  return false
}

/**
 * Aggregate sorted 1m candles into closed higher-timeframe bars.
 * Buckets with internal gaps larger than `maxGapMs` are skipped.
 */
export function aggregateCandles(
  candles1m: Candle[],
  interval: KlineInterval,
  options?: { maxGapMs?: number; now?: number },
): Candle[] {
  const duration = intervalDurationMs(interval)
  const maxGapMs = options?.maxGapMs ?? DEFAULT_AGGREGATE_MAX_GAP_MS
  const now = options?.now ?? Date.now()

  if (candles1m.length === 0) return []

  const buckets = new Map<number, Candle[]>()
  for (const candle of candles1m) {
    const openTime = Math.floor(candle.openTime / duration) * duration
    const list = buckets.get(openTime)
    if (list) {
      list.push(candle)
    } else {
      buckets.set(openTime, [candle])
    }
  }

  const openTimes = [...buckets.keys()].sort((a, b) => a - b)
  const result: Candle[] = []

  for (const openTime of openTimes) {
    const bars = buckets.get(openTime)!
    bars.sort((a, b) => a.openTime - b.openTime)

    if (bucketHasLargeGap(bars, maxGapMs)) continue

    const closeTime = openTime + duration - 1
    const isClosed = closeTime <= now
    if (!isClosed) continue

    const first = bars[0]!
    const last = bars[bars.length - 1]!
    let high = Number(first.high)
    let low = Number(first.low)
    for (const bar of bars) {
      const h = Number(bar.high)
      const l = Number(bar.low)
      if (Number.isFinite(h) && h > high) high = h
      if (Number.isFinite(l) && l < low) low = l
    }

    const { volume, quoteVolume } = sumVolumes(bars)

    result.push({
      openTime,
      open: first.open,
      high: String(high),
      low: String(low),
      close: last.close,
      volume,
      closeTime,
      quoteVolume,
      isClosed: true,
    })
  }

  return result
}
