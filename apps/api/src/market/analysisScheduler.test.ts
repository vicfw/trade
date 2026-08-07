process.env.NODE_ENV = "test"
process.env.ANALYSIS_INTERVAL_MS = "7200000"
process.env.ANALYSIS_RETRY_MS = "300000"

import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { BtcSuggestResponse } from "@trade/shared"
import { createSchema } from "../db"

const runSuggestMock = mock(async (): Promise<BtcSuggestResponse> => {
  throw new Error("runSuggest not stubbed")
})

const hasOpenTrackedTradeMock = mock(() => false)
const isSuggestInFlightMock = mock(() => false)

const testDb = new Database(":memory:")
createSchema(testDb)

mock.module("../db", () => ({
  db: testDb,
  createSchema,
  openDatabase: () => testDb,
}))

const { AnalysisStore } = await import("./analysisStore")
const analysisStore = new AnalysisStore(testDb)

mock.module("./analysisStore", () => ({
  AnalysisStore,
  analysisStore,
}))

mock.module("./runSuggest", () => ({
  runSuggest: runSuggestMock,
  hasOpenTrackedTrade: hasOpenTrackedTradeMock,
  isSuggestInFlight: isSuggestInFlightMock,
  SuggestBusyError: class SuggestBusyError extends Error {
    retryAfterSec?: number
    constructor(message: string, retryAfterSec?: number) {
      super(message)
      this.name = "SuggestBusyError"
      this.retryAfterSec = retryAfterSec
    }
  },
  SuggestNotConfiguredError: class SuggestNotConfiguredError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "SuggestNotConfiguredError"
    }
  },
  SuggestNotReadyError: class SuggestNotReadyError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "SuggestNotReadyError"
    }
  },
}))

mock.module("./positionTracker", () => ({
  btcPositionTracker: { list: () => [] },
  positionKey: () => "k",
}))

const { AnalysisScheduler } = await import("./analysisScheduler")

function noTradeResponse(generatedAt: number): BtcSuggestResponse {
  return {
    symbol: "BTCUSDT",
    generatedAt,
    snapshotAt: generatedAt,
    suggestion: {
      side: "no_trade",
      levels: null,
      sizing: null,
      confidence: "low",
      rationale: "Failed: x.\nWatch: y.",
      warnings: [],
    },
    market: { price: 100_000, bias4h: "neutral", structure1h: "range" },
  }
}

function longResponse(generatedAt: number): BtcSuggestResponse {
  return {
    symbol: "BTCUSDT",
    generatedAt,
    snapshotAt: generatedAt,
    suggestion: {
      side: "long",
      levels: { entry: 100_000, stopLoss: 98_000, takeProfit: 104_000 },
      sizing: {
        riskAmountUsdt: 0.1,
        quantityBtc: 0.00005,
        notionalUsdt: 5,
        leverage: 0.5,
        riskReward: 2,
        leverageCapped: false,
      },
      confidence: "high",
      rationale: "aligned",
      warnings: [],
    },
    market: { price: 100_000, bias4h: "bull", structure1h: "uptrend" },
  }
}

describe("AnalysisScheduler", () => {
  beforeEach(() => {
    runSuggestMock.mockReset()
    hasOpenTrackedTradeMock.mockReset()
    isSuggestInFlightMock.mockReset()
    hasOpenTrackedTradeMock.mockReturnValue(false)
    isSuggestInFlightMock.mockReturnValue(false)
    analysisStore.updateSchedule({
      status: "idle",
      nextAnalysisAt: null,
      lastError: null,
    })
  })

  test("no_trade schedules next analysis +2h", async () => {
    const now = 1_700_000_000_000
    runSuggestMock.mockImplementation(async () => {
      const response = noTradeResponse(now)
      analysisStore.saveAnalysis({
        symbol: response.symbol,
        generatedAt: response.generatedAt,
        snapshotAt: response.snapshotAt,
        suggestion: response.suggestion,
        market: response.market,
        riskUsed: {
          accountBalanceUsdt: 10,
          maxRiskPercent: 1,
          maxLeverage: 5,
        },
        scheduleStatus: "waiting_interval",
        nextAnalysisAt: now + 7_200_000,
        lastError: null,
      })
      return response
    })

    const scheduler = new AnalysisScheduler(() => now)
    scheduler.start()
    await Bun.sleep(30)

    const latest = analysisStore.getLatestAnalysis()
    expect(runSuggestMock).toHaveBeenCalled()
    expect(latest.schedule.status).toBe("waiting_interval")
    expect(latest.schedule.nextAnalysisAt).toBe(now + 7_200_000)
  })

  test("open trade blocks bootstrap analysis", async () => {
    hasOpenTrackedTradeMock.mockReturnValue(true)
    const scheduler = new AnalysisScheduler(() => 1_700_000_000_000)
    scheduler.start()
    await Bun.sleep(30)
    expect(runSuggestMock).not.toHaveBeenCalled()
    expect(analysisStore.getLatestAnalysis().schedule.status).toBe(
      "waiting_trade",
    )
  })

  test("trade close queues a new analysis", async () => {
    const now = 1_700_000_000_000
    let clock = now
    runSuggestMock.mockImplementation(async () => {
      const response = longResponse(clock)
      analysisStore.saveAnalysis({
        symbol: response.symbol,
        generatedAt: response.generatedAt,
        snapshotAt: response.snapshotAt,
        suggestion: response.suggestion,
        market: response.market,
        riskUsed: {
          accountBalanceUsdt: 10,
          maxRiskPercent: 1,
          maxLeverage: 5,
        },
        scheduleStatus: "waiting_trade",
        nextAnalysisAt: null,
        lastError: null,
      })
      // Simulate an open tracked trade after the suggest lands.
      hasOpenTrackedTradeMock.mockReturnValue(true)
      return response
    })

    hasOpenTrackedTradeMock.mockReturnValue(true)
    const scheduler = new AnalysisScheduler(() => clock)
    scheduler.start()
    await Bun.sleep(30)
    expect(runSuggestMock).not.toHaveBeenCalled()

    hasOpenTrackedTradeMock.mockReturnValue(false)
    clock = now + 60_000
    scheduler.onTradeClosed()
    await Bun.sleep(30)

    expect(runSuggestMock).toHaveBeenCalled()
    expect(analysisStore.getLatestAnalysis().schedule.status).toBe(
      "waiting_trade",
    )
  })
})
