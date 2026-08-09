import {
  formatNoTradeRationale,
  type IntervalIndicators,
  type LlmPositionProposal,
  type MarketBias,
  type MarketStructure,
  type PositionLevels,
  type PositionSizing,
  type PositionSuggestion,
  type RiskRules,
} from "@trade/shared"
import {
  countEntrySignals,
  isMultiTfOpposed,
  isStopTooTight,
  isStopTooWide,
  isTakeProfitAlreadyThrough,
  MAX_STOP_ATR_MULT,
  MIN_ENTRY_SIGNALS,
  MIN_RISK_REWARD,
  MIN_STOP_ATR_MULT,
  sideConflictsWithAlignedContext,
  snapTradeLevels,
} from "./policy"
import { validateTradeGeometry } from "./validateProposal"

export function computeRiskReward(
  side: "long" | "short",
  entry: number,
  stopLoss: number,
  takeProfit: number,
): number | null {
  const risk = Math.abs(entry - stopLoss)
  const reward = Math.abs(takeProfit - entry)
  if (risk <= 0 || !Number.isFinite(risk) || !Number.isFinite(reward)) {
    return null
  }
  return reward / risk
}

/**
 * Size a position from risk rules. Caps notional at balance × maxLeverage.
 * When leverage is capped, quantity is reduced so exposure stays within the cap
 * (risk amount may therefore be below the configured max).
 */
export function enforcePositionSizing(
  levels: PositionLevels,
  rules: RiskRules,
): PositionSizing {
  const { accountBalanceUsdt, maxRiskPercent, maxLeverage } = rules

  if (
    !(accountBalanceUsdt > 0) ||
    !(maxRiskPercent > 0) ||
    !(maxLeverage >= 1)
  ) {
    throw new Error("Invalid risk rules for sizing")
  }

  const stopDistance = Math.abs(levels.entry - levels.stopLoss)
  if (!(stopDistance > 0)) {
    throw new Error("Stop distance must be positive")
  }

  const riskAmountUsdt = accountBalanceUsdt * (maxRiskPercent / 100)
  let quantityBtc = riskAmountUsdt / stopDistance
  let notionalUsdt = quantityBtc * levels.entry
  const maxNotional = accountBalanceUsdt * maxLeverage
  let leverageCapped = false

  if (notionalUsdt > maxNotional) {
    leverageCapped = true
    notionalUsdt = maxNotional
    quantityBtc = notionalUsdt / levels.entry
  }

  const leverage = notionalUsdt / accountBalanceUsdt
  const effectiveRisk = quantityBtc * stopDistance

  return {
    riskAmountUsdt: effectiveRisk,
    quantityBtc,
    notionalUsdt,
    leverage,
    riskReward: null, // filled by caller with side-aware RR
    leverageCapped,
  }
}

export function validateRiskRules(raw: unknown): RiskRules {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Risk rules must be an object")
  }

  const obj = raw as Record<string, unknown>
  const accountBalanceUsdt = Number(obj.accountBalanceUsdt)
  const maxRiskPercent = Number(obj.maxRiskPercent)
  const maxLeverage = Number(obj.maxLeverage)

  if (!(accountBalanceUsdt > 0) || !Number.isFinite(accountBalanceUsdt)) {
    throw new Error("accountBalanceUsdt must be a positive number")
  }
  if (
    !(maxRiskPercent > 0) ||
    !(maxRiskPercent <= 100) ||
    !Number.isFinite(maxRiskPercent)
  ) {
    throw new Error("maxRiskPercent must be in (0, 100]")
  }
  if (!(maxLeverage >= 1) || !Number.isFinite(maxLeverage)) {
    throw new Error("maxLeverage must be >= 1")
  }

  return { accountBalanceUsdt, maxRiskPercent, maxLeverage }
}

export interface FinalizeSuggestionContext {
  bias4h: MarketBias
  structure1h: MarketStructure
  entryIndicators: IntervalIndicators
  /** Live BTCUSDT perpetual last price; used for actionable TP/entry gates. */
  livePrice?: number | null
}

function noTradeResult(
  proposal: LlmPositionProposal,
  warnings: string[],
  rationale = proposal.rationale,
): PositionSuggestion {
  return {
    side: "no_trade",
    levels: null,
    sizing: null,
    confidence: proposal.confidence,
    rationale,
    warnings,
  }
}

/** Policy reject: Failed/Watch lives in rationale; warnings are extras only. */
function downgradeNoTrade(
  proposal: LlmPositionProposal,
  failed: string,
  watch: string,
  warnings: string[] = [],
): PositionSuggestion {
  return noTradeResult(
    proposal,
    warnings,
    formatNoTradeRationale(failed, watch),
  )
}

function formatFinalLevelsNote(
  levels: PositionLevels,
  riskReward: number,
): string {
  return `Final levels after policy: entry ${levels.entry}, stop-loss ${levels.stopLoss}, take-profit ${levels.takeProfit} (R:R ${riskReward.toFixed(2)}).`
}

/** Reject stop distance outside [MIN_STOP_ATR_MULT, MAX_STOP_ATR_MULT] × ATR. */
function downgradeStopAtrWidth(
  proposal: LlmPositionProposal,
  entry: number,
  stopLoss: number,
  atr14: number | null | undefined,
  kind: "wide" | "tight",
  warnings: string[],
): PositionSuggestion {
  const atr = atr14
  const distance = Math.abs(entry - stopLoss)
  const atrOk = atr != null && atr > 0
  if (kind === "wide") {
    const detail = atrOk
      ? `stop distance ${distance.toFixed(2)} exceeds ${MAX_STOP_ATR_MULT}×ATR (${(MAX_STOP_ATR_MULT * atr).toFixed(2)})`
      : "15m ATR unavailable; cannot verify stop width"
    return downgradeNoTrade(
      proposal,
      `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`,
      atrOk
        ? `Re-check when stop distance is ≤ ${(MAX_STOP_ATR_MULT * atr).toFixed(2)} (${MAX_STOP_ATR_MULT}×15m ATR), e.g. a closer invalidation swing.`
        : `Re-check once 15m ATR is available and stop distance stays within ${MAX_STOP_ATR_MULT}×ATR of entry.`,
      warnings,
    )
  }
  const detail = atrOk
    ? `stop distance ${distance.toFixed(2)} is below ${MIN_STOP_ATR_MULT}×ATR (${(MIN_STOP_ATR_MULT * atr).toFixed(2)})`
    : "15m ATR unavailable; cannot verify stop width"
  return downgradeNoTrade(
    proposal,
    `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`,
    atrOk
      ? `Re-check when stop distance is ≥ ${(MIN_STOP_ATR_MULT * atr).toFixed(2)} (${MIN_STOP_ATR_MULT}×15m ATR), e.g. a deeper invalidation swing beyond noise.`
      : `Re-check once 15m ATR is available and stop distance stays at least ${MIN_STOP_ATR_MULT}×ATR from entry.`,
    warnings,
  )
}

/**
 * Turn a validated LLM proposal into a final suggestion with code-enforced
 * level snap, RR / multi-TF policy, and sizing.
 */
export function finalizeSuggestion(
  proposal: LlmPositionProposal,
  rules: RiskRules,
  ctx: FinalizeSuggestionContext,
): PositionSuggestion {
  const warnings = validateTradeGeometry(
    proposal.side,
    proposal.entry,
    proposal.stopLoss,
    proposal.takeProfit,
  )

  if (proposal.side === "no_trade") {
    return noTradeResult(proposal, warnings)
  }

  if (warnings.length > 0) {
    return downgradeNoTrade(
      proposal,
      `Invalid ${proposal.side} geometry (${warnings[0]}).`,
      "Re-analyze when entry, stop-loss, and take-profit form valid long (SL < entry < TP) or short (TP < entry < SL) levels from the live snapshot.",
      warnings,
    )
  }

  if (isMultiTfOpposed(ctx.bias4h, ctx.structure1h)) {
    return downgradeNoTrade(
      proposal,
      `4h bias (${ctx.bias4h}) opposes 1h structure (${ctx.structure1h}).`,
      "Re-check after 4h bias and 1h structure agree, or after 4h turns neutral with a clear directional 1h structure.",
    )
  }

  if (
    sideConflictsWithAlignedContext(
      proposal.side,
      ctx.bias4h,
      ctx.structure1h,
    )
  ) {
    return downgradeNoTrade(
      proposal,
      `${proposal.side} conflicts with aligned 4h ${ctx.bias4h} / 1h ${ctx.structure1h}.`,
      `Re-check when multi-TF context supports a ${proposal.side}, or when bias/structure stop fighting that side.`,
    )
  }

  const signals = countEntrySignals(proposal.side, ctx.entryIndicators)
  if (signals.count < MIN_ENTRY_SIGNALS) {
    return downgradeNoTrade(
      proposal,
      `Only ${signals.count}/${MIN_ENTRY_SIGNALS} required 15m confirmations (ema20=${signals.flags.priceVsEma20}, ema50=${signals.flags.priceVsEma50}, rsi=${signals.flags.rsiSide}, swingBreak=${signals.flags.swingBreak}).`,
      `Re-check on a 15m close with at least two of: price on the ${proposal.side} side of EMA20 and EMA50, RSI on the ${proposal.side} side of 50, or a confirming swing break.`,
    )
  }

  let levels: PositionLevels = {
    entry: proposal.entry!,
    stopLoss: proposal.stopLoss!,
    takeProfit: proposal.takeProfit!,
  }

  const snapped = snapTradeLevels(
    proposal.side,
    levels,
    ctx.entryIndicators,
    undefined,
    ctx.livePrice,
  )
  levels = snapped.levels
  warnings.push(...snapped.warnings)

  const postSnapGeo = validateTradeGeometry(
    proposal.side,
    levels.entry,
    levels.stopLoss,
    levels.takeProfit,
  )
  if (postSnapGeo.length > 0) {
    return downgradeNoTrade(
      proposal,
      `Levels became invalid after snapping to 15m swings (${postSnapGeo[0]}).`,
      "Re-analyze when a nearby swing invalidation and target still leave valid long/short geometry after ATR buffering.",
      [...warnings, ...postSnapGeo],
    )
  }

  if (
    isTakeProfitAlreadyThrough(proposal.side, levels.takeProfit, ctx.livePrice)
  ) {
    const live = ctx.livePrice
    return downgradeNoTrade(
      proposal,
      `Live price ${live} has already reached take-profit ${levels.takeProfit} before entry can fill.`,
      "Re-check when a pullback entry and a take-profit still ahead of the live perpetual price yield reward/risk ≥ 1.5.",
      warnings,
    )
  }

  if (
    isStopTooWide(levels.entry, levels.stopLoss, ctx.entryIndicators.atr14)
  ) {
    return downgradeStopAtrWidth(
      proposal,
      levels.entry,
      levels.stopLoss,
      ctx.entryIndicators.atr14,
      "wide",
      warnings,
    )
  }

  if (
    isStopTooTight(levels.entry, levels.stopLoss, ctx.entryIndicators.atr14)
  ) {
    return downgradeStopAtrWidth(
      proposal,
      levels.entry,
      levels.stopLoss,
      ctx.entryIndicators.atr14,
      "tight",
      warnings,
    )
  }

  const riskReward = computeRiskReward(
    proposal.side,
    levels.entry,
    levels.stopLoss,
    levels.takeProfit,
  )
  if (riskReward == null || riskReward < MIN_RISK_REWARD) {
    const rrLabel = riskReward == null ? "n/a" : riskReward.toFixed(2)
    return downgradeNoTrade(
      proposal,
      `Reward/risk ${rrLabel} is below the required ${MIN_RISK_REWARD}.`,
      `Re-check when a technically valid target/stop pair yields reward/risk ≥ ${MIN_RISK_REWARD}.`,
      warnings,
    )
  }

  const sizing = enforcePositionSizing(levels, rules)
  sizing.riskReward = riskReward

  if (sizing.leverageCapped) {
    warnings.push(
      `Leverage capped at ${rules.maxLeverage}x; position size reduced to fit risk rules`,
    )
  }

  const rationale = snapped.warnings.some((w) =>
    /snapped to 15m swings/.test(w),
  )
    ? `${proposal.rationale.trim()}\n\n${formatFinalLevelsNote(levels, riskReward)}`
    : proposal.rationale

  return {
    side: proposal.side,
    levels,
    sizing,
    confidence: proposal.confidence,
    rationale,
    warnings,
  }
}
