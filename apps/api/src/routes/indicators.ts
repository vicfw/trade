import { Hono } from "hono"
import {
  isKlineInterval,
  type BtcIndicatorsResponse,
  type IntervalIndicators,
  type KlineInterval,
} from "@trade/shared"
import { computeIntervalIndicators, computeMultiTfContext } from "@trade/market"
import { config } from "../config"
import { buildMarketSnapshot } from "../market/buildSnapshot"
import { perpCandleStore } from "../market/tracking"

export const indicatorRoutes = new Hono()

indicatorRoutes.get("/indicators/btc", (c) => {
  const intervalParam = c.req.query("interval")
  const symbol = config.tickerSymbol
  const snapshot = buildMarketSnapshot({
    symbol,
    intervals: config.candleIntervals,
    getCandles: (interval) => perpCandleStore.get(interval),
    ticker: null,
    candleWindow: 0,
  })

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

    const match = snapshot.intervals.find((item) => item.interval === intervalParam)
    const byInterval: Partial<Record<KlineInterval, IntervalIndicators>> = {}
    for (const item of snapshot.intervals) {
      if (item.barCount > 0) {
        byInterval[item.interval] = item.indicators
      }
    }

    const response: BtcIndicatorsResponse = {
      symbol,
      updatedAt: snapshot.snapshotAt,
      series: [
        {
          symbol,
          interval: intervalParam,
          indicators: match?.indicators ?? computeIntervalIndicators([]),
        },
      ],
      context: computeMultiTfContext(byInterval),
    }
    return c.json(response)
  }

  const response: BtcIndicatorsResponse = {
    symbol,
    updatedAt: snapshot.snapshotAt,
    series: snapshot.intervals.map((item) => ({
      symbol,
      interval: item.interval,
      indicators: item.indicators,
    })),
    context: snapshot.context,
  }
  return c.json(response)
})
