import { asString } from "./rest"

/**
 * LBank futures WS kline topic (x=2).
 *
 * Subscribe param is `{ i: "<SYMBOL>_<period>" }` with periods like
 * "1m" / "5m" / "15m". Resp (z=3) carries the current bar as an array;
 * Push (z=4) streams live updates of the current bar as a single object.
 *
 * Compact data fields:
 * a=instrumentID, b=periodID, c=beginTime (sec), d=open, e=close,
 * f=high, g=low, h=volume, i=turnover, j=timeZone, k=updateTime (sec).
 */
interface PerpKlineFields {
  a?: unknown
  b?: unknown
  c?: unknown
  d?: unknown
  e?: unknown
  f?: unknown
  g?: unknown
  h?: unknown
  i?: unknown
  k?: unknown
}

export interface PerpKlineUpdate {
  symbol: string
  periodID: string
  /** Bar open time in ms. */
  beginTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  turnover: string
  /** Last trade/update time in ms. */
  updateTime: number
}

export function buildLbankPerpKlineSubscribe(
  symbol: string,
  period: string,
  tsn: string,
): string {
  return JSON.stringify({
    x: 2, // KLine
    y: tsn,
    z: 1, // Sub
    a: { i: `${symbol}_${period}` },
    e: JSON.stringify({ bvc: "202", isUsd: 1 }),
  })
}

function toMs(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n < 1_000_000_000_000 ? n * 1000 : n
}

function parseFields(fields: PerpKlineFields): PerpKlineUpdate | null {
  const symbol = asString(fields.a)
  const periodID = asString(fields.b)
  const beginTime = toMs(fields.c)
  const open = asString(fields.d)
  const close = asString(fields.e)
  const high = asString(fields.f)
  const low = asString(fields.g)
  if (!symbol || !periodID || beginTime == null || !open || !close || !high || !low) {
    return null
  }

  return {
    symbol,
    periodID,
    beginTime,
    open,
    high,
    low,
    close,
    volume: asString(fields.h) ?? "0",
    turnover: asString(fields.i) ?? "0",
    updateTime: toMs(fields.k) ?? beginTime,
  }
}

/**
 * Parse a raw LBank futures WS message from the kline topic (x=2).
 * Returns updates matching the expected symbol + period, else [].
 */
export function parseLbankPerpKlines(
  raw: string,
  expectedSymbol: string,
  expectedPeriods: string | readonly string[],
): PerpKlineUpdate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== "object") return []
  const msg = parsed as Record<string, unknown>
  if (msg.x !== 2) return []
  if (msg.z !== 3 && msg.z !== 4) return []

  const allowed = new Set(
    (typeof expectedPeriods === "string"
      ? [expectedPeriods]
      : [...expectedPeriods]
    ).map((p) => p),
  )

  const rows: PerpKlineFields[] = []
  if (Array.isArray(msg.d)) {
    for (const row of msg.d) {
      if (row && typeof row === "object") rows.push(row as PerpKlineFields)
    }
  } else if (msg.d && typeof msg.d === "object") {
    rows.push(msg.d as PerpKlineFields)
  }

  const updates: PerpKlineUpdate[] = []
  for (const row of rows) {
    const update = parseFields(row)
    if (!update) continue
    if (update.symbol.toUpperCase() !== expectedSymbol.toUpperCase()) continue
    if (!allowed.has(update.periodID)) continue
    updates.push(update)
  }

  return updates
}
