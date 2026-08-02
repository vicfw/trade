export type KlineInterval = "15m" | "1h" | "4h"

export const KLINE_INTERVALS: readonly KlineInterval[] = ["15m", "1h", "4h"]

export function isKlineInterval(value: string): value is KlineInterval {
  return (KLINE_INTERVALS as readonly string[]).includes(value)
}

export interface Candle {
  openTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  closeTime: number
  quoteVolume: string
  isClosed: boolean
}

export interface CandleSeries {
  symbol: string
  interval: KlineInterval
  candles: Candle[]
}

/** Multi-TF candle payload — REST GET /candles/btc and WS `{ type: "candles" }` */
export interface BtcCandlesResponse {
  symbol: string
  series: CandleSeries[]
}
