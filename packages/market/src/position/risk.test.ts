import { describe, expect, test } from "bun:test"
import {
  computeRiskReward,
  enforcePositionSizing,
  finalizeSuggestion,
  validateRiskRules,
  type FinalizeSuggestionContext,
} from "./risk"
import { validateLlmProposal, validateTradeGeometry } from "./validateProposal"
import type { LlmPositionProposal } from "@trade/shared"

const neutralCtx: FinalizeSuggestionContext = {
  bias4h: "neutral",
  structure1h: "unclear",
  entryIndicators: {
    ema20: null,
    ema50: null,
    ema200: null,
    rsi14: null,
    atr14: null,
    lastClose: null,
    openTime: null,
    swings: [],
  },
}

describe("validateLlmProposal", () => {
  test("accepts a valid long proposal", () => {
    const proposal = validateLlmProposal({
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      confidence: "high",
      rationale: "4h bull, 1h HL, 15m pullback",
      leverage: 50,
      quantity: 999,
    })

    expect(proposal.side).toBe("long")
    expect(proposal.entry).toBe(100_000)
    expect(proposal).not.toHaveProperty("leverage")
  })

  test("no_trade clears levels", () => {
    const proposal = validateLlmProposal({
      side: "no_trade",
      entry: 1,
      stopLoss: 2,
      takeProfit: 3,
      rationale: "Choppy range",
    })
    expect(proposal.entry).toBeNull()
    expect(proposal.stopLoss).toBeNull()
    expect(proposal.takeProfit).toBeNull()
    expect(proposal.confidence).toBe("medium")
  })

  test("rejects missing rationale", () => {
    expect(() =>
      validateLlmProposal({
        side: "no_trade",
        rationale: "  ",
      }),
    ).toThrow(/rationale/)
  })

  test("rejects long without levels", () => {
    expect(() =>
      validateLlmProposal({
        side: "long",
        entry: null,
        stopLoss: null,
        takeProfit: null,
        rationale: "Missing levels",
      }),
    ).toThrow(/requires finite/)
  })
})

describe("validateTradeGeometry", () => {
  test("long requires SL < entry < TP", () => {
    expect(validateTradeGeometry("long", 100, 98, 110)).toEqual([])
    expect(validateTradeGeometry("long", 100, 102, 110).length).toBeGreaterThan(
      0,
    )
  })

  test("short requires TP < entry < SL", () => {
    expect(validateTradeGeometry("short", 100, 105, 90)).toEqual([])
    expect(
      validateTradeGeometry("short", 100, 90, 105).length,
    ).toBeGreaterThan(0)
  })
})

describe("computeRiskReward", () => {
  test("long RR", () => {
    expect(computeRiskReward("long", 100_000, 98_000, 106_000)).toBeCloseTo(
      3,
      10,
    )
  })

  test("short RR", () => {
    expect(computeRiskReward("short", 100_000, 102_000, 94_000)).toBeCloseTo(
      3,
      10,
    )
  })
})

describe("enforcePositionSizing", () => {
  test("sizes from stop distance", () => {
    const sizing = enforcePositionSizing(
      { entry: 100_000, stopLoss: 98_000, takeProfit: 106_000 },
      { accountBalanceUsdt: 10_000, maxRiskPercent: 1, maxLeverage: 10 },
    )

    expect(sizing.riskAmountUsdt).toBeCloseTo(100, 8)
    expect(sizing.quantityBtc).toBeCloseTo(0.05, 10)
    expect(sizing.notionalUsdt).toBeCloseTo(5_000, 8)
    expect(sizing.leverage).toBeCloseTo(0.5, 10)
    expect(sizing.leverageCapped).toBe(false)
  })

  test("caps leverage and reduces quantity", () => {
    const sizing = enforcePositionSizing(
      { entry: 100_000, stopLoss: 99_900, takeProfit: 100_500 },
      { accountBalanceUsdt: 10_000, maxRiskPercent: 1, maxLeverage: 2 },
    )

    expect(sizing.leverageCapped).toBe(true)
    expect(sizing.notionalUsdt).toBeCloseTo(20_000, 8)
    expect(sizing.leverage).toBeCloseTo(2, 10)
    expect(sizing.quantityBtc).toBeCloseTo(0.2, 10)
    expect(sizing.riskAmountUsdt).toBeCloseTo(20, 8)
  })
})

describe("validateRiskRules", () => {
  test("accepts valid rules", () => {
    expect(
      validateRiskRules({
        accountBalanceUsdt: 5000,
        maxRiskPercent: 1.5,
        maxLeverage: 5,
      }),
    ).toEqual({
      accountBalanceUsdt: 5000,
      maxRiskPercent: 1.5,
      maxLeverage: 5,
    })
  })

  test("rejects bad balance", () => {
    expect(() =>
      validateRiskRules({
        accountBalanceUsdt: 0,
        maxRiskPercent: 1,
        maxLeverage: 5,
      }),
    ).toThrow(/accountBalanceUsdt/)
  })
})

describe("finalizeSuggestion", () => {
  const rules = {
    accountBalanceUsdt: 10_000,
    maxRiskPercent: 1,
    maxLeverage: 10,
  }

  /** ≥2 long signals; ATR large enough that typical stops stay within 2×ATR. */
  const longReadyCtx: FinalizeSuggestionContext = {
    bias4h: "neutral",
    structure1h: "unclear",
    entryIndicators: {
      ema20: 99_000,
      ema50: 98_000,
      ema200: 97_000,
      rsi14: 55,
      atr14: 2_000,
      lastClose: 100_000,
      openTime: 1,
      swings: [
        { kind: "low", index: 1, openTime: 1, price: 99_000 },
        { kind: "high", index: 2, openTime: 2, price: 103_000 },
      ],
    },
  }

  test("long with sizing", () => {
    const proposal: LlmPositionProposal = {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      confidence: "high",
      rationale: "Setup aligned",
    }
    const result = finalizeSuggestion(proposal, rules, longReadyCtx)
    expect(result.side).toBe("long")
    expect(result.levels?.entry).toBe(100_000)
    expect(result.sizing?.riskReward).toBeGreaterThanOrEqual(1.5)
    expect(result.sizing?.quantityBtc).toBeGreaterThan(0)
  })

  test("invalid geometry becomes no_trade", () => {
    const proposal: LlmPositionProposal = {
      side: "long",
      entry: 100_000,
      stopLoss: 102_000,
      takeProfit: 106_000,
      confidence: "low",
      rationale: "Bad SL",
    }
    const result = finalizeSuggestion(proposal, rules, neutralCtx)
    expect(result.side).toBe("no_trade")
    expect(result.levels).toBeNull()
    expect(result.sizing).toBeNull()
    expect(result.warnings.some((w) => /stopLoss < entry < takeProfit/.test(w))).toBe(
      true,
    )
    expect(result.rationale).toMatch(/^Failed:.*geometry/i)
    expect(result.rationale).toMatch(/\nWatch:/)
  })

  test("no_trade returns null sizing", () => {
    const result = finalizeSuggestion(
      {
        side: "no_trade",
        entry: null,
        stopLoss: null,
        takeProfit: null,
        confidence: "medium",
        rationale: "Wait",
      },
      rules,
      neutralCtx,
    )
    expect(result.side).toBe("no_trade")
    expect(result.sizing).toBeNull()
  })

  test("rejects RR below 1.5", () => {
    const result = finalizeSuggestion(
      {
        side: "long",
        entry: 100_000,
        stopLoss: 99_000,
        takeProfit: 100_500,
        confidence: "medium",
        rationale: "Tight target",
      },
      rules,
      {
        ...longReadyCtx,
        entryIndicators: {
          ...longReadyCtx.entryIndicators,
          // Empty swings → no snap; keep LLM levels for RR check
          swings: [],
          atr14: 1_000,
        },
      },
    )
    expect(result.side).toBe("no_trade")
    expect(result.rationale).toMatch(/^Failed:.*reward\/risk/i)
    expect(result.rationale).toMatch(/\nWatch:/)
  })

  test("rejects multi-TF opposition", () => {
    const result = finalizeSuggestion(
      {
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        confidence: "medium",
        rationale: "Fighting structure",
      },
      rules,
      { ...neutralCtx, bias4h: "bull", structure1h: "downtrend" },
    )
    expect(result.side).toBe("no_trade")
    expect(result.warnings).toEqual([])
    expect(result.rationale).toMatch(/^Failed:.*opposes/i)
    expect(result.rationale).toMatch(/\nWatch:/)
  })

  test("rejects side fighting aligned context", () => {
    const result = finalizeSuggestion(
      {
        side: "short",
        entry: 100_000,
        stopLoss: 102_000,
        takeProfit: 94_000,
        confidence: "medium",
        rationale: "Fade the trend",
      },
      rules,
      { ...neutralCtx, bias4h: "bull", structure1h: "uptrend" },
    )
    expect(result.side).toBe("no_trade")
    expect(result.warnings).toEqual([])
    expect(result.rationale).toMatch(/^Failed:.*conflicts with aligned/i)
    expect(result.rationale).toMatch(/\nWatch:/)
  })

  test("rejects fewer than two 15m confirmations", () => {
    const result = finalizeSuggestion(
      {
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        confidence: "medium",
        rationale: "Weak trigger",
      },
      rules,
      {
        bias4h: "neutral",
        structure1h: "unclear",
        entryIndicators: {
          ema20: 101_000,
          ema50: 102_000,
          ema200: 103_000,
          rsi14: 40,
          atr14: 2_000,
          lastClose: 100_000,
          openTime: 1,
          swings: [{ kind: "high", index: 1, openTime: 1, price: 105_000 }],
        },
      },
    )
    expect(result.side).toBe("no_trade")
    expect(result.warnings).toEqual([])
    expect(result.rationale).toMatch(/^Failed:.*15m confirmations/i)
    expect(result.rationale).toMatch(/\nWatch:/)
  })

  test("rejects stop wider than 2x ATR after snap", () => {
    const result = finalizeSuggestion(
      {
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 110_000,
        confidence: "high",
        rationale: "Wide stop",
      },
      rules,
      {
        bias4h: "bull",
        structure1h: "uptrend",
        entryIndicators: {
          ema20: 99_000,
          ema50: 98_000,
          ema200: 97_000,
          rsi14: 55,
          atr14: 100,
          lastClose: 100_000,
          openTime: 1,
          swings: [
            { kind: "low", index: 1, openTime: 1, price: 99_000 },
            { kind: "high", index: 2, openTime: 2, price: 103_000 },
          ],
        },
      },
    )
    // snap SL ≈ 98975 → distance ~1025 > 2*100
    expect(result.side).toBe("no_trade")
    expect(result.rationale).toMatch(/^Failed:.*(?:2×ATR|ATR)/i)
    expect(result.rationale).toMatch(/\nWatch:/)
  })

  test("snaps levels then sizes", () => {
    const result = finalizeSuggestion(
      {
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 110_000,
        confidence: "high",
        rationale: "Snap me",
      },
      rules,
      {
        bias4h: "bull",
        structure1h: "uptrend",
        entryIndicators: {
          ema20: 99_000,
          ema50: 98_000,
          ema200: 97_000,
          rsi14: 55,
          atr14: 1_000,
          lastClose: 100_000,
          openTime: 1,
          swings: [
            { kind: "low", index: 1, openTime: 1, price: 99_000 },
            { kind: "high", index: 2, openTime: 2, price: 103_000 },
          ],
        },
      },
    )
    // SL = 99000 - 0.25*1000 = 98750; distance 1250 ≤ 2*1000
    expect(result.side).toBe("long")
    expect(result.levels?.stopLoss).toBeCloseTo(98_750, 8)
    expect(result.levels?.takeProfit).toBe(103_000)
    expect(result.sizing?.riskReward).toBeGreaterThanOrEqual(1.5)
  })
})
