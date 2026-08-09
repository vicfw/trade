import type {
  AnalysisScheduleStatus,
  BtcAnalysisStatusResponse,
  BtcPositionTestResponse,
} from "@trade/shared"
import { config } from "../config"
import { analysisStore } from "./analysisStore"
import {
  clampToAnalysisWindow,
  isWithinAnalysisWindow,
  type AnalysisWindowOptions,
} from "./analysisWindow"
import {
  btcPositionTracker,
  positionKey,
  type TrackedPositionSnapshot,
} from "./positionTracker"
import {
  hasOpenTrackedTrade,
  isSuggestInFlight,
  runSuggest,
  SuggestBusyError,
  SuggestNotConfiguredError,
  SuggestNotReadyError,
} from "./runSuggest"

function snapshotToOpenPosition(
  snapshot: TrackedPositionSnapshot,
): BtcPositionTestResponse {
  return {
    status: snapshot.status,
    side: snapshot.request.side,
    since: snapshot.request.since,
    checkedAt: Date.now(),
    triggeredAt: snapshot.triggeredAt,
    hitAt: snapshot.hitAt,
    hitReason: snapshot.hitReason,
    interval: snapshot.evidence === "candles" ? "1m" : "tick",
    priceSource:
      snapshot.evidence === "candles" ? "perpetual_candles" : "perpetual_ticks",
    currentPrice: snapshot.currentPrice,
    candlesChecked: 0,
    observationsChecked: snapshot.observationsChecked,
    warnings: [],
  }
}

/** Resolve live open-position status for the latest long/short suggestion. */
export function resolveOpenPosition(): BtcPositionTestResponse | null {
  const latest = analysisStore.getLatestAnalysis()
  const suggestion = latest.suggestion
  if (
    !suggestion ||
    (suggestion.side !== "long" && suggestion.side !== "short") ||
    !suggestion.levels ||
    latest.generatedAt == null
  ) {
    return null
  }

  const request = {
    side: suggestion.side,
    entry: suggestion.levels.entry,
    stopLoss: suggestion.levels.stopLoss,
    takeProfit: suggestion.levels.takeProfit,
    since: latest.generatedAt,
  }
  const match = btcPositionTracker
    .list()
    .find((item) => item.key === positionKey(request))
  return match ? snapshotToOpenPosition(match) : null
}

export function buildAnalysisStatusResponse(): BtcAnalysisStatusResponse {
  const latest = analysisStore.getLatestAnalysis()
  const schedule = { ...latest.schedule }

  // Reflect in-flight LLM as running for the UI even if DB hasn't flipped yet.
  if (isSuggestInFlight()) {
    schedule.status = "running"
  }

  const openPosition =
    latest.suggestion?.side === "long" || latest.suggestion?.side === "short"
      ? resolveOpenPosition()
      : null

  return {
    symbol: latest.symbol || config.tickerSymbol,
    suggestion: latest.suggestion,
    market: latest.market,
    generatedAt: latest.generatedAt,
    snapshotAt: latest.snapshotAt,
    riskUsed: latest.riskUsed,
    currentRisk: analysisStore.getRisk(),
    schedule,
    openPosition,
  }
}

type Clock = () => number

function windowOptions(): AnalysisWindowOptions {
  return {
    timeZone: config.analysisTz,
    start: config.analysisWindowStart,
    end: config.analysisWindowEnd,
  }
}

export class AnalysisScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private readonly now: Clock

  constructor(now: Clock = () => Date.now()) {
    this.now = now
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.bootstrap()
  }

  /** Invoked when a tracked trade closes. */
  onTradeClosed(): void {
    if (!this.started) return
    // Closures during an in-flight suggest are handled by runCycle after saveAnalysis.
    if (isSuggestInFlight()) return
    if (hasOpenTrackedTrade()) {
      analysisStore.updateSchedule({
        status: "waiting_trade",
        nextAnalysisAt: null,
        lastError: null,
      })
      return
    }

    console.log("[analysis] trade closed — queueing next analysis")
    this.scheduleNext(this.now())
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private armTimer(atMs: number): void {
    this.clearTimer()
    const delay = Math.max(0, atMs - this.now())
    this.timer = setTimeout(() => {
      void this.runCycle()
    }, delay)
  }

  /**
   * Clamp `atMs` into the analysis window, persist schedule status, and arm.
   * Uses `waiting_window` when the requested time is outside the window.
   */
  private scheduleNext(
    atMs: number,
    opts?: { lastError?: string | null; preferErrorStatus?: boolean },
  ): number {
    const options = windowOptions()
    // Never arm from a stale past timestamp (clamp is relative to atMs's day).
    const target = Math.max(atMs, this.now())
    const clamped = clampToAnalysisWindow(target, options)
    const wasOutside = !isWithinAnalysisWindow(target, options)

    let status: AnalysisScheduleStatus
    if (opts?.preferErrorStatus) {
      status = "error"
    } else if (wasOutside) {
      status = "waiting_window"
    } else if (clamped <= this.now()) {
      status = "idle"
    } else {
      status = "waiting_interval"
    }

    analysisStore.updateSchedule({
      status,
      nextAnalysisAt: clamped,
      lastError: opts?.lastError !== undefined ? opts.lastError : null,
    })
    this.armTimer(clamped)
    return clamped
  }

  private bootstrap(): void {
    if (hasOpenTrackedTrade()) {
      analysisStore.updateSchedule({
        status: "waiting_trade",
        nextAnalysisAt: null,
        lastError: null,
      })
      console.log("[analysis] bootstrap: waiting for open trade to resolve")
      return
    }

    const latest = analysisStore.getLatestAnalysis()
    const nextAt = latest.schedule.nextAnalysisAt
    if (nextAt != null && nextAt > this.now()) {
      const clamped = this.scheduleNext(nextAt)
      console.log(
        `[analysis] bootstrap: next run in ${Math.round((clamped - this.now()) / 1000)}s`,
      )
      return
    }

    console.log("[analysis] bootstrap: queueing analysis")
    this.scheduleNext(this.now())
  }

  private async runCycle(): Promise<void> {
    if (isSuggestInFlight()) {
      this.armTimer(this.now() + 5_000)
      return
    }

    if (hasOpenTrackedTrade()) {
      this.clearTimer()
      analysisStore.updateSchedule({
        status: "waiting_trade",
        nextAnalysisAt: null,
        lastError: null,
      })
      return
    }

    const options = windowOptions()
    if (!isWithinAnalysisWindow(this.now(), options)) {
      const nextAt = this.scheduleNext(this.now())
      console.log(
        `[analysis] outside window — next at ${new Date(nextAt).toISOString()}`,
      )
      return
    }

    analysisStore.updateSchedule({
      status: "running",
      lastError: null,
    })

    try {
      const response = await runSuggest({
        skipCooldown: true,
      })

      if (response.suggestion.side === "no_trade") {
        const nextAt = this.scheduleNext(
          response.generatedAt + config.analysisIntervalMs,
        )
        console.log(
          `[analysis] no_trade — next at ${new Date(nextAt).toISOString()}`,
        )
        return
      }

      if (hasOpenTrackedTrade()) {
        this.clearTimer()
        console.log(
          `[analysis] trade ${response.suggestion.side} — waiting for outcome`,
        )
        return
      }

      // Trade opened and already closed (or never stayed open) — run again soon.
      console.log(
        `[analysis] trade ${response.suggestion.side} already resolved — queueing next analysis`,
      )
      this.scheduleNext(this.now())
    } catch (err) {
      const deferred =
        err instanceof SuggestNotConfiguredError ||
        err instanceof SuggestNotReadyError ||
        err instanceof SuggestBusyError
      const message =
        err instanceof Error ? err.message : "Analysis run failed"
      const retryAt =
        this.now() +
        (deferred
          ? Math.min(config.analysisRetryMs, 60_000)
          : config.analysisRetryMs)
      this.scheduleNext(retryAt, {
        lastError: message,
        preferErrorStatus: true,
      })
      console.error(
        `[analysis] ${deferred ? "deferred" : "failed"}: ${message}`,
      )
    }
  }
}

export const analysisScheduler = new AnalysisScheduler()
