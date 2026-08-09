import {
  isKlineInterval,
  KLINE_INTERVALS,
  type KlineInterval,
} from "@trade/shared";

export type LlmProvider = "gapgpt" | "moonshot" | "agentrouter";

const LLM_PROVIDERS = ["gapgpt", "moonshot", "agentrouter"] as const;

const LLM_PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { baseUrl: string; model: string; apiKeyEnv: string; baseUrlEnv: string }
> = {
  gapgpt: {
    baseUrl: "https://api.gapgpt.app/v1",
    model: "deepseek-r1",
    apiKeyEnv: "GAPGPT_API_KEY",
    baseUrlEnv: "GAPGPT_BASE_URL",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k3",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
  },
  agentrouter: {
    baseUrl: "https://agentrouter.org/v1",
    model: "claude-opus-4-8",
    apiKeyEnv: "AGENTROUTER_API_KEY",
    baseUrlEnv: "AGENTROUTER_BASE_URL",
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

/** Parse `HH:mm` wall-clock times for the analysis window. */
function parseHm(
  raw: string,
  envName = "time",
): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) {
    throw new Error(
      `Invalid ${envName} "${raw}". Expected HH:mm (e.g. 17:00).`,
    );
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(
      `Invalid ${envName} "${raw}". Hour must be 0–23 and minute 0–59.`,
    );
  }
  return { hour, minute };
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
  return {
    provider,
    apiKey: process.env[defaults.apiKeyEnv] ?? "",
    apiKeyEnv: defaults.apiKeyEnv,
    baseUrl: process.env[defaults.baseUrlEnv] ?? defaults.baseUrl,
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
  /** Active LLM backend: gapgpt, moonshot (Kimi), or agentrouter. */
  llm,
  /** deepseek-r1 and other reasoning models often need 1–3+ minutes. */
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180_000),
  llmCandleWindow: Number(process.env.LLM_CANDLE_WINDOW ?? 60),
  suggestCooldownMs: Number(process.env.SUGGEST_COOLDOWN_MS ?? 15_000),
  /** Auto re-analysis delay after no_trade (default 45m). */
  analysisIntervalMs: Number(process.env.ANALYSIS_INTERVAL_MS ?? 2_700_000),
  /**
   * Cancel unfilled limit entries after this long (default 2h).
   * Filled positions (waiting for SL/TP) are not affected.
   */
  entryTimeoutMs: Number(process.env.ENTRY_TIMEOUT_MS ?? 7_200_000),
  /** Retry delay after a failed auto-analysis run. */
  analysisRetryMs: Number(process.env.ANALYSIS_RETRY_MS ?? 300_000),
  /** IANA timezone for the auto-analysis daily window. */
  analysisTz: process.env.ANALYSIS_TZ ?? "Asia/Tehran",
  /** Local wall-clock start of the auto-analysis window (HH:mm, inclusive). */
  analysisWindowStart: parseHm(
    process.env.ANALYSIS_WINDOW_START ?? "17:00",
    "ANALYSIS_WINDOW_START",
  ),
  /** Local wall-clock end of the auto-analysis window (HH:mm, exclusive). */
  analysisWindowEnd: parseHm(
    process.env.ANALYSIS_WINDOW_END ?? "01:00",
    "ANALYSIS_WINDOW_END",
  ),
} as const;
