import type { BtcTicker } from "@trade/shared"

export function useBtcTicker() {
  const { connected, upstreamConnected, socketError, subscribe } = useBtcSocket()
  const price = ref<string | null>(null)
  const change24h = ref<string | null>(null)
  const high = ref<string | null>(null)
  const low = ref<string | null>(null)
  const volume24h = ref<string | null>(null)
  const error = ref<string | null>(null)

  function applyTicker(ticker: BtcTicker) {
    price.value = ticker.price
    change24h.value = ticker.changePercent24h
    high.value = ticker.high24h
    low.value = ticker.low24h
    volume24h.value = ticker.volume24h
    error.value = null
  }

  subscribe((message) => {
    if (message.type === "ticker") {
      applyTicker(message.data)
      return
    }

    if (message.type === "error") {
      error.value = message.message
    }
  })

  watch(socketError, (value) => {
    if (value) error.value = value
  })

  return {
    price,
    change24h,
    high,
    low,
    volume24h,
    connected,
    upstreamConnected,
    error,
  }
}
