import type {
  BtcIndicatorsResponse,
  IntervalIndicators,
  KlineInterval,
  MultiTfContext,
} from "@trade/shared";
import type { Ref } from "vue";

const POLL_MS = 60_000;

export function useBtcIndicators(activeInterval: Ref<KlineInterval>) {
  const config = useRuntimeConfig();
  const series = ref<BtcIndicatorsResponse["series"]>([]);
  const context = ref<MultiTfContext>({
    bias4h: "neutral",
    structure1h: "unclear",
  });
  const updatedAt = ref<number | null>(null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const activeIndicators = computed<IntervalIndicators | null>(() => {
    const match = series.value.find(
      (item) => item.interval === activeInterval.value,
    );
    return match?.indicators ?? null;
  });

  async function refresh() {
    if (!import.meta.client || stopped) return;

    pending.value = true;
    try {
      const response = await fetch(`${config.public.apiUrl}/indicators/btc`);
      if (!response.ok) {
        throw new Error(`Indicators request failed (${response.status})`);
      }

      const payload = (await response.json()) as BtcIndicatorsResponse;
      series.value = payload.series ?? [];
      context.value = payload.context ?? {
        bias4h: "neutral",
        structure1h: "unclear",
      };
      updatedAt.value = payload.updatedAt ?? null;
      error.value = null;
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to load indicators";
    } finally {
      pending.value = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
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

  onMounted(() => {
    stopped = false;
    void refresh();
    startPolling();
  });

  onUnmounted(() => {
    stopped = true;
    stopPolling();
  });

  return {
    series,
    context,
    activeIndicators,
    updatedAt,
    pending,
    error,
    refresh,
  };
}
