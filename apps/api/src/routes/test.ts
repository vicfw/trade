import { Hono } from "hono";
import { evaluatePositionOutcome } from "@trade/market";
import type {
  BtcPositionTestRequest,
  BtcPositionTestResponse,
  Candle,
  PositionTestPriceSource,
} from "@trade/shared";
import { lbankTickerClient } from "../lbank/client";
import {
  btcPositionTracker,
  freshPerpObservation,
  type PerpPriceObservation,
  type TrackedPositionResult,
} from "../market/positionTracker";
import { perpCandleStore } from "../market/tracking";

export const testRoutes = new Hono();

/** ~20 days — oldest `since` we still attempt to check against the local perp record. */
const MAX_LOOKBACK_MS = 20 * 24 * 60 * 60 * 1000;

function priceObservationCandle(
  observation: PerpPriceObservation,
): Candle {
  const price = String(observation.price);
  return {
    openTime: observation.observedAt,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: "0",
    closeTime: observation.observedAt,
    quoteVolume: "0",
    isClosed: true,
  };
}

function validateTestRequest(raw: unknown): BtcPositionTestRequest {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Request body must be an object");
  }

  const obj = raw as Record<string, unknown>;

  if (obj.side !== "long" && obj.side !== "short") {
    throw new Error('side must be "long" or "short"');
  }

  const entry = Number(obj.entry);
  const stopLoss = Number(obj.stopLoss);
  const takeProfit = Number(obj.takeProfit);
  const since = Number(obj.since);

  for (const [name, value] of [
    ["entry", entry],
    ["stopLoss", stopLoss],
    ["takeProfit", takeProfit],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number`);
    }
  }

  if (obj.side === "long" && !(stopLoss < entry && entry < takeProfit)) {
    throw new Error("Long requires stopLoss < entry < takeProfit");
  }
  if (obj.side === "short" && !(takeProfit < entry && entry < stopLoss)) {
    throw new Error("Short requires takeProfit < entry < stopLoss");
  }

  if (!Number.isFinite(since)) {
    throw new Error("since must be a finite timestamp in ms");
  }

  const now = Date.now();
  if (since > now) {
    throw new Error("since cannot be in the future");
  }
  if (now - since > MAX_LOOKBACK_MS) {
    throw new Error(
      `since is too old to check; limit is ${Math.floor(MAX_LOOKBACK_MS / 86_400_000)} days`,
    );
  }

  return { side: obj.side, entry, stopLoss, takeProfit, since };
}

function isClosedStatus(status: TrackedPositionResult["status"]): boolean {
  return status === "successful" || status === "failed";
}

function trackedResponse(
  request: BtcPositionTestRequest,
  tracked: TrackedPositionResult,
  checkedAt: number,
  livePerp: PerpPriceObservation | null,
  extraWarnings: string[] = [],
): BtcPositionTestResponse {
  const warnings = [...extraWarnings];
  if (!livePerp) {
    warnings.push(
      "Live BTCUSDT perpetual ticker is unavailable or stale; status reflects the last recorded perpetual data",
    );
  }

  const fromCandles = tracked.evidence === "candles";
  return {
    status: tracked.status,
    side: request.side,
    since: request.since,
    checkedAt,
    triggeredAt: tracked.triggeredAt,
    hitAt: tracked.hitAt,
    hitReason: tracked.hitReason,
    interval: fromCandles ? "1m" : "tick",
    priceSource: fromCandles ? "perpetual_candles" : "perpetual_ticks",
    currentPrice: livePerp?.price ?? tracked.currentPrice,
    candlesChecked: 0,
    observationsChecked: tracked.observationsChecked,
    warnings,
  };
}

/**
 * Check a suggestion against BTCUSDT perpetual data only:
 * live ticks (while the API is up) + the local 1m perp candle record.
 * LBank public REST has no perp history, so the stored WS record is the
 * source of truth for closed-bar OHLC.
 */
testRoutes.post("/test/btc", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  let request: BtcPositionTestRequest;
  try {
    request = validateTestRequest(body);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      400,
    );
  }

  const checkedAt = Date.now();
  const livePerp = freshPerpObservation(lbankTickerClient.latest, checkedAt);
  if (livePerp) {
    btcPositionTracker.observePrice(livePerp);
  }

  // Always register so subsequent ticks keep watching entry → SL/TP.
  let tracked = btcPositionTracker.get(request);
  if (!tracked) {
    tracked = btcPositionTracker.track(request, livePerp ?? undefined);
  } else {
    tracked = btcPositionTracker.get(request) ?? tracked;
  }

  if (isClosedStatus(tracked.status)) {
    return c.json(trackedResponse(request, tracked, checkedAt, livePerp));
  }

  const coverage = perpCandleStore.coverage(request.since, checkedAt);
  const evaluationCandles: Candle[] = [...coverage.candles];
  const includeLivePerp =
    livePerp != null && livePerp.observedAt >= request.since;
  if (includeLivePerp) {
    evaluationCandles.push(priceObservationCandle(livePerp));
  }

  const warnings: string[] = [];

  if (evaluationCandles.length === 0) {
    warnings.push(
      "No BTCUSDT perpetual candles or live price available yet — keep the API running so the futures WS can build the local 1m record, then Test again",
    );
    return c.json({
      status: tracked.status,
      side: request.side,
      since: request.since,
      checkedAt,
      triggeredAt: tracked.triggeredAt,
      hitAt: tracked.hitAt,
      hitReason: tracked.hitReason,
      interval: "tick" as const,
      priceSource: "perpetual_ticks" as PositionTestPriceSource,
      currentPrice: livePerp?.price ?? tracked.currentPrice,
      candlesChecked: 0,
      observationsChecked: tracked.observationsChecked,
      warnings,
    } satisfies BtcPositionTestResponse);
  }

  // Evaluate only the perpetual span we actually have. If the suggestion
  // predates the local record, skip the uncovered prefix.
  let evaluateSince = request.since;
  let alreadyTriggered =
    tracked.status === "waiting" && tracked.triggeredAt != null;

  if (!coverage.coversSince && coverage.coverageStart != null) {
    if (coverage.coverageStart > request.since) {
      warnings.push(
        `Local BTCUSDT perpetual 1m record starts at ${new Date(coverage.coverageStart).toISOString()}; the span before that was not checked`,
      );
      if (alreadyTriggered && tracked.triggeredAt! < coverage.coverageStart) {
        evaluateSince = coverage.coverageStart;
      } else if (!alreadyTriggered) {
        evaluateSince = coverage.coverageStart;
      }
    }
  }

  if (coverage.gapCount > 0) {
    warnings.push(
      `The stored perpetual candle record has ${coverage.gapCount} gap(s) in this range; price moves inside those gaps could not be checked`,
    );
  }

  if (coverage.staleTail && !includeLivePerp) {
    warnings.push(
      "The newest stored perpetual candle is stale and no fresh live ticker was available; the latest minutes may be missing",
    );
  }

  const rawOutcome = evaluatePositionOutcome(evaluationCandles, {
    side: request.side,
    entry: request.entry,
    stopLoss: request.stopLoss,
    takeProfit: request.takeProfit,
    since: evaluateSince,
    alreadyTriggered,
  });

  // Preserve a tick-observed fill that happened before the candle window.
  const outcome =
    alreadyTriggered &&
    rawOutcome.triggeredAt == null &&
    tracked.triggeredAt != null
      ? {
          ...rawOutcome,
          triggeredAt: tracked.triggeredAt,
          status:
            rawOutcome.status === "not_triggered"
              ? ("waiting" as const)
              : rawOutcome.status,
        }
      : rawOutcome;

  btcPositionTracker.applyCandleOutcome(request, outcome);
  if (livePerp) {
    btcPositionTracker.observePrice(livePerp);
  }

  const merged = btcPositionTracker.get(request);
  const status = merged?.status ?? outcome.status;
  const fromTicks = merged?.evidence === "ticks";

  const priceSource: PositionTestPriceSource = fromTicks
    ? "perpetual_ticks"
    : "perpetual_candles";

  const response: BtcPositionTestResponse = {
    status,
    side: request.side,
    since: request.since,
    checkedAt,
    triggeredAt: merged?.triggeredAt ?? outcome.triggeredAt,
    hitAt: merged?.hitAt ?? outcome.hitAt,
    hitReason: merged?.hitReason ?? outcome.hitReason,
    interval: fromTicks ? "tick" : "1m",
    priceSource,
    currentPrice: livePerp?.price ?? merged?.currentPrice ?? null,
    candlesChecked: Math.max(
      outcome.candlesChecked - (includeLivePerp ? 1 : 0),
      0,
    ),
    observationsChecked: merged?.observationsChecked ?? 0,
    warnings: [...outcome.warnings, ...warnings],
  };

  return c.json(response);
});
