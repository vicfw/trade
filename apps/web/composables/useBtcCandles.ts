import {
  KLINE_INTERVALS,
  type BtcCandlesResponse,
  type Candle,
  type CandleSeries,
  type KlineInterval,
} from "@trade/shared"

/** Structure refresh — live close is patched from the ticker on the chart. */
const POLL_MS = 5_000

export function useBtcCandles() {
  const config = useRuntimeConfig()
  const series = ref<CandleSeries[]>([])
  const activeInterval = ref<KlineInterval>("1h")
  const pending = ref(false)
  const error = ref<string | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const activeCandles = computed<Candle[]>(() => {
    const match = series.value.find((item) => item.interval === activeInterval.value)
    return match?.candles ?? []
  })

  const lastCandle = computed(() => activeCandles.value.at(-1) ?? null)

  async function refresh() {
    if (!import.meta.client || stopped) return

    pending.value = true
    try {
      const response = await fetch(`${config.public.apiUrl}/candles/btc`)
      if (!response.ok) {
        throw new Error(`Candles request failed (${response.status})`)
      }

      const payload = (await response.json()) as BtcCandlesResponse
      series.value = payload.series ?? []
      error.value = null

      if (
        series.value.length > 0 &&
        !series.value.some((item) => item.interval === activeInterval.value)
      ) {
        activeInterval.value = series.value[0]!.interval
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to load candles"
    } finally {
      pending.value = false
    }
  }

  function setIntervalTab(interval: KlineInterval) {
    activeInterval.value = interval
  }

  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      void refresh()
    }, POLL_MS)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(() => {
    stopped = false
    void refresh()
    startPolling()
  })

  onUnmounted(() => {
    stopped = true
    stopPolling()
  })

  return {
    intervals: KLINE_INTERVALS,
    series,
    activeInterval,
    activeCandles,
    lastCandle,
    pending,
    error,
    refresh,
    setIntervalTab,
  }
}
