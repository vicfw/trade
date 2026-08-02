import { describe, expect, test } from "bun:test";
import type { BtcPositionTestRequest } from "@trade/shared";
import { PerpetualPositionTracker } from "./positionTracker";

const SINCE = Date.now() - 60_000;

function longRequest(
  overrides: Partial<BtcPositionTestRequest> = {},
): BtcPositionTestRequest {
  return {
    side: "long",
    entry: 100_000,
    stopLoss: 98_000,
    takeProfit: 106_000,
    since: SINCE,
    ...overrides,
  };
}

describe("PerpetualPositionTracker", () => {
  test("moves through not_triggered, waiting, and successful in order", () => {
    const tracker = new PerpetualPositionTracker();
    const request = longRequest();

    expect(
      tracker.track(request, { price: 101_000, observedAt: SINCE }).status,
    ).toBe("not_triggered");

    tracker.observePrice({ price: 99_900, observedAt: SINCE + 1_000 });
    const waiting = tracker.get(request)!;
    expect(waiting.status).toBe("waiting");
    expect(waiting.triggeredAt).toBe(SINCE + 1_000);

    tracker.observePrice({ price: 106_100, observedAt: SINCE + 2_000 });
    const successful = tracker.get(request)!;
    expect(successful.status).toBe("successful");
    expect(successful.hitReason).toBe("take_profit");
    expect(successful.hitAt).toBe(SINCE + 2_000);
  });

  test("reports failed when stop-loss is reached after entry", () => {
    const tracker = new PerpetualPositionTracker();
    const request = longRequest({ since: SINCE + 10_000 });

    tracker.track(request, {
      price: 99_500,
      observedAt: SINCE + 10_000,
    });
    tracker.observePrice({ price: 97_900, observedAt: SINCE + 11_000 });

    const result = tracker.get(request)!;
    expect(result.status).toBe("failed");
    expect(result.hitReason).toBe("stop_loss");
  });

  test("uses inverse entry and exit comparisons for shorts", () => {
    const tracker = new PerpetualPositionTracker();
    const request = longRequest({
      side: "short",
      entry: 100_000,
      stopLoss: 102_000,
      takeProfit: 94_000,
      since: SINCE + 20_000,
    });

    tracker.track(request, {
      price: 99_000,
      observedAt: SINCE + 20_000,
    });
    expect(tracker.get(request)!.status).toBe("not_triggered");

    tracker.observePrice({ price: 100_100, observedAt: SINCE + 21_000 });
    expect(tracker.get(request)!.status).toBe("waiting");

    tracker.observePrice({ price: 93_900, observedAt: SINCE + 22_000 });
    expect(tracker.get(request)!.status).toBe("successful");
  });

  test("does not overwrite a terminal outcome with later prices", () => {
    const tracker = new PerpetualPositionTracker();
    const request = longRequest({ since: SINCE + 30_000 });

    tracker.track(request, {
      price: 100_000,
      observedAt: SINCE + 30_000,
    });
    tracker.observePrice({ price: 97_900, observedAt: SINCE + 31_000 });
    tracker.observePrice({ price: 107_000, observedAt: SINCE + 32_000 });

    const result = tracker.get(request)!;
    expect(result.status).toBe("failed");
    expect(result.hitAt).toBe(SINCE + 31_000);
    expect(result.currentPrice).toBe(97_900);
  });

  test("ignores observations before the suggestion or out of order", () => {
    const tracker = new PerpetualPositionTracker();
    const request = longRequest({ since: SINCE + 40_000 });

    tracker.track(request);
    tracker.observePrice({ price: 99_000, observedAt: SINCE + 39_000 });
    expect(tracker.get(request)!.status).toBe("not_triggered");

    tracker.observePrice({ price: 101_000, observedAt: SINCE + 42_000 });
    tracker.observePrice({ price: 99_000, observedAt: SINCE + 41_000 });

    const result = tracker.get(request)!;
    expect(result.status).toBe("not_triggered");
    expect(result.observationsChecked).toBe(1);
  });
});
