import { describe, expect, test } from "bun:test"
import {
  DEFAULT_RISK_RULES,
  formatNoTradeRationale,
  parseNoTradeRationale,
} from "./position"

describe("DEFAULT_RISK_RULES", () => {
  test("uses $10 / 1% / 5x", () => {
    expect(DEFAULT_RISK_RULES).toEqual({
      accountBalanceUsdt: 10,
      maxRiskPercent: 1,
      maxLeverage: 5,
    })
  })
})

describe("no_trade rationale helpers", () => {
  test("round-trips Failed/Watch", () => {
    const text = formatNoTradeRationale(
      "4h bull opposes 1h downtrend.",
      "Re-check after 1h structure flips to uptrend.",
    )
    expect(parseNoTradeRationale(text)).toEqual({
      failed: "4h bull opposes 1h downtrend.",
      watch: "Re-check after 1h structure flips to uptrend.",
    })
  })

  test("parses same-line Failed/Watch", () => {
    expect(
      parseNoTradeRationale(
        "Failed: Only one 15m confirmation. Watch: Wait for RSI ≥ 50.",
      ),
    ).toEqual({
      failed: "Only one 15m confirmation.",
      watch: "Wait for RSI ≥ 50.",
    })
  })

  test("returns null for free-form text", () => {
    expect(parseNoTradeRationale("Choppy range, wait for breakout.")).toBeNull()
  })
})
