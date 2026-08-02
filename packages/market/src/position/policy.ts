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
 * True when stop is farther than `mult × atr` from entry.
 * Also true when ATR is missing/invalid (cannot verify risk width).
 */
export function isStopTooWide(
  entry: number,
  stopLoss: number,
  atr14: number | null,
  mult = MAX_STOP_ATR_MULT,
): boolean {
  if (!isFiniteNumber(atr14) || !(atr14 > 0)) return true
  const distance = Math.abs(entry - stopLoss)
  if (!(distance > 0) || !Number.isFinite(distance)) return true
  return distance > mult * atr14
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
  entry: number,
  side: "below" | "above",
): number | null {
  const candidates = swings.filter((s) => {
    if (s.kind !== kind) return false
    return side === "below" ? s.price < entry : s.price > entry
  })
  if (candidates.length === 0) return null
  candidates.sort(
    (a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry),
  )
  return candidates[0]!.price
}

/**
 * Snap SL/TP to nearest 15m swings with an ATR buffer on the stop.
 * Entry is left unchanged. Falls back to LLM levels when structure is missing
 * or snap would break geometry.
 */
export function snapTradeLevels(
  side: Exclude<TradeSide, "no_trade">,
  levels: PositionLevels,
  indicators: IntervalIndicators,
  atrBufferMult = ATR_STOP_BUFFER,
): { levels: PositionLevels; warnings: string[] } {
  const warnings: string[] = []
  const atr = indicators.atr14
  const swings = indicators.swings

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

    const swingHigh = nearestSwing(swings, "high", levels.entry, "above")
    if (swingHigh != null) {
      takeProfit = swingHigh
      snappedTp = true
    } else {
      warnings.push("No swing high above entry for TP snap")
    }
  } else {
    const swingHigh = nearestSwing(swings, "high", levels.entry, "above")
    if (swingHigh != null) {
      stopLoss = swingHigh + atrBufferMult * atr
      snappedSl = true
    } else {
      warnings.push("No swing high above entry for SL snap")
    }

    const swingLow = nearestSwing(swings, "low", levels.entry, "below")
    if (swingLow != null) {
      takeProfit = swingLow
      snappedTp = true
    } else {
      warnings.push("No swing low below entry for TP snap")
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
