import { Hono } from "hono";
import {
  computeIntervalIndicators,
  finalizeSuggestion,
  validateRiskRules,
} from "@trade/market";
import type { BtcSuggestResponse } from "@trade/shared";
import { config } from "../config";
import { lbankTickerClient } from "../lbank/client";
import {
  buildMarketSnapshot,
  isMarketDataReady,
  MIN_SNAPSHOT_CLOSED_BARS,
} from "../market/buildSnapshot";
import {
  btcPositionTracker,
  freshPerpObservation,
} from "../market/positionTracker";
import { perpCandleStore } from "../market/tracking";
import { llmClient } from "../llm/llmClient";
import { logLlmSnapshot } from "../llm/logSnapshot";

export const suggestRoutes = new Hono();

let inFlight = false;
let lastSuggestAt = 0;

/** Test-only: clear rate-limit / in-flight guards between cases. */
export function resetSuggestGuardsForTests(): void {
  inFlight = false;
  lastSuggestAt = 0;
}

suggestRoutes.post("/suggest/btc", async (c) => {
  if (!llmClient.isConfigured()) {
    return c.json(
      {
        error: `LLM not configured. Set ${config.llm.apiKeyEnv} for provider "${config.llm.provider}".`,
      },
      503,
    );
  }

  if (inFlight) {
    return c.json(
      {
        error:
          "A suggestion request is already in progress. Try again shortly.",
      },
      429,
    );
  }

  const sinceLast = Date.now() - lastSuggestAt;
  if (lastSuggestAt > 0 && sinceLast < config.suggestCooldownMs) {
    const retryAfterSec = Math.ceil(
      (config.suggestCooldownMs - sinceLast) / 1000,
    );
    return c.json(
      {
        error: `Please wait ${retryAfterSec}s before requesting another suggestion.`,
        retryAfterSec,
      },
      429,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  let risk;
  try {
    risk = validateRiskRules(body);
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : "Invalid risk rules",
      },
      400,
    );
  }

  // WS-fed perp HTF bars need a warm-up; aggregate from 1m and wait briefly.
  await perpCandleStore.ensureReady(
    config.candleIntervals,
    MIN_SNAPSHOT_CLOSED_BARS,
  );

  let snapshot = buildMarketSnapshot({
    symbol: config.tickerSymbol,
    intervals: config.candleIntervals,
    getCandles: (interval) => perpCandleStore.get(interval),
    ticker: lbankTickerClient.latest,
    candleWindow: config.llmCandleWindow,
  });

  if (!isMarketDataReady(snapshot)) {
    const detail =
      snapshot.warnings.length > 0
        ? ` ${snapshot.warnings.join("; ")}.`
        : "";
    return c.json(
      {
        error: `Perp market data not ready. Need at least ${MIN_SNAPSHOT_CLOSED_BARS} closed bars per timeframe (15m / 1h / 4h) from the futures WS or 1m aggregation.${detail}`,
      },
      503,
    );
  }

  inFlight = true;
  const startedAt = Date.now();
  console.log(
    `[suggest] start provider=${config.llm.provider} model=${config.llm.model} timeoutMs=${config.llmTimeoutMs} price=${snapshot.ticker.price} bias4h=${snapshot.context.bias4h} structure1h=${snapshot.context.structure1h}`,
  );
  try {
    logLlmSnapshot(snapshot);
    const proposal = await llmClient.suggestPosition(snapshot);
    const entryTf = snapshot.intervals.find((item) => item.interval === "15m");
    const suggestion = finalizeSuggestion(proposal, risk, {
      bias4h: snapshot.context.bias4h,
      structure1h: snapshot.context.structure1h,
      entryIndicators:
        entryTf?.indicators ?? computeIntervalIndicators([]),
    });

    lastSuggestAt = Date.now();

    if (
      (suggestion.side === "long" || suggestion.side === "short") &&
      suggestion.levels
    ) {
      const livePerp = freshPerpObservation(
        lbankTickerClient.latest,
        lastSuggestAt,
      );
      btcPositionTracker.track(
        {
          side: suggestion.side,
          entry: suggestion.levels.entry,
          stopLoss: suggestion.levels.stopLoss,
          takeProfit: suggestion.levels.takeProfit,
          since: lastSuggestAt,
        },
        livePerp
          ? { price: livePerp.price, observedAt: lastSuggestAt }
          : undefined,
      );
    }

    const response: BtcSuggestResponse = {
      symbol: config.tickerSymbol,
      generatedAt: lastSuggestAt,
      snapshotAt: snapshot.snapshotAt,
      suggestion,
      market: {
        price: snapshot.ticker.price,
        bias4h: snapshot.context.bias4h,
        structure1h: snapshot.context.structure1h,
      },
    };

    console.log(
      `[suggest] ok elapsedMs=${Date.now() - startedAt} side=${suggestion.side} confidence=${suggestion.confidence} warnings=${suggestion.warnings.length}`,
    );
    return c.json(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Suggestion request failed";
    console.error(
      `[suggest] failed elapsedMs=${Date.now() - startedAt} provider=${config.llm.provider} model=${config.llm.model}: ${message}`,
    );
    return c.json({ error: message }, 502);
  } finally {
    inFlight = false;
  }
});
