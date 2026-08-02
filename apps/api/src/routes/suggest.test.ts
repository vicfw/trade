import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { LlmPositionProposal } from "@trade/shared"

const suggestPosition = mock(
  async (): Promise<LlmPositionProposal> => ({
    side: "long",
    entry: 100_000,
    stopLoss: 98_000,
    takeProfit: 106_000,
    confidence: "high",
    rationale: "4h bull / 1h HL / 15m pullback",
  }),
)

mock.module("../llm/llmClient", () => ({
  llmClient: { suggestPosition, isConfigured: () => true },
  LlmClient: class {},
}))

mock.module("../lbank/client", () => ({
  lbankTickerClient: {
    latest: {
      symbol: "BTCUSDT",
      price: "100000",
      changePercent24h: "1",
      high24h: "101000",
      low24h: "99000",
      volume24h: "10",
      quoteVolume24h: "1000000",
      eventTime: Date.now(),
    },
  },
}))

function makeCandles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    openTime: i * 60_000,
    open: "100000",
    high: "100500",
    low: "99500",
    close: String(100_000 + i),
    volume: "1",
    closeTime: i * 60_000 + 59_999,
    quoteVolume: "100000",
    isClosed: true,
  }))
}

const storeState = {
  empty: false,
}

mock.module("../market/tracking", () => ({
  perpCandleStore: {
    get: () => (storeState.empty ? [] : makeCandles(80)),
    isReady: () => !storeState.empty,
    ensureReady: async () => {},
    backfillFrom1m: () => {},
  },
}))

const originalProvider = process.env.LLM_PROVIDER
const originalGapKey = process.env.GAPGPT_API_KEY
const originalMoonKey = process.env.MOONSHOT_API_KEY
const originalCooldown = process.env.SUGGEST_COOLDOWN_MS

process.env.LLM_PROVIDER = "gapgpt"
process.env.GAPGPT_API_KEY = "test-key"
process.env.SUGGEST_COOLDOWN_MS = "0"

const { resetSuggestGuardsForTests, suggestRoutes } = await import("./suggest")

describe("POST /suggest/btc", () => {
  beforeEach(() => {
    resetSuggestGuardsForTests()
    storeState.empty = false
    suggestPosition.mockClear()
    suggestPosition.mockImplementation(async () => ({
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      confidence: "high",
      rationale: "4h bull / 1h HL / 15m pullback",
    }))
  })

  test("returns sized long suggestion", async () => {
    const res = await suggestRoutes.request("/suggest/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountBalanceUsdt: 10_000,
        maxRiskPercent: 1,
        maxLeverage: 10,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestion.side).toBe("long")
    expect(body.suggestion.levels).toBeTruthy()
    expect(body.suggestion.sizing).toBeTruthy()
    expect(body.suggestion.sizing.riskReward).toBeGreaterThanOrEqual(1.5)
    expect(body.symbol).toBe("BTCUSDT")
    expect(suggestPosition).toHaveBeenCalled()
  })

  test("rejects invalid risk input", async () => {
    const res = await suggestRoutes.request("/suggest/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountBalanceUsdt: -1,
        maxRiskPercent: 1,
        maxLeverage: 10,
      }),
    })
    expect(res.status).toBe(400)
  })

  test("returns 503 when candles empty", async () => {
    storeState.empty = true
    const res = await suggestRoutes.request("/suggest/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountBalanceUsdt: 10_000,
        maxRiskPercent: 1,
        maxLeverage: 10,
      }),
    })
    expect(res.status).toBe(503)
  })

  test("returns no_trade from model", async () => {
    suggestPosition.mockImplementation(async () => ({
      side: "no_trade",
      entry: null,
      stopLoss: null,
      takeProfit: null,
      confidence: "low",
      rationale: "Conflicting bias",
    }))

    const res = await suggestRoutes.request("/suggest/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountBalanceUsdt: 10_000,
        maxRiskPercent: 1,
        maxLeverage: 10,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestion.side).toBe("no_trade")
    expect(body.suggestion.sizing).toBeNull()
  })

  test("downgrades low RR proposal via policy", async () => {
    suggestPosition.mockImplementation(async () => ({
      side: "long",
      entry: 100_000,
      stopLoss: 99_000,
      takeProfit: 100_400,
      confidence: "medium",
      rationale: "Poor RR",
    }))

    const res = await suggestRoutes.request("/suggest/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountBalanceUsdt: 10_000,
        maxRiskPercent: 1,
        maxLeverage: 10,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestion.side).toBe("no_trade")
    expect(
      body.suggestion.warnings.some((w: string) => /reward\/risk/.test(w)),
    ).toBe(true)
  })

  test("returns 502 when LLM fails", async () => {
    suggestPosition.mockImplementation(async () => {
      throw new Error("upstream timeout")
    })

    const res = await suggestRoutes.request("/suggest/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountBalanceUsdt: 10_000,
        maxRiskPercent: 1,
        maxLeverage: 10,
      }),
    })
    expect(res.status).toBe(502)
  })
})

// Restore env for other suites in-process
if (originalProvider === undefined) delete process.env.LLM_PROVIDER
else process.env.LLM_PROVIDER = originalProvider
if (originalGapKey === undefined) delete process.env.GAPGPT_API_KEY
else process.env.GAPGPT_API_KEY = originalGapKey
if (originalMoonKey === undefined) delete process.env.MOONSHOT_API_KEY
else process.env.MOONSHOT_API_KEY = originalMoonKey
if (originalCooldown === undefined) delete process.env.SUGGEST_COOLDOWN_MS
else process.env.SUGGEST_COOLDOWN_MS = originalCooldown
