import {
  KLINE_INTERVALS,
  type Candle,
  type CandleSeries,
  type KlineInterval,
} from "@trade/shared"

export function useBtcCandles() {
  const { socketError, subscribe } = useBtcSocket()
  const series = ref<CandleSeries[]>([])
  const activeInterval = ref<KlineInterval>("1h")
  const pending = ref(true)
  const error = ref<string | null>(null)

  const activeCandles = computed<Candle[]>(() => {
    const match = series.value.find((item) => item.interval === activeInterval.value)
    return match?.candles ?? []
  })

  const lastCandle = computed(() => activeCandles.value.at(-1) ?? null)

  function applySeries(next: CandleSeries[]) {
    series.value = next
    pending.value = false
    error.value = null

    if (
      series.value.length > 0 &&
      !series.value.some((item) => item.interval === activeInterval.value)
    ) {
      activeInterval.value = series.value[0]!.interval
    }
  }

  function setIntervalTab(interval: KlineInterval) {
    activeInterval.value = interval
  }

  subscribe((message) => {
    if (message.type === "candles") {
      applySeries(message.data.series ?? [])
      return
    }

    if (message.type === "error") {
      error.value = message.message
    }
  })

  watch(socketError, (value) => {
    if (value && series.value.length === 0) {
      error.value = value
      pending.value = false
    }
  })

  return {
    intervals: KLINE_INTERVALS,
    series,
    activeInterval,
    activeCandles,
    lastCandle,
    pending,
    error,
    setIntervalTab,
  }
}
