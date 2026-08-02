import { describe, expect, test } from "bun:test"
import type { Candle } from "@trade/shared"
import { evaluatePositionOutcome } from "./outcome"

function candle(openTime: number, high: number, low: number): Candle {
  return {
    openTime,
    open: String((high + low) / 2),
    high: String(high),
    low: String(low),
    close: String((high + low) / 2),
    volume: "1",
    closeTime: openTime + 15 * 60_000 - 1,
    quoteVolume: "0",
    isClosed: true,
  }
}

const SINCE = 1_000_000

describe("evaluatePositionOutcome", () => {
  test("long: take-profit hit after entry", () => {
    const candles = [
      candle(SINCE, 101_000, 99_500), // entry 100k touched
      candle(SINCE + 900_000, 106_500, 105_500), // TP=106000
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("successful")
    expect(result.hitReason).toBe("take_profit")
    expect(result.triggeredAt).toBe(SINCE)
    expect(result.hitAt).toBe(SINCE + 900_000)
    expect(result.candlesChecked).toBe(2)
  })

  test("long: stop-loss hit after entry", () => {
    const candles = [
      candle(SINCE, 101_000, 99_500),
      candle(SINCE + 900_000, 99_000, 97_500), // SL=98000
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("failed")
    expect(result.hitReason).toBe("stop_loss")
    expect(result.triggeredAt).toBe(SINCE)
    expect(result.hitAt).toBe(SINCE + 900_000)
  })

  test("long: waiting when entry filled but neither SL nor TP", () => {
    const candles = [
      candle(SINCE, 101_000, 99_500), // entry filled
      candle(SINCE + 900_000, 102_000, 100_500),
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("waiting")
    expect(result.triggeredAt).toBe(SINCE)
    expect(result.hitAt).toBeNull()
    expect(result.hitReason).toBeNull()
  })

  test("long: not_triggered when price never touches entry", () => {
    const candles = [
      candle(SINCE, 102_000, 100_500), // all above entry 100k
      candle(SINCE + 900_000, 103_000, 101_000),
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("not_triggered")
    expect(result.triggeredAt).toBeNull()
    expect(result.hitAt).toBeNull()
  })

  test("short: take-profit hit after entry", () => {
    const candles = [
      candle(SINCE, 100_500, 99_000), // entry 100k touched
      candle(SINCE + 900_000, 95_000, 93_500), // TP=94000
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "short",
      entry: 100_000,
      stopLoss: 102_000,
      takeProfit: 94_000,
      since: SINCE,
    })
    expect(result.status).toBe("successful")
    expect(result.hitReason).toBe("take_profit")
    expect(result.triggeredAt).toBe(SINCE)
  })

  test("TP touched on the fill candle without close confirmation stays waiting", () => {
    // Long: entry and TP both inside one candle, but close back inside the
    // range — the TP spike may have happened before the fill.
    const candles = [candle(SINCE, 106_500, 99_500)] // close = 103000 < TP
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("waiting")
    expect(result.triggeredAt).toBe(SINCE)
    expect(result.hitAt).toBeNull()
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("TP on the fill candle counts when the close confirms beyond TP", () => {
    const fill: Candle = {
      ...candle(SINCE, 106_500, 99_500),
      close: "106200", // closed beyond TP=106000
    }
    const result = evaluatePositionOutcome([fill], {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("successful")
    expect(result.hitReason).toBe("take_profit")
    expect(result.hitAt).toBe(SINCE)
  })

  test("alreadyTriggered skips the entry search and exits on the first candle", () => {
    const candles = [candle(SINCE, 106_500, 105_500)] // TP=106000, entry never touched here
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
      alreadyTriggered: true,
    })
    expect(result.status).toBe("successful")
    expect(result.hitReason).toBe("take_profit")
    expect(result.hitAt).toBe(SINCE)
  })

  test("alreadyTriggered with no exit stays waiting instead of not_triggered", () => {
    const candles = [candle(SINCE, 102_000, 100_500)]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
      alreadyTriggered: true,
    })
    expect(result.status).toBe("waiting")
  })

  test("short: stop-loss hit after entry", () => {
    const candles = [candle(SINCE, 102_500, 99_500)] // entry + SL
    const result = evaluatePositionOutcome(candles, {
      side: "short",
      entry: 100_000,
      stopLoss: 102_000,
      takeProfit: 94_000,
      since: SINCE,
    })
    expect(result.status).toBe("failed")
    expect(result.hitReason).toBe("stop_loss")
  })

  test("short: not_triggered when price never rises to entry", () => {
    const candles = [
      candle(SINCE, 99_500, 98_000), // all below entry 100k
      candle(SINCE + 900_000, 99_000, 97_500),
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "short",
      entry: 100_000,
      stopLoss: 102_000,
      takeProfit: 94_000,
      since: SINCE,
    })
    expect(result.status).toBe("not_triggered")
    expect(result.triggeredAt).toBeNull()
  })

  test("both levels inside one candle resolves to failed with a warning", () => {
    const candles = [candle(SINCE, 107_000, 97_000)] // entry + TP + SL
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("failed")
    expect(result.hitReason).toBe("stop_loss")
    expect(result.triggeredAt).toBe(SINCE)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("ignores candles that fully closed before since", () => {
    const candles = [
      candle(SINCE - 900_000, 106_500, 97_000), // would fill + resolve, but before since
      candle(SINCE, 100_000, 99_500), // fills entry, no SL/TP
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("waiting")
    expect(result.triggeredAt).toBe(SINCE)
    expect(result.candlesChecked).toBe(1)
  })

  test("includes the in-progress candle that contains since", () => {
    const barOpen = SINCE - 5 * 60_000 // suggestion mid-bar
    const candles = [
      candle(barOpen, 101_000, 99_500), // entry touched on this bar
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("waiting")
    expect(result.triggeredAt).toBe(barOpen)
    expect(result.candlesChecked).toBe(1)
  })

  test("does not count SL/TP before entry is filled", () => {
    const candles = [
      candle(SINCE, 107_000, 105_000), // TP would hit, but entry 100k not touched
      candle(SINCE + 900_000, 101_000, 99_500), // entry fills
      candle(SINCE + 1_800_000, 102_000, 100_500), // still waiting
    ]
    const result = evaluatePositionOutcome(candles, {
      side: "long",
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: SINCE,
    })
    expect(result.status).toBe("waiting")
    expect(result.triggeredAt).toBe(SINCE + 900_000)
    expect(result.hitAt).toBeNull()
  })
})
