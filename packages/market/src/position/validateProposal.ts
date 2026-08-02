import type {
  LlmPositionProposal,
  SuggestionConfidence,
  TradeSide,
} from "@trade/shared"

const SIDES: readonly TradeSide[] = ["long", "short", "no_trade"]
const CONFIDENCES: readonly SuggestionConfidence[] = [
  "low",
  "medium",
  "high",
]

function isTradeSide(value: unknown): value is TradeSide {
  return typeof value === "string" && (SIDES as readonly string[]).includes(value)
}

function isConfidence(value: unknown): value is SuggestionConfidence {
  return (
    typeof value === "string" &&
    (CONFIDENCES as readonly string[]).includes(value)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function optionalFiniteNumber(value: unknown): number | null {
  if (value == null) return null
  if (!isFiniteNumber(value)) {
    throw new Error("Expected a finite number or null for price levels")
  }
  return value
}

/**
 * Parse / validate raw LLM JSON into a typed proposal.
 * Strips unknown fields (leverage, size, etc.).
 */
export function validateLlmProposal(raw: unknown): LlmPositionProposal {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("LLM proposal must be a JSON object")
  }

  const obj = raw as Record<string, unknown>

  if (!isTradeSide(obj.side)) {
    throw new Error(
      `Invalid side "${String(obj.side)}". Expected long | short | no_trade`,
    )
  }

  if (typeof obj.rationale !== "string" || !obj.rationale.trim()) {
    throw new Error("LLM proposal requires a non-empty rationale string")
  }

  const confidence = isConfidence(obj.confidence) ? obj.confidence : "medium"

  const entry = optionalFiniteNumber(obj.entry)
  const stopLoss = optionalFiniteNumber(obj.stopLoss)
  const takeProfit = optionalFiniteNumber(obj.takeProfit)

  if (obj.side === "no_trade") {
    return {
      side: "no_trade",
      entry: null,
      stopLoss: null,
      takeProfit: null,
      confidence,
      rationale: obj.rationale.trim(),
    }
  }

  if (entry == null || stopLoss == null || takeProfit == null) {
    throw new Error(
      `${obj.side} proposal requires finite entry, stopLoss, and takeProfit`,
    )
  }

  return {
    side: obj.side,
    entry,
    stopLoss,
    takeProfit,
    confidence,
    rationale: obj.rationale.trim(),
  }
}

/**
 * Check trade geometry. Returns warning strings; empty = valid.
 */
export function validateTradeGeometry(
  side: TradeSide,
  entry: number | null,
  stopLoss: number | null,
  takeProfit: number | null,
): string[] {
  const warnings: string[] = []

  if (side === "no_trade") return warnings

  if (entry == null || stopLoss == null || takeProfit == null) {
    warnings.push("Missing entry, stop-loss, or take-profit levels")
    return warnings
  }

  if (entry <= 0 || stopLoss <= 0 || takeProfit <= 0) {
    warnings.push("Price levels must be positive")
    return warnings
  }

  if (side === "long") {
    if (!(stopLoss < entry && entry < takeProfit)) {
      warnings.push("Long requires stopLoss < entry < takeProfit")
    }
  } else if (side === "short") {
    if (!(takeProfit < entry && entry < stopLoss)) {
      warnings.push("Short requires takeProfit < entry < stopLoss")
    }
  }

  return warnings
}
