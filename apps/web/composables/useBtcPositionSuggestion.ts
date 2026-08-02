import type {
  BtcSuggestRequest,
  BtcSuggestResponse,
  PositionSuggestion,
  RiskRules,
} from "@trade/shared";

const STORAGE_KEY = "trade.lastMarketAnalysis";

type StoredAnalysis = {
  suggestion: PositionSuggestion;
  market: BtcSuggestResponse["market"];
  generatedAt: number;
};

function loadStored(): StoredAnalysis | null {
  if (!import.meta.client) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAnalysis>;
    if (
      !parsed.suggestion ||
      !parsed.market ||
      typeof parsed.generatedAt !== "number"
    ) {
      return null;
    }
    return {
      suggestion: parsed.suggestion,
      market: parsed.market,
      generatedAt: parsed.generatedAt,
    };
  } catch {
    return null;
  }
}

function persist(data: StoredAnalysis) {
  if (!import.meta.client) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearStored() {
  if (!import.meta.client) return;
  localStorage.removeItem(STORAGE_KEY);
}

export function useBtcPositionSuggestion() {
  const config = useRuntimeConfig();
  const suggestion = ref<PositionSuggestion | null>(null);
  const market = ref<BtcSuggestResponse["market"] | null>(null);
  const generatedAt = ref<number | null>(null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  let abortController: AbortController | null = null;

  onMounted(() => {
    const stored = loadStored();
    if (!stored) return;
    suggestion.value = stored.suggestion;
    market.value = stored.market;
    generatedAt.value = stored.generatedAt;
  });

  async function request(risk: RiskRules) {
    if (!import.meta.client) return;

    abortController?.abort();
    abortController = new AbortController();

    pending.value = true;
    error.value = null;
    suggestion.value = null;
    market.value = null;
    generatedAt.value = null;
    clearStored();

    const body: BtcSuggestRequest = {
      accountBalanceUsdt: risk.accountBalanceUsdt,
      maxRiskPercent: risk.maxRiskPercent,
      maxLeverage: risk.maxLeverage,
    };

    try {
      const response = await fetch(`${config.public.apiUrl}/suggest/btc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      const payload = (await response.json()) as
        | BtcSuggestResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Suggestion failed (${response.status})`,
        );
      }

      const ok = payload as BtcSuggestResponse;
      suggestion.value = ok.suggestion;
      market.value = ok.market;
      generatedAt.value = ok.generatedAt;
      error.value = null;
      persist({
        suggestion: ok.suggestion,
        market: ok.market,
        generatedAt: ok.generatedAt,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      error.value =
        err instanceof Error ? err.message : "Failed to get suggestion";
    } finally {
      pending.value = false;
    }
  }

  function clear() {
    suggestion.value = null;
    market.value = null;
    generatedAt.value = null;
    error.value = null;
    clearStored();
  }

  onUnmounted(() => {
    abortController?.abort();
  });

  return {
    suggestion,
    market,
    generatedAt,
    pending,
    error,
    request,
    clear,
  };
}
