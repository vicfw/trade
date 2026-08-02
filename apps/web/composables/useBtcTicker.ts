import type { BtcTicker, WsServerMessage } from "@trade/shared"

export function useBtcTicker() {
  const config = useRuntimeConfig()
  const price = ref<string | null>(null)
  const change24h = ref<string | null>(null)
  const high = ref<string | null>(null)
  const low = ref<string | null>(null)
  const volume24h = ref<string | null>(null)
  const connected = ref(false)
  const upstreamConnected = ref(false)
  const error = ref<string | null>(null)

  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let backoffMs = 1_000
  let stopped = false

  function applyTicker(ticker: BtcTicker) {
    price.value = ticker.price
    change24h.value = ticker.changePercent24h
    high.value = ticker.high24h
    low.value = ticker.low24h
    volume24h.value = ticker.volume24h
    error.value = null
  }

  function handleMessage(raw: string) {
    let message: WsServerMessage
    try {
      message = JSON.parse(raw) as WsServerMessage
    } catch {
      return
    }

    if (message.type === "ticker") {
      applyTicker(message.data)
      return
    }

    if (message.type === "status") {
      upstreamConnected.value = message.connected
      return
    }

    if (message.type === "error") {
      error.value = message.message
    }
  }

  function connect() {
    if (stopped || !import.meta.client) return

    const url = config.public.wsUrl as string
    socket = new WebSocket(url)

    socket.addEventListener("open", () => {
      connected.value = true
      backoffMs = 1_000
      error.value = null
    })

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        handleMessage(event.data)
      }
    })

    socket.addEventListener("close", () => {
      connected.value = false
      upstreamConnected.value = false
      scheduleReconnect()
    })

    socket.addEventListener("error", () => {
      error.value = "WebSocket connection error"
      socket?.close()
    })
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return

    const delay = backoffMs
    backoffMs = Math.min(backoffMs * 2, 30_000)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function disconnect() {
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    socket = null
  }

  onMounted(() => {
    stopped = false
    connect()
  })

  onUnmounted(() => {
    disconnect()
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
