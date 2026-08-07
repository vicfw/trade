import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { DEFAULT_RISK_RULES, type OpenTradeMeta } from "@trade/shared"
import { createSchema } from "../db"
import { AnalysisStore } from "../market/analysisStore"
import { TradeStore } from "../market/tradeStore"

function openTestDb() {
  const db = new Database(":memory:")
  createSchema(db)
  return db
}

describe("AnalysisStore", () => {
  let store: AnalysisStore

  beforeEach(() => {
    store = new AnalysisStore(openTestDb())
  })

  test("seeds default risk settings", () => {
    expect(store.getRisk()).toEqual(DEFAULT_RISK_RULES)
  })

  test("persists risk settings round-trip", () => {
    const saved = store.setRisk({
      accountBalanceUsdt: 25,
      maxRiskPercent: 2,
      maxLeverage: 3,
    })
    expect(saved).toEqual({
      accountBalanceUsdt: 25,
      maxRiskPercent: 2,
      maxLeverage: 3,
    })
    expect(store.getRisk()).toEqual(saved)
  })

  test("persists latest analysis and schedule", () => {
    store.saveAnalysis({
      symbol: "BTCUSDT",
      generatedAt: 1_700_000_000_000,
      snapshotAt: 1_700_000_000_000,
      suggestion: {
        side: "no_trade",
        levels: null,
        sizing: null,
        confidence: "low",
        rationale: "Failed: chop.\nWatch: wait.",
        warnings: [],
      },
      market: { price: 100_000, bias4h: "bull", structure1h: "range" },
      riskUsed: DEFAULT_RISK_RULES,
      scheduleStatus: "waiting_interval",
      nextAnalysisAt: 1_700_007_200_000,
      lastError: null,
    })

    const latest = store.getLatestAnalysis()
    expect(latest.suggestion?.side).toBe("no_trade")
    expect(latest.riskUsed).toEqual(DEFAULT_RISK_RULES)
    expect(latest.schedule.status).toBe("waiting_interval")
    expect(latest.schedule.nextAnalysisAt).toBe(1_700_007_200_000)
  })

  test("open trade meta round-trip", () => {
    const meta: OpenTradeMeta = {
      confidence: "high",
      rationale: "clean long",
      riskReward: 2,
      leverage: 5,
      quantityBtc: 0.001,
      riskAmountUsdt: 0.1,
      accountBalanceUsdt: 10,
      maxRiskPercent: 1,
      maxLeverage: 5,
      bias4h: "bull",
      structure1h: "uptrend",
    }
    store.setOpenTradeMeta("pos-1", meta)
    expect(store.getOpenTradeMeta("pos-1")).toEqual(meta)
    store.clearOpenTradeMeta("pos-1")
    expect(store.getOpenTradeMeta("pos-1")).toBeNull()
  })
})

describe("TradeStore history enrichment", () => {
  test("records enriched closed trade fields", () => {
    const db = openTestDb()
    const analysis = new AnalysisStore(db)
    const trades = new TradeStore(db)
    trades.setMetaHandlers(
      (key) => analysis.getOpenTradeMeta(key),
      (key) => analysis.clearOpenTradeMeta(key),
    )

    const meta: OpenTradeMeta = {
      confidence: "medium",
      rationale: "setup",
      riskReward: 1.8,
      leverage: 4,
      quantityBtc: 0.002,
      riskAmountUsdt: 0.2,
      accountBalanceUsdt: 10,
      maxRiskPercent: 1,
      maxLeverage: 5,
      bias4h: "bull",
      structure1h: "uptrend",
    }
    analysis.setOpenTradeMeta("k1", meta)

    trades.recordClosedTrade({
      key: "k1",
      request: {
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 104_000,
        since: 1_700_000_000_000,
      },
      status: "successful",
      triggeredAt: 1_700_000_100_000,
      hitAt: 1_700_000_200_000,
      hitReason: "take_profit",
      priceSource: "perpetual_ticks",
      interval: "tick",
      meta,
    })

    const rows = trades.listHistory()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.confidence).toBe("medium")
    expect(row.riskReward).toBe(1.8)
    expect(row.leverage).toBe(4)
    expect(row.quantityBtc).toBe(0.002)
    expect(row.accountBalanceUsdt).toBe(10)
    expect(row.bias4h).toBe("bull")
    expect(row.structure1h).toBe("uptrend")
    expect(row.rationale).toBe("setup")
  })
})
