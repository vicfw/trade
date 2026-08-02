import type { Candle, PositionTestHitReason, PositionTestStatus } from "@trade/shared"

export interface EvaluatePositionOutcomeInput {
  side: "long" | "short"
  entry: number
  stopLoss: number
  takeProfit: number
  /** Only candles at/after this time (ms) are considered. */
  since: number
  /**
   * Entry is known to be filled before these candles (e.g. observed on live
   * ticks). Skips the entry search and scans for exits from the first candle.
   */
  alreadyTriggered?: boolean
}

export interface PositionOutcomeResult {
  status: PositionTestStatus
  /** Candle openTime when entry first touched, else null. */
  triggeredAt: number | null
  hitAt: number | null
  hitReason: PositionTestHitReason | null
  candlesChecked: number
  warnings: string[]
}

function entryTouched(
  side: "long" | "short",
  entry: number,
  high: number,
  low: number,
): boolean {
  // Limit-style fill: long fills at/below entry, short fills at/above entry.
  return side === "long" ? low <= entry : high >= entry
}

/**
 * Walk candles overlapping `since` (candle.closeTime >= since):
 * 1. Wait for entry to be touched → otherwise `not_triggered`
 * 2. From the fill candle onward, report whether take-profit or stop-loss
 *    was touched first → `successful` / `failed`
 * 3. Entry filled but neither SL nor TP → `waiting`
 *
 * Careful intrabar rules (OHLC alone cannot order intrabar moves):
 * - If a candle's range covers both SL and TP after entry, stop-loss wins.
 * - Touching SL implies the entry was crossed first (SL is beyond entry), so
 *   a stop-loss on the fill candle is certain.
 * - A take-profit touch on the fill candle is ambiguous — the TP spike may
 *   have happened before the entry fill. It only counts when the candle
 *   closes beyond take-profit; otherwise we keep scanning and warn.
 */
export function evaluatePositionOutcome(
  candles: Candle[],
  input: EvaluatePositionOutcomeInput,
): PositionOutcomeResult {
  const { side, entry, stopLoss, takeProfit, since } = input
  const warnings: string[] = []

  // Include the in-progress bar that contains `since` (openTime can be
  // earlier). Using openTime >= since drops that bar and false-negatives
  // entry fills that happened in the same candle as the suggestion.
  const relevant = candles
    .filter((candle) => candle.closeTime >= since)
    .sort((a, b) => a.openTime - b.openTime)

  let triggeredAt: number | null = null
  let triggeredBeforeCandles = input.alreadyTriggered === true

  for (const candle of relevant) {
    const high = Number(candle.high)
    const low = Number(candle.low)
    const close = Number(candle.close)
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue

    let isFillCandle = false
    if (triggeredAt == null && !triggeredBeforeCandles) {
      if (!entryTouched(side, entry, high, low)) continue
      triggeredAt = candle.openTime
      isFillCandle = true
    }

    const hitTakeProfit = side === "long" ? high >= takeProfit : low <= takeProfit
    const hitStopLoss = side === "long" ? low <= stopLoss : high >= stopLoss

    if (hitStopLoss) {
      if (hitTakeProfit) {
        warnings.push(
          `Take-profit and stop-loss both fell inside the same candle at ${new Date(candle.openTime).toISOString()}; treated as stop-loss hit first (conservative)`,
        )
      }
      return {
        status: "failed",
        triggeredAt,
        hitAt: candle.openTime,
        hitReason: "stop_loss",
        candlesChecked: relevant.length,
        warnings,
      }
    }

    if (hitTakeProfit) {
      const closeConfirms =
        Number.isFinite(close) &&
        (side === "long" ? close >= takeProfit : close <= takeProfit)

      if (isFillCandle && !closeConfirms) {
        warnings.push(
          `Take-profit was touched inside the same candle that filled the entry (${new Date(candle.openTime).toISOString()}) but the candle closed back inside the range; the spike may have happened before the fill, so it was not counted (conservative)`,
        )
        continue
      }

      return {
        status: "successful",
        triggeredAt,
        hitAt: candle.openTime,
        hitReason: "take_profit",
        candlesChecked: relevant.length,
        warnings,
      }
    }
  }

  if (triggeredAt == null && !triggeredBeforeCandles) {
    return {
      status: "not_triggered",
      triggeredAt: null,
      hitAt: null,
      hitReason: null,
      candlesChecked: relevant.length,
      warnings,
    }
  }

  return {
    status: "waiting",
    triggeredAt,
    hitAt: null,
    hitReason: null,
    candlesChecked: relevant.length,
    warnings,
  }
}
