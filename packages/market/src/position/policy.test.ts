import { describe, expect, test } from "bun:test"
import type { IntervalIndicators, PositionLevels } from "@trade/shared"
import {
  countEntrySignals,
  isMultiTfOpposed,
  isStopTooTight,
  isStopTooWide,
  isTakeProfitAlreadyThrough,
  MAX_STOP_ATR_MULT,
  MIN_STOP_ATR_MULT,
  sideConflictsWithAlignedContext,
  snapTradeLevels,
} from "./policy"

const baseIndicators: IntervalIndicators = {
  ema20: 100,
  ema50: 99,
  ema200: 98,
  rsi14: 55,
  atr14: 100,
  lastClose: 100_000,
  openTime: 1,
  swings: [
    { kind: "low", index: 1, openTime: 1, price: 99_000 },
    { kind: "high", index: 2, openTime: 2, price: 103_000 },
    { kind: "low", index: 3, openTime: 3, price: 99_500 },
    { kind: "high", index: 4, openTime: 4, price: 102_000 },
  ],
}

describe("isMultiTfOpposed", () => {
  test("detects bull vs downtrend", () => {
    expect(isMultiTfOpposed("bull", "downtrend")).toBe(true)
    expect(isMultiTfOpposed("bear", "uptrend")).toBe(true)
    expect(isMultiTfOpposed("bull", "uptrend")).toBe(false)
    expect(isMultiTfOpposed("neutral", "downtrend")).toBe(false)
  })
})

describe("sideConflictsWithAlignedContext", () => {
  test("rejects short against bullish alignment", () => {
    expect(sideConflictsWithAlignedContext("short", "bull", "uptrend")).toBe(
      true,
    )
    expect(sideConflictsWithAlignedContext("long", "bull", "uptrend")).toBe(
      false,
    )
  })

  test("rejects long against bearish alignment", () => {
    expect(sideConflictsWithAlignedContext("long", "bear", "downtrend")).toBe(
      true,
    )
  })
})

describe("countEntrySignals", () => {
  const hhHlSwings = [
    { kind: "low" as const, index: 1, openTime: 1, price: 98_000 },
    { kind: "high" as const, index: 2, openTime: 2, price: 101_000 },
    { kind: "low" as const, index: 3, openTime: 3, price: 99_000 },
    { kind: "high" as const, index: 4, openTime: 4, price: 102_000 },
  ]

  test("counts long PA confirmations (sequence + hold; no break / structure)", () => {
    const result = countEntrySignals(
      "long",
      {
        ...baseIndicators,
        lastClose: 100_000,
        swings: hhHlSwings,
      },
      "unclear",
    )
    // HH+HL sequence, pullback hold above last HL 99000; most recent high 102000 not broken
    expect(result.count).toBe(2)
    expect(result.flags).toEqual({
      swingBreak: false,
      swingSequence: true,
      pullbackHold: true,
      structureAgree: false,
    })
  })

  test("detects long swing break and structure agree", () => {
    const result = countEntrySignals(
      "long",
      {
        ...baseIndicators,
        lastClose: 102_500,
        swings: hhHlSwings,
      },
      "uptrend",
    )
    expect(result.flags.swingBreak).toBe(true)
    expect(result.flags.structureAgree).toBe(true)
    expect(result.count).toBe(4)
  })

  test("counts short PA confirmations", () => {
    const lhLlSwings = [
      { kind: "high" as const, index: 1, openTime: 1, price: 103_000 },
      { kind: "low" as const, index: 2, openTime: 2, price: 100_000 },
      { kind: "high" as const, index: 3, openTime: 3, price: 101_000 },
      { kind: "low" as const, index: 4, openTime: 4, price: 99_000 },
    ]
    const result = countEntrySignals(
      "short",
      {
        ...baseIndicators,
        lastClose: 100_500,
        swings: lhLlSwings,
      },
      "unclear",
    )
    // LH+LL + hold below last LH 101000; most recent low 99000 not broken
    expect(result.count).toBe(2)
    expect(result.flags.swingBreak).toBe(false)
    expect(result.flags.swingSequence).toBe(true)
    expect(result.flags.pullbackHold).toBe(true)
    expect(result.flags.structureAgree).toBe(false)
  })

  test("detects short swing break of most recent low", () => {
    const result = countEntrySignals(
      "short",
      {
        ...baseIndicators,
        lastClose: 98_500,
        swings: [
          { kind: "high", index: 1, openTime: 1, price: 103_000 },
          { kind: "low", index: 2, openTime: 2, price: 100_000 },
          { kind: "high", index: 3, openTime: 3, price: 101_000 },
          { kind: "low", index: 4, openTime: 4, price: 99_000 },
        ],
      },
      "downtrend",
    )
    expect(result.flags.swingBreak).toBe(true)
    expect(result.flags.structureAgree).toBe(true)
    expect(result.count).toBe(4)
  })

  test("missing swings and unclear structure count as false", () => {
    const result = countEntrySignals(
      "long",
      {
        ema20: null,
        ema50: null,
        ema200: null,
        rsi14: null,
        atr14: null,
        lastClose: null,
        openTime: null,
        swings: [],
      },
      "unclear",
    )
    expect(result.count).toBe(0)
    expect(result.flags).toEqual({
      swingBreak: false,
      swingSequence: false,
      pullbackHold: false,
      structureAgree: false,
    })
  })
})

describe("isStopTooWide", () => {
  test("false when stop within 2x ATR", () => {
    expect(isStopTooWide(100_000, 99_500, 300)).toBe(false)
    expect(isStopTooWide(100_000, 99_400, 300)).toBe(false) // exactly 2x
  })

  test("true when stop farther than 2x ATR", () => {
    expect(isStopTooWide(100_000, 99_000, 300)).toBe(true)
    expect(MAX_STOP_ATR_MULT).toBe(2)
  })

  test("true when ATR missing or invalid", () => {
    expect(isStopTooWide(100_000, 99_500, null)).toBe(true)
    expect(isStopTooWide(100_000, 99_500, 0)).toBe(true)
  })
})

describe("isStopTooTight", () => {
  test("false when stop at or beyond 0.75x ATR", () => {
    expect(isStopTooTight(100_000, 99_775, 300)).toBe(false) // exactly 0.75x
    expect(isStopTooTight(100_000, 99_500, 300)).toBe(false)
    expect(MIN_STOP_ATR_MULT).toBe(0.75)
  })

  test("true when stop closer than 0.75x ATR", () => {
    expect(isStopTooTight(100_000, 99_800, 300)).toBe(true) // 200 < 225
  })

  test("true when ATR missing or invalid", () => {
    expect(isStopTooTight(100_000, 99_500, null)).toBe(true)
    expect(isStopTooTight(100_000, 99_500, 0)).toBe(true)
  })
})

describe("snapTradeLevels", () => {
  test("snaps long SL below nearest swing low with ATR buffer", () => {
    const levels: PositionLevels = {
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 110_000,
    }
    const result = snapTradeLevels("long", levels, baseIndicators)
    // nearest low below entry is 99500; SL = 99500 - 0.25*100 = 99475
    expect(result.levels.stopLoss).toBeCloseTo(99_475, 8)
    // nearest high above entry is 102000
    expect(result.levels.takeProfit).toBe(102_000)
    expect(result.levels.entry).toBe(100_000)
  })

  test("snaps long TP to swing still above live price", () => {
    const levels: PositionLevels = {
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 110_000,
    }
    // Live already past 102k swing; next high above live is 103000
    const result = snapTradeLevels("long", levels, baseIndicators, undefined, 102_500)
    expect(result.levels.takeProfit).toBe(103_000)
    expect(result.levels.stopLoss).toBeCloseTo(99_475, 8)
  })

  test("keeps LLM TP when no swing remains above live price", () => {
    const levels: PositionLevels = {
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 110_000,
    }
    const result = snapTradeLevels("long", levels, baseIndicators, undefined, 104_000)
    expect(result.levels.takeProfit).toBe(110_000)
    expect(
      result.warnings.some((w) => /keeping LLM take-profit/.test(w)),
    ).toBe(true)
  })

  test("keeps LLM levels when ATR missing", () => {
    const levels: PositionLevels = {
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
    }
    const result = snapTradeLevels("long", levels, {
      ...baseIndicators,
      atr14: null,
    })
    expect(result.levels).toEqual(levels)
    expect(result.warnings.some((w) => /missing 15m swings or ATR/.test(w))).toBe(
      true,
    )
  })
})

describe("isTakeProfitAlreadyThrough", () => {
  test("detects long TP already through live", () => {
    expect(isTakeProfitAlreadyThrough("long", 64_978, 65_200)).toBe(true)
    expect(isTakeProfitAlreadyThrough("long", 65_357, 65_200)).toBe(false)
  })

  test("detects short TP already through live", () => {
    expect(isTakeProfitAlreadyThrough("short", 94_000, 93_500)).toBe(true)
    expect(isTakeProfitAlreadyThrough("short", 94_000, 95_000)).toBe(false)
  })
})
