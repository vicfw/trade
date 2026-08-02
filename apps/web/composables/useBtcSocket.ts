import type { WsServerMessage } from "@trade/shared"

type MessageHandler = (message: WsServerMessage) => void

const handlers = new Set<MessageHandler>()

const connected = ref(false)
const upstreamConnected = ref(false)
const socketError = ref<string | null>(null)

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let backoffMs = 1_000
let subscribers = 0
let stopped = true
let wsUrl = ""

function dispatch(message: WsServerMessage) {
  if (message.type === "status") {
    upstreamConnected.value = message.connected
  }

  if (message.type === "error") {
    socketError.value = message.message
  }

  for (const handler of handlers) {
    handler(message)
  }
}

function handleRaw(raw: string) {
  let message: WsServerMessage
  try {
    message = JSON.parse(raw) as WsServerMessage
  } catch {
    return
  }
  dispatch(message)
}

function connect() {
  if (stopped || !import.meta.client || !wsUrl) return

  socket = new WebSocket(wsUrl)

  socket.addEventListener("open", () => {
    connected.value = true
    backoffMs = 1_000
    socketError.value = null
  })

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      handleRaw(event.data)
    }
  })

  socket.addEventListener("close", () => {
    connected.value = false
    upstreamConnected.value = false
    scheduleReconnect()
  })

  socket.addEventListener("error", () => {
    socketError.value = "WebSocket connection error"
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
  connected.value = false
  upstreamConnected.value = false
}

/**
 * Shared BTC market WebSocket — one connection for ticker + candles.
 * Reference-counted across composables on the page.
 */
export function useBtcSocket() {
  const config = useRuntimeConfig()

  function subscribe(handler: MessageHandler) {
    handlers.add(handler)
    onUnmounted(() => {
      handlers.delete(handler)
    })
  }

  onMounted(() => {
    wsUrl = config.public.wsUrl as string
    subscribers += 1
    if (subscribers === 1) {
      stopped = false
      backoffMs = 1_000
      connect()
    }
  })

  onUnmounted(() => {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) {
      disconnect()
    }
  })

  return {
    connected,
    upstreamConnected,
    socketError,
    subscribe,
  }
}
