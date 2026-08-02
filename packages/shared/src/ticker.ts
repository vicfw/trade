export interface BtcTicker {
  symbol: string
  price: string
  changePercent24h: string
  high24h: string
  low24h: string
  volume24h: string
  quoteVolume24h: string
  eventTime: number
}

export type WsServerMessage =
  | { type: "ticker"; data: BtcTicker }
  | { type: "status"; connected: boolean }
  | { type: "error"; message: string }
