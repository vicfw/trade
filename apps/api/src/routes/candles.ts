import { Hono } from "hono"
import {
  isKlineInterval,
  type BtcCandlesResponse,
} from "@trade/shared"
import { config } from "../config"
import { perpCandleStore } from "../market/tracking"

export const candleRoutes = new Hono()

candleRoutes.get("/candles/btc", (c) => {
  const intervalParam = c.req.query("interval")
  const symbol = config.tickerSymbol

  if (intervalParam != null) {
    if (!isKlineInterval(intervalParam)) {
      return c.json(
        {
          error: `Invalid interval. Expected one of: ${config.candleIntervals.join(", ")}`,
        },
        400,
      )
    }

    if (!config.candleIntervals.includes(intervalParam)) {
      return c.json(
        {
          error: `Interval ${intervalParam} is not configured. Expected one of: ${config.candleIntervals.join(", ")}`,
        },
        400,
      )
    }

    const response: BtcCandlesResponse = {
      symbol,
      series: [
        {
          symbol,
          interval: intervalParam,
          candles: perpCandleStore.get(intervalParam),
        },
      ],
    }
    return c.json(response)
  }

  const response: BtcCandlesResponse = {
    symbol,
    series: config.candleIntervals.map((interval) => ({
      symbol,
      interval,
      candles: perpCandleStore.get(interval),
    })),
  }
  return c.json(response)
})
