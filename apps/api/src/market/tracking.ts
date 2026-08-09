import { evaluatePositionOutcome } from "@trade/market"
import { config } from "../config"
import { db } from "../db"
import { analysisStore } from "./analysisStore"
import { btcPositionTracker } from "./positionTracker"
import { PerpCandleStore } from "./perpCandleStore"
import { TradeStore } from "./tradeStore"

export const perpCandleStore = new PerpCandleStore(db)
export const tradeStore = new TradeStore(db)

tradeStore.setMetaHandlers(
  (key) => analysisStore.getOpenTradeMeta(key),
  (key) => analysisStore.clearOpenTradeMeta(key),
)

const RECONCILE_EVERY_MS = 60_000

type TradeClosedListener = (key: string) => void
let tradeClosedListener: TradeClosedListener | null = null

/** Called when a tracked position closes (successful/failed/expired). */
export function setOnTradeClosed(listener: TradeClosedListener | null): void {
  tradeClosedListener = listener
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "successful" || status === "failed" || status === "expired"
  )
}

/**
 * Sweep open tracked positions against the stored perp 1m candle record.
 * Catches spikes that fell between ticker updates and any span the API was
 * offline for (candles persist; tick state does not advance while down).
 */
export function reconcileTrackedPositions(now = Date.now()): void {
  btcPositionTracker.expireStaleEntries(now)

  for (const position of btcPositionTracker.list()) {
    if (isTerminalStatus(position.status)) {
      continue
    }

    const coverage = perpCandleStore.coverage(position.request.since, now)
    if (coverage.candles.length === 0 || coverage.coverageStart == null) {
      continue
    }

    // When the candle record starts after `since`, only evaluate the covered
    // span. An entry fill observed on ticks before that span still counts.
    let since = position.request.since
    let alreadyTriggered = false
    if (!coverage.coversSince) {
      since = coverage.coverageStart
      alreadyTriggered =
        position.status === "waiting" &&
        position.triggeredAt != null &&
        position.triggeredAt < coverage.coverageStart
    }

    const outcome = evaluatePositionOutcome(coverage.candles, {
      side: position.request.side,
      entry: position.request.entry,
      stopLoss: position.request.stopLoss,
      takeProfit: position.request.takeProfit,
      since,
      alreadyTriggered,
    })

    btcPositionTracker.applyCandleOutcome(position.request, outcome)
  }
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null

/**
 * Restore persisted positions, wire persistence + history recording, and
 * start the periodic candle reconciliation sweep.
 */
export function initPositionTracking(): void {
  btcPositionTracker.setEntryTimeoutMs(config.entryTimeoutMs)

  btcPositionTracker.setOnUpdate((snapshot) => {
    tradeStore.upsertPosition(snapshot)
    const closed = isTerminalStatus(snapshot.status)
    // Win/loss history only — expired means the limit never filled.
    tradeStore.recordFromSnapshot(snapshot)
    if (snapshot.status === "expired") {
      analysisStore.clearOpenTradeMeta(snapshot.key)
    }
    if (closed) {
      tradeClosedListener?.(snapshot.key)
    }
  })

  btcPositionTracker.restore(tradeStore.loadPositions())
  reconcileTrackedPositions()

  if (!reconcileTimer) {
    reconcileTimer = setInterval(() => {
      try {
        reconcileTrackedPositions()
      } catch (err) {
        console.error(
          "[tracking] reconcile failed:",
          err instanceof Error ? err.message : err,
        )
      }
    }, RECONCILE_EVERY_MS)
  }
}
