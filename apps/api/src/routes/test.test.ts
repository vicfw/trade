import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BtcTicker, Candle } from "@trade/shared";
import type { PerpCandleCoverage } from "../market/perpCandleStore";

function candle(openTime: number, high: number, low: number): Candle {
  return {
    openTime,
    open: String((high + low) / 2),
    high: String(high),
    low: String(low),
    close: String((high + low) / 2),
    volume: "1",
    closeTime: openTime + 60_000 - 1,
    quoteVolume: "0",
    isClosed: true,
  };
}

const coverageState: PerpCandleCoverage = {
  candles: [],
  coversSince: true,
  coverageStart: null,
  gapCount: 0,
  staleTail: false,
};

const tickerState = {
  latest: null as BtcTicker | null,
};

mock.module("../lbank/client", () => ({
  lbankTickerClient: {
    get latest() {
      return tickerState.latest;
    },
  },
}));

mock.module("../market/tracking", () => ({
  perpCandleStore: {
    coverage: () => ({ ...coverageState, candles: [...coverageState.candles] }),
  },
  tradeStore: {
    recordClosedTrade: () => {},
  },
}));

const { btcPositionTracker } = await import("../market/positionTracker");
const { testRoutes } = await import("./test");

const now = Date.now();
const since = now - 60 * 60_000; // 1h ago

function setPerpCandles(candles: Candle[], coversSince = true) {
  coverageState.candles = candles;
  coverageState.coversSince = coversSince;
  coverageState.coverageStart = candles[0]?.openTime ?? null;
  coverageState.gapCount = 0;
  coverageState.staleTail = false;
}

describe("POST /test/btc", () => {
  beforeEach(() => {
    setPerpCandles([]);
    tickerState.latest = null;
    btcPositionTracker.clear();
  });

  test("returns successful when take-profit hit on perp candles", async () => {
    setPerpCandles([
      candle(since, 101_000, 99_500), // entry fill
      candle(since + 60_000, 106_500, 105_500), // TP
    ]);

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("successful");
    expect(body.hitReason).toBe("take_profit");
    expect(body.triggeredAt).toBe(since);
    expect(body.priceSource).toBe("perpetual_candles");
    expect(body.interval).toBe("1m");
  });

  test("returns failed when stop-loss hit on perp candles", async () => {
    setPerpCandles([candle(since + 60_000, 99_000, 97_500)]);

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.hitReason).toBe("stop_loss");
    expect(body.priceSource).toBe("perpetual_candles");
  });

  test("returns waiting when entry filled but neither SL nor TP", async () => {
    setPerpCandles([candle(since + 60_000, 101_000, 99_500)]);

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("waiting");
    expect(body.triggeredAt).toBe(since + 60_000);
    expect(body.hitAt).toBeNull();
  });

  test("returns not_triggered when entry never touched", async () => {
    setPerpCandles([candle(since + 60_000, 103_000, 101_000)]);

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("not_triggered");
    expect(body.triggeredAt).toBeNull();
    expect(body.hitAt).toBeNull();
  });

  test("uses the live perpetual price when candles have not crossed entry", async () => {
    const eventTime = Date.now();
    setPerpCandles([candle(since + 60_000, 64_800, 64_700)]);
    tickerState.latest = {
      symbol: "BTCUSDT",
      price: "64613.40",
      changePercent24h: "0",
      high24h: "65000",
      low24h: "64000",
      volume24h: "1",
      quoteVolume24h: "1",
      eventTime,
    };

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 64_623.4,
        stopLoss: 64_000,
        takeProfit: 66_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("waiting");
    expect(body.triggeredAt).toBe(eventTime);
    expect(body.currentPrice).toBe(64_613.4);
    expect(body.priceSource).toBe("perpetual_ticks");
    expect(body.observationsChecked).toBeGreaterThanOrEqual(1);
  });

  test("returns tracked perpetual tick state without needing candles", async () => {
    const trackedSince = Date.now() - 30_000;
    const request = {
      side: "long" as const,
      entry: 100_000,
      stopLoss: 98_000,
      takeProfit: 106_000,
      since: trackedSince,
    };
    btcPositionTracker.track(request, {
      price: 99_500,
      observedAt: trackedSince,
    });
    // Force a closed state via another tick so Test returns tick evidence.
    btcPositionTracker.observePrice({
      price: 106_500,
      observedAt: trackedSince + 1_000,
    });

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("successful");
    expect(body.interval).toBe("tick");
    expect(body.priceSource).toBe("perpetual_ticks");
    expect(body.hitReason).toBe("take_profit");
  });

  test("warns when local perp record starts after since", async () => {
    const coverageStart = since + 30 * 60_000;
    setPerpCandles(
      [
        candle(coverageStart, 101_000, 99_500),
        candle(coverageStart + 60_000, 106_500, 105_500),
      ],
      false,
    );

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("successful");
    expect(body.priceSource).toBe("perpetual_candles");
    expect(
      body.warnings.some((w: string) =>
        w.includes("span before that was not checked"),
      ),
    ).toBe(true);
  });

  test("reports not_triggered with warning when no perp data exists", async () => {
    setPerpCandles([]);

    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("not_triggered");
    expect(body.priceSource).toBe("perpetual_ticks");
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  test("rejects invalid side", async () => {
    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "no_trade",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects invalid long geometry", async () => {
    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 102_000,
        takeProfit: 106_000,
        since,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects since in the future", async () => {
    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since: now + 60_000,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects since older than the lookback limit", async () => {
    const res = await testRoutes.request("/test/btc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side: "long",
        entry: 100_000,
        stopLoss: 98_000,
        takeProfit: 106_000,
        since: now - 30 * 24 * 60 * 60 * 1000,
      }),
    });
    expect(res.status).toBe(400);
  });
});
