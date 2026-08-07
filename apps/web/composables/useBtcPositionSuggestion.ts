import {
  DEFAULT_RISK_RULES,
  type AnalysisSchedule,
  type BtcAnalysisStatusResponse,
  type BtcPositionTestResponse,
  type PositionSuggestion,
  type RiskRules,
} from "@trade/shared";

const POLL_MS = 5_000;

export function useBtcPositionSuggestion() {
  const config = useRuntimeConfig();
  const suggestion = ref<PositionSuggestion | null>(null);
  const market = ref<BtcAnalysisStatusResponse["market"] | null>(null);
  const generatedAt = ref<number | null>(null);
  const riskUsed = ref<RiskRules | null>(null);
  const schedule = ref<AnalysisSchedule>({
    status: "idle",
    analyzedAt: null,
    nextAnalysisAt: null,
    lastError: null,
  });
  const openPosition = ref<BtcPositionTestResponse | null>(null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let abortController: AbortController | null = null;

  async function refresh() {
    if (!import.meta.client) return;

    abortController?.abort();
    abortController = new AbortController();

    const firstLoad = suggestion.value == null && !pending.value;
    if (firstLoad) pending.value = true;

    try {
      const response = await fetch(`${config.public.apiUrl}/analysis/btc`, {
        signal: abortController.signal,
      });
      const payload = (await response.json()) as
        | BtcAnalysisStatusResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Analysis status failed (${response.status})`,
        );
      }

      const ok = payload as BtcAnalysisStatusResponse;
      suggestion.value = ok.suggestion;
      market.value = ok.market;
      generatedAt.value = ok.generatedAt;
      riskUsed.value = ok.riskUsed;
      schedule.value = ok.schedule;
      openPosition.value = ok.openPosition;
      error.value =
        ok.schedule.status === "error" ? ok.schedule.lastError : null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      error.value =
        err instanceof Error ? err.message : "Failed to load analysis";
    } finally {
      pending.value = false;
    }
  }

  function startPolling() {
    stopPolling();
    void refresh();
    pollTimer = setInterval(() => {
      void refresh();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function onVisibility() {
    if (document.visibilityState === "visible") {
      void refresh();
    }
  }

  onMounted(() => {
    startPolling();
    document.addEventListener("visibilitychange", onVisibility);
  });

  onUnmounted(() => {
    stopPolling();
    abortController?.abort();
    document.removeEventListener("visibilitychange", onVisibility);
  });

  return {
    suggestion,
    market,
    generatedAt,
    riskUsed,
    schedule,
    openPosition,
    pending,
    error,
    refresh,
  };
}
