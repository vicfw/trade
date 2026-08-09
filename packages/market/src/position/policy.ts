import type {
  IntervalIndicators,
  MarketBias,
  MarketStructure,
  PositionLevels,
  TradeSide,
} from "@trade/shared"
import { validateTradeGeometry } from "./validateProposal"

export const MIN_RISK_REWARD = 1.5
export const ATR_STOP_BUFFER = 0.25
/** Minimum independent 15m confirmations required for a long/short. */
export const MIN_ENTRY_SIGNALS = 2
/** Reject stops farther than this many ATR14 from entry (after snap). */
export const MAX_STOP_ATR_MULT = 2
/** Reject stops closer than this many ATR14 from entry (after snap) — noise floor. */
export const MIN_STOP_ATR_MULT = 0.75

export interface EntrySignalFlags {
  priceVsEma20: boolean
  priceVsEma50: boolean
  rsiSide: boolean
  swingBreak: boolean
}

export interface EntrySignalCount {
  count: number
  flags: EntrySignalFlags
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function mostRecentSwing(
  swings: IntervalIndicators["swings"],
  kind: "high" | "low",
): number | null {
  const candidates = swings.filter((s) => s.kind === kind)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    if (a.index !== b.index) return b.index - a.index
    return b.openTime - a.openTime
  })
  return candidates[0]!.price
}

/**
 * Count independent 15m confirmations for the proposed side.
 * Missing indicator values count as false (do not contribute).
 */
export function countEntrySignals(
  side: Exclude<TradeSide, "no_trade">,
  indicators: IntervalIndicators,
): EntrySignalCount {
  const close = indicators.lastClose
  const ema20 = indicators.ema20
  const ema50 = indicators.ema50
  const rsi = indicators.rsi14

  if (side === "long") {
    const swingHigh = mostRecentSwing(indicators.swings, "high")
    const flags: EntrySignalFlags = {
      priceVsEma20:
        isFiniteNumber(close) && isFiniteNumber(ema20) && close > ema20,
      priceVsEma50:
        isFiniteNumber(close) && isFiniteNumber(ema50) && close > ema50,
      rsiSide: isFiniteNumber(rsi) && rsi > 50,
      swingBreak:
        isFiniteNumber(close) &&
        isFiniteNumber(swingHigh) &&
        close > swingHigh,
    }
    const count = Object.values(flags).filter(Boolean).length
    return { count, flags }
  }

  const swingLow = mostRecentSwing(indicators.swings, "low")
  const flags: EntrySignalFlags = {
    priceVsEma20:
      isFiniteNumber(close) && isFiniteNumber(ema20) && close < ema20,
    priceVsEma50:
      isFiniteNumber(close) && isFiniteNumber(ema50) && close < ema50,
    rsiSide: isFiniteNumber(rsi) && rsi < 50,
    swingBreak:
      isFiniteNumber(close) && isFiniteNumber(swingLow) && close < swingLow,
  }
  const count = Object.values(flags).filter(Boolean).length
  return { count, flags }
}

/**
 * Finite stop distance and ATR, or null when either cannot be verified.
 */
function measuredStopDistance(
  entry: number,
  stopLoss: number,
  atr14: number | null,
): { distance: number; atr: number } | null {
  if (!isFiniteNumber(atr14) || !(atr14 > 0)) return null
  const distance = Math.abs(entry - stopLoss)
  if (!(distance > 0) || !Number.isFinite(distance)) return null
  return { distance, atr: atr14 }
}

/**
 * True when stop is farther than `mult × atr` from entry.
 * Also true when ATR is missing/invalid (cannot verify risk width).
 */
export function isStopTooWide(
  entry: number,
  stopLoss: number,
  atr14: number | null,
  mult = MAX_STOP_ATR_MULT,
): boolean {
  const measured = measuredStopDistance(entry, stopLoss, atr14)
  if (measured == null) return true
  return measured.distance > mult * measured.atr
}

/**
 * True when stop is closer than `mult × atr` from entry (noise stop).
 * Also true when ATR is missing/invalid (cannot verify risk width).
 */
export function isStopTooTight(
  entry: number,
  stopLoss: number,
  atr14: number | null,
  mult = MIN_STOP_ATR_MULT,
): boolean {
  const measured = measuredStopDistance(entry, stopLoss, atr14)
  if (measured == null) return true
  return measured.distance < mult * measured.atr
}

/** Direct 4h bias vs 1h structure conflict (prompt checklist). */
export function isMultiTfOpposed(
  bias4h: MarketBias,
  structure1h: MarketStructure,
): boolean {
  return (
    (bias4h === "bull" && structure1h === "downtrend") ||
    (bias4h === "bear" && structure1h === "uptrend")
  )
}

/**
 * Side fights a fully aligned multi-TF context
 * (4h bull + 1h uptrend, or 4h bear + 1h downtrend).
 */
export function sideConflictsWithAlignedContext(
  side: Exclude<TradeSide, "no_trade">,
  bias4h: MarketBias,
  structure1h: MarketStructure,
): boolean {
  const bullishAligned = bias4h === "bull" && structure1h === "uptrend"
  const bearishAligned = bias4h === "bear" && structure1h === "downtrend"
  if (bullishAligned && side === "short") return true
  if (bearishAligned && side === "long") return true
  return false
}

function nearestSwing(
  swings: IntervalIndicators["swings"],
  kind: "high" | "low",
  pivot: number,
  side: "below" | "above",
): number | null {
  const candidates = swings.filter((s) => {
    if (s.kind !== kind) return false
    return side === "below" ? s.price < pivot : s.price > pivot
  })
  if (candidates.length === 0) return null
  candidates.sort(
    (a, b) => Math.abs(a.price - pivot) - Math.abs(b.price - pivot),
  )
  return candidates[0]!.price
}

function finiteLivePrice(livePrice: number | null | undefined): number | null {
  return livePrice != null && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : null
}

/**
 * True when live price has already reached/passed take-profit before entry
 * can fill (stale target relative to the market).
 */
export function isTakeProfitAlreadyThrough(
  side: Exclude<TradeSide, "no_trade">,
  takeProfit: number,
  livePrice: number | null | undefined,
): boolean {
  const live = finiteLivePrice(livePrice)
  if (live == null) return false
  return side === "long" ? live >= takeProfit : live <= takeProfit
}

/**
 * Snap SL/TP to nearest 15m swings with an ATR buffer on the stop.
 * Entry is left unchanged. TP snaps to a swing still beyond live price when
 * known (not merely the nearest swing above/below entry). Falls back to LLM
 * levels when structure is missing or snap would break geometry.
 */
export function snapTradeLevels(
  side: Exclude<TradeSide, "no_trade">,
  levels: PositionLevels,
  indicators: IntervalIndicators,
  atrBufferMult = ATR_STOP_BUFFER,
  livePrice?: number | null,
): { levels: PositionLevels; warnings: string[] } {
  const warnings: string[] = []
  const atr = indicators.atr14
  const swings = indicators.swings
  const live = finiteLivePrice(livePrice)

  if (atr == null || !(atr > 0) || swings.length === 0) {
    warnings.push(
      "Could not snap levels: missing 15m swings or ATR; using LLM levels",
    )
    return { levels, warnings }
  }

  let stopLoss = levels.stopLoss
  let takeProfit = levels.takeProfit
  let snappedSl = false
  let snappedTp = false

  if (side === "long") {
    const swingLow = nearestSwing(swings, "low", levels.entry, "below")
    if (swingLow != null) {
      stopLoss = swingLow - atrBufferMult * atr
      snappedSl = true
    } else {
      warnings.push("No swing low below entry for SL snap")
    }

    // TP must stay ahead of both entry and live price (pullback longs).
    const tpFloor = live != null ? Math.max(levels.entry, live) : levels.entry
    const swingHigh = nearestSwing(swings, "high", tpFloor, "above")
    if (swingHigh != null) {
      takeProfit = swingHigh
      snappedTp = true
    } else if (levels.takeProfit > tpFloor) {
      warnings.push(
        "No 15m swing high above live price; keeping LLM take-profit",
      )
    } else {
      warnings.push("No actionable swing high above entry/live for TP snap")
    }
  } else {
    const swingHigh = nearestSwing(swings, "high", levels.entry, "above")
    if (swingHigh != null) {
      stopLoss = swingHigh + atrBufferMult * atr
      snappedSl = true
    } else {
      warnings.push("No swing high above entry for SL snap")
    }

    const tpCeiling = live != null ? Math.min(levels.entry, live) : levels.entry
    const swingLow = nearestSwing(swings, "low", tpCeiling, "below")
    if (swingLow != null) {
      takeProfit = swingLow
      snappedTp = true
    } else if (levels.takeProfit < tpCeiling) {
      warnings.push(
        "No 15m swing low below live price; keeping LLM take-profit",
      )
    } else {
      warnings.push("No actionable swing low below entry/live for TP snap")
    }
  }

  if (!snappedSl && !snappedTp) {
    return { levels, warnings }
  }

  const snapped: PositionLevels = {
    entry: levels.entry,
    stopLoss,
    takeProfit,
  }

  const geo = validateTradeGeometry(
    side,
    snapped.entry,
    snapped.stopLoss,
    snapped.takeProfit,
  )
  if (geo.length > 0) {
    warnings.push("Snap produced invalid geometry; using LLM levels")
    return { levels, warnings }
  }

  if (snappedSl || snappedTp) {
    warnings.push("Levels snapped to 15m swings with ATR stop buffer")
  }

  return { levels: snapped, warnings }
}
