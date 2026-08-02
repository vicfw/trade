import type {
  BtcTradeHistoryResponse,
  TradeHistoryEntry,
} from "@trade/shared"

/**
 * Closed trades (take-profit success / stop-loss failure) from the API
 * SQLite store — same source the Test endpoint writes via position tracking.
 */
export function useTradeHistory() {
  const config = useRuntimeConfig()
  const records = ref<TradeHistoryEntry[]>([])
  const pending = ref(false)
  const error = ref<string | null>(null)
  let abortController: AbortController | null = null

  async function refresh() {
    if (!import.meta.client) return

    abortController?.abort()
    abortController = new AbortController()
    pending.value = true
    error.value = null

    try {
      const response = await fetch(`${config.public.apiUrl}/history/btc`, {
        signal: abortController.signal,
      })
      const payload = (await response.json()) as
        | BtcTradeHistoryResponse
        | { error?: string }

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Failed to load history (${response.status})`,
        )
      }

      records.value = (payload as BtcTradeHistoryResponse).records
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      error.value =
        err instanceof Error ? err.message : "Failed to load trade history"
    } finally {
      pending.value = false
    }
  }

  async function clear() {
    if (!import.meta.client) return

    pending.value = true
    error.value = null

    try {
      const response = await fetch(`${config.public.apiUrl}/history/btc`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(
          payload.error ?? `Failed to clear history (${response.status})`,
        )
      }
      records.value = []
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to clear trade history"
    } finally {
      pending.value = false
    }
  }

  onMounted(() => {
    void refresh()
  })

  onUnmounted(() => {
    abortController?.abort()
  })

  return { records, pending, error, refresh, clear }
}
