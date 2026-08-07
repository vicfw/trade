export type TradeSide = "long" | "short" | "no_trade"

export type SuggestionConfidence = "low" | "medium" | "high"

export interface RiskRules {
  accountBalanceUsdt: number
  maxRiskPercent: number
  maxLeverage: number
}

/** Default risk rules for auto-analysis and the web form. */
export const DEFAULT_RISK_RULES: RiskRules = {
  accountBalanceUsdt: 10,
  maxRiskPercent: 1,
  maxLeverage: 5,
}

/** Canonical no_trade rationale shape (Failed + Watch). */
export function formatNoTradeRationale(failed: string, watch: string): string {
  return `Failed: ${failed.trim()}\nWatch: ${watch.trim()}`
}

/** Parse Failed/Watch no_trade rationales; null if the shape is missing. */
export function parseNoTradeRationale(
  text: string,
): { failed: string; watch: string } | null {
  const match = text.match(
    /^\s*Failed:\s*([\s\S]+?)\s+Watch:\s*([\s\S]+?)\s*$/i,
  )
  if (!match?.[1] || !match[2]) return null
  const failed = match[1].trim()
  const watch = match[2].trim()
  if (!failed || !watch) return null
  return { failed, watch }
}

export interface BtcSuggestRequest {
  accountBalanceUsdt: number
  maxRiskPercent: number
  maxLeverage: number
}

/** What the LLM is allowed to output — no size / leverage */
export interface LlmPositionProposal {
  side: TradeSide
  entry: number | null
  stopLoss: number | null
  takeProfit: number | null
  confidence: SuggestionConfidence
  rationale: string
}

export interface PositionLevels {
  entry: number
  stopLoss: number
  takeProfit: number
}

export interface PositionSizing {
  riskAmountUsdt: number
  quantityBtc: number
  notionalUsdt: number
  leverage: number
  riskReward: number | null
  leverageCapped: boolean
}

export interface PositionSuggestion {
  side: TradeSide
  levels: PositionLevels | null
  sizing: PositionSizing | null
  confidence: SuggestionConfidence
  rationale: string
  warnings: string[]
}

export interface BtcSuggestResponse {
  symbol: string
  generatedAt: number
  snapshotAt: number
  suggestion: PositionSuggestion
  market: {
    price: number | null
    bias4h: string
    structure1h: string
  }
}

export type PositionTestStatus =
  | "successful"
  | "failed"
  | "waiting"
  | "not_triggered"

export type PositionTestHitReason = "take_profit" | "stop_loss"

export type PositionTestPriceSource =
  | "perpetual_ticks"
  | "perpetual_candles"

export type PositionTestInterval = "tick" | "1m" | "15m"

/** Check whether a past suggestion's take-profit or stop-loss has been hit since it was made. */
export interface BtcPositionTestRequest {
  side: "long" | "short"
  entry: number
  stopLoss: number
  takeProfit: number
  /** Suggestion `generatedAt` (ms) — the point in time to start scanning candles from. */
  since: number
}

export interface BtcPositionTestResponse {
  status: PositionTestStatus
  side: "long" | "short"
  since: number
  checkedAt: number
  /**
   * When entry first filled (limit-style): long at/below entry, short at/above.
   * From BTCUSDT perpetual ticks or local 1m perp candles.
   */
  triggeredAt: number | null
  /** When take-profit or stop-loss was first touched on perpetual data. */
  hitAt: number | null
  hitReason: PositionTestHitReason | null
  /**
   * `tick` = live BTCUSDT perpetual tracking; `1m` = local perpetual candle
   * record. `15m` may appear on older history rows.
   */
  interval: PositionTestInterval
  priceSource: PositionTestPriceSource
  /** Most recent fresh BTCUSDT perpetual price available to this check. */
  currentPrice: number | null
  candlesChecked: number
  observationsChecked: number
  warnings: string[]
}

export type AnalysisScheduleStatus =
  | "idle"
  | "running"
  | "waiting_interval"
  | "waiting_trade"
  | "error"

export interface AnalysisSchedule {
  status: AnalysisScheduleStatus
  analyzedAt: number | null
  nextAnalysisAt: number | null
  lastError: string | null
}

/** Server-backed current analysis + scheduler state for the web UI. */
export interface BtcAnalysisStatusResponse {
  symbol: string
  suggestion: PositionSuggestion | null
  market: BtcSuggestResponse["market"] | null
  generatedAt: number | null
  snapshotAt: number | null
  /** Risk rules that produced the stored suggestion (null if none yet). */
  riskUsed: RiskRules | null
  /** Risk rules queued for the next analysis run. */
  currentRisk: RiskRules
  schedule: AnalysisSchedule
  /** Live tracker status when the latest suggestion is long/short. */
  openPosition: BtcPositionTestResponse | null
}

/** Metadata captured when a trade is opened, copied into history on close. */
export interface OpenTradeMeta {
  confidence: SuggestionConfidence
  rationale: string
  riskReward: number | null
  leverage: number | null
  quantityBtc: number | null
  riskAmountUsdt: number | null
  accountBalanceUsdt: number
  maxRiskPercent: number
  maxLeverage: number
  bias4h: string
  structure1h: string
}

/** A closed (take-profit or stop-loss) trade outcome kept on the API server. */
export interface TradeHistoryEntry {
  id: string
  recordedAt: number
  status: "successful" | "failed"
  side: "long" | "short"
  entry: number
  stopLoss: number
  takeProfit: number
  /** Suggestion `generatedAt` (ms). */
  since: number
  triggeredAt: number | null
  hitAt: number | null
  hitReason: PositionTestHitReason | null
  priceSource: PositionTestPriceSource
  interval: PositionTestInterval
  confidence: SuggestionConfidence | null
  rationale: string | null
  riskReward: number | null
  leverage: number | null
  quantityBtc: number | null
  riskAmountUsdt: number | null
  accountBalanceUsdt: number | null
  maxRiskPercent: number | null
  maxLeverage: number | null
  bias4h: string | null
  structure1h: string | null
}

export interface BtcTradeHistoryResponse {
  records: TradeHistoryEntry[]
}
