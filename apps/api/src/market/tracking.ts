import { evaluatePositionOutcome } from "@trade/market"
import { db } from "../db"
import { btcPositionTracker } from "./positionTracker"
import { PerpCandleStore } from "./perpCandleStore"
import { TradeStore } from "./tradeStore"

export const perpCandleStore = new PerpCandleStore(db)
export const tradeStore = new TradeStore(db)

const RECONCILE_EVERY_MS = 60_000

/**
 * Sweep open tracked positions against the stored perp 1m candle record.
 * Catches spikes that fell between ticker updates and any span the API was
 * offline for (candles persist; tick state does not advance while down).
 */
export function reconcileTrackedPositions(now = Date.now()): void {
  for (const position of btcPositionTracker.list()) {
    if (position.status === "successful" || position.status === "failed") {
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
  btcPositionTracker.restore(tradeStore.loadPositions())

  btcPositionTracker.setOnUpdate((snapshot) => {
    tradeStore.upsertPosition(snapshot)
    tradeStore.recordFromSnapshot(snapshot)
  })

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
