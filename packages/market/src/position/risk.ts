import type {
  IntervalIndicators,
  LlmPositionProposal,
  MarketBias,
  MarketStructure,
  PositionLevels,
  PositionSizing,
  PositionSuggestion,
  RiskRules,
} from "@trade/shared"
import {
  countEntrySignals,
  isMultiTfOpposed,
  isStopTooWide,
  MAX_STOP_ATR_MULT,
  MIN_ENTRY_SIGNALS,
  MIN_RISK_REWARD,
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
}

function noTradeResult(
  proposal: LlmPositionProposal,
  warnings: string[],
): PositionSuggestion {
  return {
    side: "no_trade",
    levels: null,
    sizing: null,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    warnings,
  }
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

  if (proposal.side === "no_trade" || warnings.length > 0) {
    const extra =
      proposal.side !== "no_trade" && warnings.length > 0
        ? ["Downgraded to no_trade due to invalid trade geometry"]
        : []
    return noTradeResult(proposal, [...warnings, ...extra])
  }

  if (isMultiTfOpposed(ctx.bias4h, ctx.structure1h)) {
    return noTradeResult(proposal, [
      `Downgraded to no_trade: 4h bias (${ctx.bias4h}) opposes 1h structure (${ctx.structure1h})`,
    ])
  }

  if (
    sideConflictsWithAlignedContext(
      proposal.side,
      ctx.bias4h,
      ctx.structure1h,
    )
  ) {
    return noTradeResult(proposal, [
      `Downgraded to no_trade: ${proposal.side} conflicts with aligned ${ctx.bias4h} / ${ctx.structure1h}`,
    ])
  }

  const signals = countEntrySignals(proposal.side, ctx.entryIndicators)
  if (signals.count < MIN_ENTRY_SIGNALS) {
    return noTradeResult(proposal, [
      `Downgraded to no_trade: only ${signals.count}/${MIN_ENTRY_SIGNALS} required 15m confirmations (ema20=${signals.flags.priceVsEma20}, ema50=${signals.flags.priceVsEma50}, rsi=${signals.flags.rsiSide}, swingBreak=${signals.flags.swingBreak})`,
    ])
  }

  let levels: PositionLevels = {
    entry: proposal.entry!,
    stopLoss: proposal.stopLoss!,
    takeProfit: proposal.takeProfit!,
  }

  const snapped = snapTradeLevels(proposal.side, levels, ctx.entryIndicators)
  levels = snapped.levels
  warnings.push(...snapped.warnings)

  const postSnapGeo = validateTradeGeometry(
    proposal.side,
    levels.entry,
    levels.stopLoss,
    levels.takeProfit,
  )
  if (postSnapGeo.length > 0) {
    return noTradeResult(proposal, [
      ...warnings,
      ...postSnapGeo,
      "Downgraded to no_trade due to invalid trade geometry after snap",
    ])
  }

  if (
    isStopTooWide(levels.entry, levels.stopLoss, ctx.entryIndicators.atr14)
  ) {
    const atr = ctx.entryIndicators.atr14
    const distance = Math.abs(levels.entry - levels.stopLoss)
    const detail =
      atr != null && atr > 0
        ? `stop distance ${distance.toFixed(2)} exceeds ${MAX_STOP_ATR_MULT}×ATR (${(MAX_STOP_ATR_MULT * atr).toFixed(2)})`
        : "15m ATR unavailable; cannot verify stop width"
    return noTradeResult(proposal, [
      ...warnings,
      `Downgraded to no_trade: ${detail}`,
    ])
  }

  const riskReward = computeRiskReward(
    proposal.side,
    levels.entry,
    levels.stopLoss,
    levels.takeProfit,
  )
  if (riskReward == null || riskReward < MIN_RISK_REWARD) {
    return noTradeResult(proposal, [
      ...warnings,
      `Downgraded to no_trade: reward/risk ${riskReward == null ? "n/a" : riskReward.toFixed(2)} is below ${MIN_RISK_REWARD}`,
    ])
  }

  const sizing = enforcePositionSizing(levels, rules)
  sizing.riskReward = riskReward

  if (sizing.leverageCapped) {
    warnings.push(
      `Leverage capped at ${rules.maxLeverage}x; position size reduced to fit risk rules`,
    )
  }

  return {
    side: proposal.side,
    levels,
    sizing,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    warnings,
  }
}
