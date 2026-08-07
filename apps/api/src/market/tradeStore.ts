import type { Database, Statement } from "bun:sqlite"
import type {
  BtcPositionTestRequest,
  OpenTradeMeta,
  PositionTestHitReason,
  PositionTestInterval,
  PositionTestPriceSource,
  PositionTestStatus,
  SuggestionConfidence,
  TradeHistoryEntry,
} from "@trade/shared"
import type {
  RestoredPositionState,
  TrackedPositionSnapshot,
} from "./positionTracker"

export interface ClosedTradeRecord {
  key: string
  request: BtcPositionTestRequest
  status: "successful" | "failed"
  triggeredAt: number | null
  hitAt: number | null
  hitReason: PositionTestHitReason | null
  priceSource: PositionTestPriceSource
  interval: PositionTestInterval
  meta?: OpenTradeMeta | null
}

interface PositionRow {
  key: string
  since: number
  side: string
  entry: number
  stop_loss: number
  take_profit: number
  status: string
  triggered_at: number | null
  hit_at: number | null
  hit_reason: string | null
}

interface HistoryRow {
  key: string
  recorded_at: number
  status: string
  side: string
  entry: number
  stop_loss: number
  take_profit: number
  since: number
  triggered_at: number | null
  hit_at: number | null
  hit_reason: string | null
  price_source: string
  interval: string
  confidence: string | null
  rationale: string | null
  risk_reward: number | null
  leverage: number | null
  quantity_btc: number | null
  risk_amount_usdt: number | null
  account_balance_usdt: number | null
  max_risk_percent: number | null
  max_leverage: number | null
  bias_4h: string | null
  structure_1h: string | null
}

function normalizePriceSource(value: string): PositionTestPriceSource {
  if (value === "perpetual_ticks" || value === "perpetual_candles") {
    return value
  }
  // Legacy rows may store older price_source strings; map to candles.
  return "perpetual_candles"
}

function normalizeInterval(value: string): PositionTestInterval {
  if (value === "tick" || value === "1m" || value === "15m") {
    return value
  }
  return "1m"
}

function normalizeConfidence(value: string | null): SuggestionConfidence | null {
  if (value === "low" || value === "medium" || value === "high") return value
  return null
}

type MetaLookup = (key: string) => OpenTradeMeta | null
type MetaClear = (key: string) => void

/** SQLite persistence for tracked positions and closed trade history. */
export class TradeStore {
  private upsertPositionStmt: Statement
  private loadPositionsStmt: Statement
  private insertHistoryStmt: Statement
  private listHistoryStmt: Statement
  private clearHistoryStmt: Statement
  private metaLookup: MetaLookup | null = null
  private metaClear: MetaClear | null = null

  constructor(db: Database) {
    this.upsertPositionStmt = db.prepare(`
      INSERT INTO positions (key, since, side, entry, stop_loss, take_profit, status, triggered_at, hit_at, hit_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        status = excluded.status,
        triggered_at = excluded.triggered_at,
        hit_at = excluded.hit_at,
        hit_reason = excluded.hit_reason
    `)
    this.loadPositionsStmt = db.prepare(
      "SELECT key, since, side, entry, stop_loss, take_profit, status, triggered_at, hit_at, hit_reason FROM positions",
    )
    this.insertHistoryStmt = db.prepare(`
      INSERT OR IGNORE INTO trade_history
        (key, recorded_at, status, side, entry, stop_loss, take_profit, since, triggered_at, hit_at, hit_reason, price_source, interval,
         confidence, rationale, risk_reward, leverage, quantity_btc, risk_amount_usdt,
         account_balance_usdt, max_risk_percent, max_leverage, bias_4h, structure_1h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.listHistoryStmt = db.prepare(
      "SELECT * FROM trade_history ORDER BY recorded_at DESC",
    )
    this.clearHistoryStmt = db.prepare("DELETE FROM trade_history")
  }

  /** Wire open-trade meta lookup used when recording closed trades. */
  setMetaHandlers(lookup: MetaLookup, clear: MetaClear): void {
    this.metaLookup = lookup
    this.metaClear = clear
  }

  upsertPosition(snapshot: TrackedPositionSnapshot): void {
    this.upsertPositionStmt.run(
      snapshot.key,
      snapshot.request.since,
      snapshot.request.side,
      snapshot.request.entry,
      snapshot.request.stopLoss,
      snapshot.request.takeProfit,
      snapshot.status,
      snapshot.triggeredAt,
      snapshot.hitAt,
      snapshot.hitReason,
      Date.now(),
    )
  }

  loadPositions(): RestoredPositionState[] {
    const rows = this.loadPositionsStmt.all() as PositionRow[]
    const states: RestoredPositionState[] = []

    for (const row of rows) {
      if (row.side !== "long" && row.side !== "short") continue
      const status = row.status as PositionTestStatus
      if (
        status !== "not_triggered" &&
        status !== "waiting" &&
        status !== "successful" &&
        status !== "failed"
      ) {
        continue
      }

      states.push({
        request: {
          side: row.side,
          entry: row.entry,
          stopLoss: row.stop_loss,
          takeProfit: row.take_profit,
          since: row.since,
        },
        status,
        triggeredAt: row.triggered_at,
        hitAt: row.hit_at,
        hitReason: (row.hit_reason as PositionTestHitReason | null) ?? null,
      })
    }

    return states
  }

  recordClosedTrade(record: ClosedTradeRecord): void {
    const meta = record.meta ?? null
    this.insertHistoryStmt.run(
      record.key,
      Date.now(),
      record.status,
      record.request.side,
      record.request.entry,
      record.request.stopLoss,
      record.request.takeProfit,
      record.request.since,
      record.triggeredAt,
      record.hitAt,
      record.hitReason,
      record.priceSource,
      record.interval,
      meta?.confidence ?? null,
      meta?.rationale ?? null,
      meta?.riskReward ?? null,
      meta?.leverage ?? null,
      meta?.quantityBtc ?? null,
      meta?.riskAmountUsdt ?? null,
      meta?.accountBalanceUsdt ?? null,
      meta?.maxRiskPercent ?? null,
      meta?.maxLeverage ?? null,
      meta?.bias4h ?? null,
      meta?.structure1h ?? null,
    )
  }

  recordFromSnapshot(snapshot: TrackedPositionSnapshot): void {
    if (snapshot.status !== "successful" && snapshot.status !== "failed") return

    const meta = this.metaLookup?.(snapshot.key) ?? null
    this.recordClosedTrade({
      key: snapshot.key,
      request: snapshot.request,
      status: snapshot.status,
      triggeredAt: snapshot.triggeredAt,
      hitAt: snapshot.hitAt,
      hitReason: snapshot.hitReason,
      priceSource:
        snapshot.evidence === "candles" ? "perpetual_candles" : "perpetual_ticks",
      interval: snapshot.evidence === "candles" ? "1m" : "tick",
      meta,
    })
    this.metaClear?.(snapshot.key)
  }

  listHistory(): TradeHistoryEntry[] {
    const rows = this.listHistoryStmt.all() as HistoryRow[]
    return rows.map((row) => ({
      id: row.key,
      recordedAt: row.recorded_at,
      status: row.status === "successful" ? "successful" : "failed",
      side: row.side === "long" ? "long" : "short",
      entry: row.entry,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      since: row.since,
      triggeredAt: row.triggered_at,
      hitAt: row.hit_at,
      hitReason: (row.hit_reason as PositionTestHitReason | null) ?? null,
      priceSource: normalizePriceSource(row.price_source),
      interval: normalizeInterval(row.interval),
      confidence: normalizeConfidence(row.confidence),
      rationale: row.rationale,
      riskReward: row.risk_reward,
      leverage: row.leverage,
      quantityBtc: row.quantity_btc,
      riskAmountUsdt: row.risk_amount_usdt,
      accountBalanceUsdt: row.account_balance_usdt,
      maxRiskPercent: row.max_risk_percent,
      maxLeverage: row.max_leverage,
      bias4h: row.bias_4h,
      structure1h: row.structure_1h,
    }))
  }

  clearHistory(): void {
    this.clearHistoryStmt.run()
  }
}
