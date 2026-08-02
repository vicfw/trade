import type {
  BtcPositionTestRequest,
  BtcPositionTestResponse,
} from "@trade/shared";

export function useBtcPositionTest() {
  const config = useRuntimeConfig();
  const result = ref<BtcPositionTestResponse | null>(null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  let abortController: AbortController | null = null;

  async function request(body: BtcPositionTestRequest) {
    if (!import.meta.client) return;

    abortController?.abort();
    abortController = new AbortController();

    pending.value = true;
    error.value = null;

    try {
      const response = await fetch(`${config.public.apiUrl}/test/btc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      const payload = (await response.json()) as
        | BtcPositionTestResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Position test failed (${response.status})`,
        );
      }

      result.value = payload as BtcPositionTestResponse;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      error.value =
        err instanceof Error ? err.message : "Failed to test position";
    } finally {
      pending.value = false;
    }
  }

  function clear() {
    result.value = null;
    error.value = null;
  }

  onUnmounted(() => {
    abortController?.abort();
  });

  return { result, pending, error, request, clear };
}
