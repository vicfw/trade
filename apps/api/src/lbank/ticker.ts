import type { BtcTicker } from "@trade/shared"
import { asString } from "./rest"

/** Compact market fields from LBank futures WS (`uuws` / topic Market). */
interface PerpMarketFields {
  a?: unknown // instrumentID
  i?: unknown // lastPrice
  p?: unknown // highestPrice24
  q?: unknown // lowestPrice24
  r?: unknown // volume24
  s?: unknown // turnover24
  t?: unknown // openPrice24
  u?: unknown // updateTime (sec)
  e?: unknown // markedPrice
}

export interface LbankPerpMarketRow {
  symbol: string
  lastPrice?: unknown
  markedPrice?: unknown
  highestPrice?: unknown
  lowestPrice?: unknown
  openPrice?: unknown
  volume?: unknown
  turnover?: unknown
  lastTime?: unknown
}

function changePercent(last: string, open: string | null): number | null {
  if (!open) return null
  const lastN = Number(last)
  const openN = Number(open)
  if (!Number.isFinite(lastN) || !Number.isFinite(openN) || openN === 0) {
    return null
  }
  return ((lastN - openN) / openN) * 100
}

function toEventTimeMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Futures REST lastTime / WS updateTime are unix seconds.
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value)
    if (Number.isFinite(n)) {
      return n < 1_000_000_000_000 ? n * 1000 : n
    }
    const ms = Date.parse(value)
    if (!Number.isNaN(ms)) return ms
  }
  return Date.now()
}

function formatChange(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

function buildTicker(
  symbol: string,
  price: string,
  open: string | null,
  high: string | null,
  low: string | null,
  volume: string | null,
  turnover: string | null,
  eventTime: number,
): BtcTicker | null {
  const change = changePercent(price, open)
  if (change == null || !high || !low || !volume || !turnover) return null

  return {
    symbol,
    price,
    changePercent24h: formatChange(change),
    high24h: high,
    low24h: low,
    volume24h: volume,
    quoteVolume24h: turnover,
    eventTime,
  }
}

export function parseLbankPerpMarketRow(
  row: LbankPerpMarketRow,
): BtcTicker | null {
  if (typeof row.symbol !== "string" || row.symbol.length === 0) return null
  const price = asString(row.lastPrice)
  if (!price) return null

  return buildTicker(
    row.symbol,
    price,
    asString(row.openPrice),
    asString(row.highestPrice),
    asString(row.lowestPrice),
    asString(row.volume),
    asString(row.turnover),
    toEventTimeMs(row.lastTime),
  )
}

function parseMarketFields(fields: PerpMarketFields): BtcTicker | null {
  const symbol = asString(fields.a)
  const price = asString(fields.i)
  if (!symbol || !price) return null

  return buildTicker(
    symbol,
    price,
    asString(fields.t),
    asString(fields.p),
    asString(fields.q),
    asString(fields.r),
    asString(fields.s),
    toEventTimeMs(fields.u),
  )
}

/**
 * Parse a raw LBank futures market WS message (topic Market=1).
 * Resp (z=3) sends `d` as an array; Push (z=4) sends a single object.
 */
export function parseLbankPerpTicker(
  raw: string,
  expectedSymbol: string,
): BtcTicker | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const msg = parsed as Record<string, unknown>
  if (msg.x !== 1) return null
  if (msg.z !== 3 && msg.z !== 4) return null

  const rows: PerpMarketFields[] = []
  if (Array.isArray(msg.d)) {
    for (const row of msg.d) {
      if (row && typeof row === "object") rows.push(row as PerpMarketFields)
    }
  } else if (msg.d && typeof msg.d === "object") {
    rows.push(msg.d as PerpMarketFields)
  }

  for (const row of rows) {
    const ticker = parseMarketFields(row)
    if (!ticker) continue
    if (ticker.symbol.toUpperCase() !== expectedSymbol.toUpperCase()) continue
    return ticker
  }

  return null
}

export function isLbankPerpPong(raw: string): boolean {
  return raw === "pong"
}

export function buildLbankPerpMarketSubscribe(
  symbol: string,
  tsn: string,
): string {
  return JSON.stringify({
    x: 1, // Market
    y: tsn,
    z: 1, // Sub
    a: { i: symbol },
    e: JSON.stringify({ bvc: "202", isUsd: 1 }),
  })
}
