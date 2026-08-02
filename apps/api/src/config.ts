import {
  isKlineInterval,
  KLINE_INTERVALS,
  type KlineInterval,
} from "@trade/shared";

export type LlmProvider = "gapgpt" | "moonshot";

const LLM_PROVIDERS = ["gapgpt", "moonshot"] as const;

const LLM_PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { baseUrl: string; model: string; apiKeyEnv: string }
> = {
  gapgpt: {
    baseUrl: "https://api.gapgpt.app/v1",
    model: "gemini-2.5-flash-lite",
    apiKeyEnv: "GAPGPT_API_KEY",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k3",
    apiKeyEnv: "MOONSHOT_API_KEY",
  },
};

const DEFAULT_PERP_KLINE_PERIODS = ["1m", "15m", "1h", "4h"] as const;

function parseIntervals(raw: string | undefined): KlineInterval[] {
  if (!raw?.trim()) {
    return [...KLINE_INTERVALS];
  }

  const parts = raw.split(",").map((part) => part.trim());
  const intervals: KlineInterval[] = [];

  for (const part of parts) {
    if (!isKlineInterval(part)) {
      throw new Error(
        `Invalid CANDLE_INTERVALS entry "${part}". Expected one of: ${KLINE_INTERVALS.join(", ")}`,
      );
    }
    if (!intervals.includes(part)) {
      intervals.push(part);
    }
  }

  return intervals;
}

function parsePerpKlinePeriods(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [...DEFAULT_PERP_KLINE_PERIODS];
  }

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const periods: string[] = [];
  for (const part of parts) {
    if (!periods.includes(part)) periods.push(part);
  }

  if (!periods.includes("1m")) {
    periods.unshift("1m");
  }

  return periods;
}

function parseLlmProvider(raw: string | undefined): LlmProvider {
  const value = (raw ?? "gapgpt").trim().toLowerCase();
  // "kimi" is accepted as an alias for the Moonshot platform.
  if (value === "kimi") return "moonshot";
  if ((LLM_PROVIDERS as readonly string[]).includes(value)) {
    return value as LlmProvider;
  }
  throw new Error(
    `Invalid LLM_PROVIDER "${raw}". Expected one of: ${LLM_PROVIDERS.join(", ")}, kimi`,
  );
}

function resolveLlmConfig(provider: LlmProvider) {
  const defaults = LLM_PROVIDER_DEFAULTS[provider];

  if (provider === "gapgpt") {
    return {
      provider,
      apiKey: process.env.GAPGPT_API_KEY ?? "",
      apiKeyEnv: defaults.apiKeyEnv,
      baseUrl: process.env.GAPGPT_BASE_URL ?? defaults.baseUrl,
      model: defaults.model,
    };
  }

  return {
    provider,
    apiKey: process.env.MOONSHOT_API_KEY ?? "",
    apiKeyEnv: defaults.apiKeyEnv,
    baseUrl: process.env.MOONSHOT_BASE_URL ?? defaults.baseUrl,
    model: defaults.model,
  };
}

const llmProvider = parseLlmProvider(process.env.LLM_PROVIDER);
const llm = resolveLlmConfig(llmProvider);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Futures market WS (perp last price). */
  lbankWsUrl: process.env.LBANK_WS_URL ?? "wss://uuws.lbank.com/ws/v3",
  /** Futures public REST — ticker fallback via marketData. */
  lbankPerpRestUrl:
    process.env.LBANK_PERP_REST_URL ?? "https://lbkperp.lbank.com",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  /** Perp instrument id, e.g. BTCUSDT. */
  tickerSymbol: process.env.TICKER_SYMBOL ?? "BTCUSDT",
  perpProductGroup: process.env.PERP_PRODUCT_GROUP ?? "SwapU",
  /**
   * Perp WS kline periods to subscribe (must include 1m for tracking).
   * HTF periods feed suggest / indicators / chart.
   */
  perpKlinePeriods: parsePerpKlinePeriods(process.env.PERP_KLINE_PERIODS),
  /**
   * SQLite file for perp candles / tracked positions / trade history.
   * Relative paths resolve against the apps/api package root.
   */
  dbPath: process.env.DB_PATH ?? "data/trade.db",
  /** HTF intervals for suggest / indicators / chart (perp store). */
  candleIntervals: parseIntervals(process.env.CANDLE_INTERVALS),
  /** Active LLM backend: gapgpt or moonshot (Kimi). */
  llm,
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
  llmCandleWindow: Number(process.env.LLM_CANDLE_WINDOW ?? 60),
  suggestCooldownMs: Number(process.env.SUGGEST_COOLDOWN_MS ?? 15_000),
} as const;
