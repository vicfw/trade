import type { BtcCandlesResponse } from "@trade/shared"
import { config } from "../config"
import { tickerHub } from "../ws/hub"
import { perpCandleStore } from "./tracking"

/** Cap push rate — full HTF series payloads are large. */
const BROADCAST_MIN_MS = 2_000

let timer: ReturnType<typeof setTimeout> | null = null
let lastBroadcastAt = 0

export function getBtcCandlesResponse(): BtcCandlesResponse {
  const symbol = config.tickerSymbol
  return {
    symbol,
    series: config.candleIntervals.map((interval) => ({
      symbol,
      interval,
      candles: perpCandleStore.get(interval),
    })),
  }
}

export function broadcastCandlesNow() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (tickerHub.size === 0) return

  lastBroadcastAt = Date.now()
  tickerHub.broadcast({ type: "candles", data: getBtcCandlesResponse() })
}

/** Throttled push after store mutations (kline apply / live price). */
export function scheduleCandlesBroadcast() {
  if (tickerHub.size === 0) return

  const elapsed = Date.now() - lastBroadcastAt
  if (elapsed >= BROADCAST_MIN_MS) {
    broadcastCandlesNow()
    return
  }

  if (timer) return
  timer = setTimeout(() => {
    timer = null
    broadcastCandlesNow()
  }, BROADCAST_MIN_MS - elapsed)
}
