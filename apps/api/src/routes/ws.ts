import type { UpgradeWebSocket } from "hono/ws"
import { getBtcCandlesResponse } from "../market/candlesBroadcast"
import { tickerHub } from "../ws/hub"
import { lbankTickerClient } from "../lbank/client"

export function createWsRoutes(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      tickerHub.add(ws)
      ws.send(
        JSON.stringify({
          type: "status",
          connected: lbankTickerClient.connected,
        }),
      )
      const latest = lbankTickerClient.latest
      if (latest) {
        ws.send(JSON.stringify({ type: "ticker", data: latest }))
      }
      ws.send(
        JSON.stringify({ type: "candles", data: getBtcCandlesResponse() }),
      )
      console.log(`[ws] client connected (total=${tickerHub.size})`)
    },
    onClose(_event, ws) {
      tickerHub.remove(ws)
      console.log(`[ws] client disconnected (total=${tickerHub.size})`)
    },
    onError(_event, ws) {
      tickerHub.remove(ws)
    },
  }))
}
