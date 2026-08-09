import { app, websocket } from "./app"
import { config } from "./config"
import { lbankTickerClient } from "./lbank/client"
import { scheduleCandlesBroadcast } from "./market/candlesBroadcast"
import { analysisScheduler } from "./market/analysisScheduler"
import { btcPositionTracker } from "./market/positionTracker"
import {
  initPositionTracking,
  perpCandleStore,
  setOnTradeClosed,
} from "./market/tracking"

let server: ReturnType<typeof Bun.serve>
try {
  server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket,
  })
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[api] failed to bind port ${config.port}: ${message}`)
  console.error(
    `[api] another process is likely already using :${config.port}. Stop it, then restart.`,
  )
  process.exit(1)
}

initPositionTracking()
setOnTradeClosed(() => {
  analysisScheduler.onTradeClosed()
})
analysisScheduler.start()

lbankTickerClient.onTicker((ticker) => {
  btcPositionTracker.observeTicker(ticker)
  const price = Number(ticker.price)
  if (Number.isFinite(price) && price > 0) {
    perpCandleStore.applyLivePrice(price, ticker.eventTime)
    scheduleCandlesBroadcast()
  }
})
lbankTickerClient.onKline((update) => {
  perpCandleStore.apply(update)
  scheduleCandlesBroadcast()
})
lbankTickerClient.start()

console.log(`[api] listening on http://localhost:${server.port}`)
console.log(`[api] btc websocket at ws://localhost:${server.port}/ws/btc`)
console.log(`[api] btc candles at http://localhost:${server.port}/candles/btc`)
console.log(
  `[api] btc indicators at http://localhost:${server.port}/indicators/btc`,
)
console.log(
  `[api] llm provider=${config.llm.provider} model=${config.llm.model} base=${config.llm.baseUrl}`,
)
console.log(
  `[api] auto-analysis intervalMs=${config.analysisIntervalMs} entryTimeoutMs=${config.entryTimeoutMs} retryMs=${config.analysisRetryMs}`,
)
