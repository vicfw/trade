import { describe, expect, test } from "bun:test"
import {
  buildLbankPerpMarketSubscribe,
  isLbankPerpPong,
  parseLbankPerpMarketRow,
  parseLbankPerpTicker,
} from "./ticker"

describe("parseLbankPerpTicker", () => {
  test("maps futures WS push payload to BtcTicker", () => {
    const raw = JSON.stringify({
      d: {
        a: "BTCUSDT",
        i: "64447.8",
        p: "64556.6",
        q: "62699.9",
        r: "6040.9936",
        s: "385002602.71",
        t: "63484",
        u: 1_785_317_435,
      },
      x: 1,
      y: "1000000001",
      z: 4,
      w: 1_785_317_435_120,
    })

    const ticker = parseLbankPerpTicker(raw, "BTCUSDT")
    expect(ticker).not.toBeNull()
    expect(ticker!.symbol).toBe("BTCUSDT")
    expect(ticker!.price).toBe("64447.8")
    expect(ticker!.high24h).toBe("64556.6")
    expect(ticker!.low24h).toBe("62699.9")
    expect(ticker!.volume24h).toBe("6040.9936")
    expect(ticker!.quoteVolume24h).toBe("385002602.71")
    expect(ticker!.eventTime).toBe(1_785_317_435_000)
    // (64447.8 - 63484) / 63484 * 100 ≈ 1.52
    expect(Number(ticker!.changePercent24h)).toBeCloseTo(1.52, 1)
  })

  test("maps futures WS snapshot resp array", () => {
    const raw = JSON.stringify({
      d: [
        {
          a: "ETHUSDT",
          i: "1",
          p: "2",
          q: "0.5",
          r: "1",
          s: "1",
          t: "1",
          u: 1,
        },
        {
          a: "BTCUSDT",
          i: "64000",
          p: "65000",
          q: "62000",
          r: "10",
          s: "100",
          t: "63000",
          u: 100,
        },
      ],
      x: 1,
      z: 3,
    })

    const ticker = parseLbankPerpTicker(raw, "BTCUSDT")
    expect(ticker).not.toBeNull()
    expect(ticker!.price).toBe("64000")
  })

  test("returns null for non-market messages", () => {
    expect(
      parseLbankPerpTicker(
        JSON.stringify({ x: 2, z: 4, d: { a: "BTCUSDT", i: "1" } }),
        "BTCUSDT",
      ),
    ).toBeNull()
    expect(parseLbankPerpTicker("not-json", "BTCUSDT")).toBeNull()
  })
})

describe("parseLbankPerpMarketRow", () => {
  test("maps REST marketData row to BtcTicker", () => {
    const ticker = parseLbankPerpMarketRow({
      symbol: "BTCUSDT",
      lastPrice: "64405.8",
      markedPrice: "64405.9",
      highestPrice: "64556.6",
      lowestPrice: "62699.9",
      openPrice: "63450.5",
      volume: "6031.6668",
      turnover: "384401715.48",
      lastTime: 1_785_317_045,
    })

    expect(ticker).not.toBeNull()
    expect(ticker!.symbol).toBe("BTCUSDT")
    expect(ticker!.price).toBe("64405.8")
    expect(ticker!.eventTime).toBe(1_785_317_045_000)
  })
})

describe("isLbankPerpPong", () => {
  test("detects plain pong heartbeat", () => {
    expect(isLbankPerpPong("pong")).toBe(true)
    expect(isLbankPerpPong(JSON.stringify({ action: "ping" }))).toBe(false)
  })
})

describe("buildLbankPerpMarketSubscribe", () => {
  test("builds compressed Market subscribe frame", () => {
    const raw = buildLbankPerpMarketSubscribe("BTCUSDT", "1000000001")
    expect(JSON.parse(raw)).toEqual({
      x: 1,
      y: "1000000001",
      z: 1,
      a: { i: "BTCUSDT" },
      e: JSON.stringify({ bvc: "202", isUsd: 1 }),
    })
  })
})
