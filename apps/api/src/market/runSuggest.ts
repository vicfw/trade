import {
  computeIntervalIndicators,
  finalizeSuggestion,
  validateRiskRules,
} from "@trade/market"
import type {
  BtcSuggestResponse,
  OpenTradeMeta,
  RiskRules,
} from "@trade/shared"
import { config } from "../config"
import { lbankTickerClient } from "../lbank/client"
import { llmClient } from "../llm/llmClient"
import { logLlmSnapshot } from "../llm/logSnapshot"
import { analysisStore } from "./analysisStore"
import {
  buildMarketSnapshot,
  isMarketDataReady,
  MIN_SNAPSHOT_CLOSED_BARS,
} from "./buildSnapshot"
import {
  btcPositionTracker,
  freshPerpObservation,
  positionKey,
} from "./positionTracker"
import { perpCandleStore } from "./tracking"

export class SuggestBusyError extends Error {
  readonly retryAfterSec?: number

  constructor(message: string, retryAfterSec?: number) {
    super(message)
    this.name = "SuggestBusyError"
    this.retryAfterSec = retryAfterSec
  }
}

export class SuggestNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SuggestNotReadyError"
  }
}

export class SuggestNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SuggestNotConfiguredError"
  }
}

let inFlight = false
let lastSuggestAt = 0

/** Test-only: clear rate-limit / in-flight guards between cases. */
export function resetSuggestGuardsForTests(): void {
  inFlight = false
  lastSuggestAt = 0
  btcPositionTracker.clear()
}

export function isSuggestInFlight(): boolean {
  return inFlight
}

export function hasOpenTrackedTrade(): boolean {
  return btcPositionTracker.list().some(
    (position) =>
      position.status === "not_triggered" || position.status === "waiting",
  )
}

export interface RunSuggestOptions {
  risk?: RiskRules
  /** Skip HTTP-facing cooldown (scheduler still serializes via inFlight). */
  skipCooldown?: boolean
}

/**
 * Shared LLM suggest pipeline: snapshot → propose → finalize → track → persist.
 */
export async function runSuggest(
  options: RunSuggestOptions = {},
): Promise<BtcSuggestResponse> {
  if (!llmClient.isConfigured()) {
    throw new SuggestNotConfiguredError(
      `LLM not configured. Set ${config.llm.apiKeyEnv} for provider "${config.llm.provider}".`,
    )
  }

  if (inFlight) {
    throw new SuggestBusyError(
      "A suggestion request is already in progress. Try again shortly.",
    )
  }

  if (!options.skipCooldown) {
    const sinceLast = Date.now() - lastSuggestAt
    if (lastSuggestAt > 0 && sinceLast < config.suggestCooldownMs) {
      const retryAfterSec = Math.ceil(
        (config.suggestCooldownMs - sinceLast) / 1000,
      )
      throw new SuggestBusyError(
        `Please wait ${retryAfterSec}s before requesting another suggestion.`,
        retryAfterSec,
      )
    }
  }

  if (hasOpenTrackedTrade()) {
    throw new SuggestBusyError(
      "An open trade is still being tracked. Wait for take-profit, stop-loss, or entry timeout before analyzing again.",
    )
  }

  // Claim the lock before any await so concurrent callers cannot double-run.
  inFlight = true
  const startedAt = Date.now()

  try {
    const risk = options.risk
      ? validateRiskRules(options.risk)
      : analysisStore.getRisk()

    await perpCandleStore.ensureReady(
      config.candleIntervals,
      MIN_SNAPSHOT_CLOSED_BARS,
    )

    const snapshot = buildMarketSnapshot({
      symbol: config.tickerSymbol,
      intervals: config.candleIntervals,
      getCandles: (interval) => perpCandleStore.get(interval),
      ticker: lbankTickerClient.latest,
      candleWindow: config.llmCandleWindow,
    })

    if (!isMarketDataReady(snapshot)) {
      const detail =
        snapshot.warnings.length > 0
          ? ` ${snapshot.warnings.join("; ")}.`
          : ""
      throw new SuggestNotReadyError(
        `Perp market data not ready. Need at least ${MIN_SNAPSHOT_CLOSED_BARS} closed bars per timeframe (15m / 1h / 4h) from the futures WS or 1m aggregation.${detail}`,
      )
    }

    console.log(
      `[suggest] start provider=${config.llm.provider} model=${config.llm.model} timeoutMs=${config.llmTimeoutMs} price=${snapshot.ticker.price} bias4h=${snapshot.context.bias4h} structure1h=${snapshot.context.structure1h}`,
    )

    logLlmSnapshot(snapshot)
    const proposal = await llmClient.suggestPosition(snapshot)
    const entryTf = snapshot.intervals.find((item) => item.interval === "15m")
    const suggestion = finalizeSuggestion(proposal, risk, {
      bias4h: snapshot.context.bias4h,
      structure1h: snapshot.context.structure1h,
      entryIndicators: entryTf?.indicators ?? computeIntervalIndicators([]),
      livePrice: snapshot.ticker.price,
    })

    lastSuggestAt = Date.now()
    let trackedAlreadyClosed = false

    if (
      (suggestion.side === "long" || suggestion.side === "short") &&
      suggestion.levels
    ) {
      const livePerp = freshPerpObservation(
        lbankTickerClient.latest,
        lastSuggestAt,
      )
      const request = {
        side: suggestion.side,
        entry: suggestion.levels.entry,
        stopLoss: suggestion.levels.stopLoss,
        takeProfit: suggestion.levels.takeProfit,
        since: lastSuggestAt,
      }
      const tracked = btcPositionTracker.track(
        request,
        livePerp
          ? { price: livePerp.price, observedAt: lastSuggestAt }
          : undefined,
      )
      trackedAlreadyClosed =
        tracked.status === "successful" || tracked.status === "failed"

      const meta: OpenTradeMeta = {
        confidence: suggestion.confidence,
        rationale: suggestion.rationale,
        riskReward: suggestion.sizing?.riskReward ?? null,
        leverage: suggestion.sizing?.leverage ?? null,
        quantityBtc: suggestion.sizing?.quantityBtc ?? null,
        riskAmountUsdt: suggestion.sizing?.riskAmountUsdt ?? null,
        accountBalanceUsdt: risk.accountBalanceUsdt,
        maxRiskPercent: risk.maxRiskPercent,
        maxLeverage: risk.maxLeverage,
        bias4h: snapshot.context.bias4h,
        structure1h: snapshot.context.structure1h,
      }
      analysisStore.setOpenTradeMeta(positionKey(request), meta)
    }

    const response: BtcSuggestResponse = {
      symbol: config.tickerSymbol,
      generatedAt: lastSuggestAt,
      snapshotAt: snapshot.snapshotAt,
      suggestion,
      market: {
        price: snapshot.ticker.price,
        bias4h: snapshot.context.bias4h,
        structure1h: snapshot.context.structure1h,
      },
    }

    const isTrade =
      suggestion.side === "long" || suggestion.side === "short"
    let scheduleStatus: "waiting_interval" | "waiting_trade"
    let nextAnalysisAt: number | null
    if (!isTrade) {
      scheduleStatus = "waiting_interval"
      nextAnalysisAt = lastSuggestAt + config.analysisIntervalMs
    } else if (trackedAlreadyClosed) {
      // Entry+exit in the same observation — queue the next run immediately.
      scheduleStatus = "waiting_interval"
      nextAnalysisAt = lastSuggestAt
    } else {
      scheduleStatus = "waiting_trade"
      nextAnalysisAt = null
    }

    analysisStore.saveAnalysis({
      symbol: response.symbol,
      generatedAt: response.generatedAt,
      snapshotAt: response.snapshotAt,
      suggestion: response.suggestion,
      market: response.market,
      riskUsed: risk,
      scheduleStatus,
      nextAnalysisAt,
      lastError: null,
    })

    console.log(
      `[suggest] ok elapsedMs=${Date.now() - startedAt} side=${suggestion.side} confidence=${suggestion.confidence} warnings=${suggestion.warnings.length}`,
    )
    return response
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Suggestion request failed"
    console.error(
      `[suggest] failed elapsedMs=${Date.now() - startedAt} provider=${config.llm.provider} model=${config.llm.model}: ${message}`,
    )
    throw err instanceof Error ? err : new Error(message)
  } finally {
    inFlight = false
  }
}
