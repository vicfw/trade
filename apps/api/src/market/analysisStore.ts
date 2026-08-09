import type { Database, Statement } from "bun:sqlite"
import {
  DEFAULT_RISK_RULES,
  type AnalysisSchedule,
  type AnalysisScheduleStatus,
  type BtcSuggestResponse,
  type OpenTradeMeta,
  type PositionSuggestion,
  type RiskRules,
} from "@trade/shared"
import { db } from "../db"

export interface LatestAnalysisRecord {
  symbol: string
  generatedAt: number | null
  snapshotAt: number | null
  suggestion: PositionSuggestion | null
  market: BtcSuggestResponse["market"] | null
  riskUsed: RiskRules | null
  schedule: AnalysisSchedule
}

interface RiskRow {
  account_balance_usdt: number
  max_risk_percent: number
  max_leverage: number
}

interface AnalysisRow {
  symbol: string
  generated_at: number | null
  snapshot_at: number | null
  suggestion_json: string | null
  market_json: string | null
  risk_used_json: string | null
  schedule_status: string
  next_analysis_at: number | null
  last_error: string | null
}

interface MetaRow {
  key: string
  meta_json: string
}

function parseJson<T>(raw: string | null): T | null {
  if (raw == null || raw === "") return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function normalizeScheduleStatus(value: string): AnalysisScheduleStatus {
  switch (value) {
    case "idle":
    case "running":
    case "waiting_interval":
    case "waiting_window":
    case "waiting_trade":
    case "error":
      return value
    default:
      return "idle"
  }
}

function defaultRiskFromEnv(): RiskRules {
  const balance = Number(process.env.DEFAULT_ACCOUNT_BALANCE_USDT)
  const risk = Number(process.env.DEFAULT_MAX_RISK_PERCENT)
  const leverage = Number(process.env.DEFAULT_MAX_LEVERAGE)
  return {
    accountBalanceUsdt:
      Number.isFinite(balance) && balance > 0
        ? balance
        : DEFAULT_RISK_RULES.accountBalanceUsdt,
    maxRiskPercent:
      Number.isFinite(risk) && risk > 0 && risk <= 100
        ? risk
        : DEFAULT_RISK_RULES.maxRiskPercent,
    maxLeverage:
      Number.isFinite(leverage) && leverage >= 1
        ? leverage
        : DEFAULT_RISK_RULES.maxLeverage,
  }
}

/** SQLite persistence for risk settings, latest analysis, and open-trade meta. */
export class AnalysisStore {
  private getRiskStmt: Statement
  private upsertRiskStmt: Statement
  private getAnalysisStmt: Statement
  private upsertAnalysisStmt: Statement
  private upsertMetaStmt: Statement
  private getMetaStmt: Statement
  private deleteMetaStmt: Statement

  constructor(private readonly db: Database) {
    this.getRiskStmt = db.prepare(
      "SELECT account_balance_usdt, max_risk_percent, max_leverage FROM risk_settings WHERE id = 1",
    )
    this.upsertRiskStmt = db.prepare(`
      INSERT INTO risk_settings (id, account_balance_usdt, max_risk_percent, max_leverage, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_balance_usdt = excluded.account_balance_usdt,
        max_risk_percent = excluded.max_risk_percent,
        max_leverage = excluded.max_leverage,
        updated_at = excluded.updated_at
    `)
    this.getAnalysisStmt = db.prepare(
      "SELECT symbol, generated_at, snapshot_at, suggestion_json, market_json, risk_used_json, schedule_status, next_analysis_at, last_error FROM latest_analysis WHERE id = 1",
    )
    this.upsertAnalysisStmt = db.prepare(`
      INSERT INTO latest_analysis (
        id, symbol, generated_at, snapshot_at, suggestion_json, market_json,
        risk_used_json, schedule_status, next_analysis_at, last_error, updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        symbol = excluded.symbol,
        generated_at = excluded.generated_at,
        snapshot_at = excluded.snapshot_at,
        suggestion_json = excluded.suggestion_json,
        market_json = excluded.market_json,
        risk_used_json = excluded.risk_used_json,
        schedule_status = excluded.schedule_status,
        next_analysis_at = excluded.next_analysis_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `)
    this.upsertMetaStmt = db.prepare(`
      INSERT INTO open_trade_meta (key, meta_json, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        meta_json = excluded.meta_json,
        created_at = excluded.created_at
    `)
    this.getMetaStmt = db.prepare(
      "SELECT key, meta_json FROM open_trade_meta WHERE key = ?",
    )
    this.deleteMetaStmt = db.prepare("DELETE FROM open_trade_meta WHERE key = ?")

    this.ensureRiskSeeded()
    this.ensureAnalysisSeeded()
  }

  private ensureRiskSeeded(): void {
    if (this.getRiskStmt.get()) return
    const risk = defaultRiskFromEnv()
    this.upsertRiskStmt.run(
      risk.accountBalanceUsdt,
      risk.maxRiskPercent,
      risk.maxLeverage,
      Date.now(),
    )
  }

  private ensureAnalysisSeeded(): void {
    if (this.getAnalysisStmt.get()) return
    this.upsertAnalysisStmt.run(
      "BTCUSDT",
      null,
      null,
      null,
      null,
      null,
      "idle",
      null,
      null,
      Date.now(),
    )
  }

  getRisk(): RiskRules {
    const row = this.getRiskStmt.get() as RiskRow | null
    if (!row) return { ...DEFAULT_RISK_RULES }
    return {
      accountBalanceUsdt: row.account_balance_usdt,
      maxRiskPercent: row.max_risk_percent,
      maxLeverage: row.max_leverage,
    }
  }

  setRisk(risk: RiskRules): RiskRules {
    this.upsertRiskStmt.run(
      risk.accountBalanceUsdt,
      risk.maxRiskPercent,
      risk.maxLeverage,
      Date.now(),
    )
    return this.getRisk()
  }

  getLatestAnalysis(): LatestAnalysisRecord {
    const row = this.getAnalysisStmt.get() as AnalysisRow | null
    if (!row) {
      return {
        symbol: "BTCUSDT",
        generatedAt: null,
        snapshotAt: null,
        suggestion: null,
        market: null,
        riskUsed: null,
        schedule: {
          status: "idle",
          analyzedAt: null,
          nextAnalysisAt: null,
          lastError: null,
        },
      }
    }

    return {
      symbol: row.symbol,
      generatedAt: row.generated_at,
      snapshotAt: row.snapshot_at,
      suggestion: parseJson<PositionSuggestion>(row.suggestion_json),
      market: parseJson<BtcSuggestResponse["market"]>(row.market_json),
      riskUsed: parseJson<RiskRules>(row.risk_used_json),
      schedule: {
        status: normalizeScheduleStatus(row.schedule_status),
        analyzedAt: row.generated_at,
        nextAnalysisAt: row.next_analysis_at,
        lastError: row.last_error,
      },
    }
  }

  saveAnalysis(input: {
    symbol: string
    generatedAt: number
    snapshotAt: number
    suggestion: PositionSuggestion
    market: BtcSuggestResponse["market"]
    riskUsed: RiskRules
    scheduleStatus: AnalysisScheduleStatus
    nextAnalysisAt: number | null
    lastError?: string | null
  }): void {
    this.upsertAnalysisStmt.run(
      input.symbol,
      input.generatedAt,
      input.snapshotAt,
      JSON.stringify(input.suggestion),
      JSON.stringify(input.market),
      JSON.stringify(input.riskUsed),
      input.scheduleStatus,
      input.nextAnalysisAt,
      input.lastError ?? null,
      Date.now(),
    )
  }

  updateSchedule(input: {
    status: AnalysisScheduleStatus
    nextAnalysisAt?: number | null
    lastError?: string | null
  }): void {
    const current = this.getLatestAnalysis()
    this.upsertAnalysisStmt.run(
      current.symbol,
      current.generatedAt,
      current.snapshotAt,
      current.suggestion ? JSON.stringify(current.suggestion) : null,
      current.market ? JSON.stringify(current.market) : null,
      current.riskUsed ? JSON.stringify(current.riskUsed) : null,
      input.status,
      input.nextAnalysisAt !== undefined
        ? input.nextAnalysisAt
        : current.schedule.nextAnalysisAt,
      input.lastError !== undefined
        ? input.lastError
        : current.schedule.lastError,
      Date.now(),
    )
  }

  setOpenTradeMeta(key: string, meta: OpenTradeMeta): void {
    this.upsertMetaStmt.run(key, JSON.stringify(meta), Date.now())
  }

  getOpenTradeMeta(key: string): OpenTradeMeta | null {
    const row = this.getMetaStmt.get(key) as MetaRow | null
    if (!row) return null
    return parseJson<OpenTradeMeta>(row.meta_json)
  }

  clearOpenTradeMeta(key: string): void {
    this.deleteMetaStmt.run(key)
  }
}

export const analysisStore = new AnalysisStore(db)
