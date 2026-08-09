import type {
  BtcPositionTestRequest,
  BtcTicker,
  PositionTestHitReason,
  PositionTestStatus,
} from "@trade/shared";

const TRACKING_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const MAX_LIVE_TICKER_AGE_MS = 30_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5_000;
/** Default: cancel unfilled limit entries after 2h. */
export const DEFAULT_ENTRY_TIMEOUT_MS = 7_200_000;

export interface PerpPriceObservation {
  price: number;
  observedAt: number;
}

export function freshPerpObservation(
  ticker: BtcTicker | null,
  now = Date.now(),
): PerpPriceObservation | null {
  if (!ticker || !Number.isFinite(ticker.eventTime)) return null;

  const age = now - ticker.eventTime;
  if (age > MAX_LIVE_TICKER_AGE_MS || age < -MAX_FUTURE_CLOCK_SKEW_MS) {
    return null;
  }

  const price = Number(ticker.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, observedAt: ticker.eventTime };
}

/** What closed (or advanced) the position — live perp ticks or stored perp candles. */
export type PositionEvidence = "ticks" | "candles";

export interface TrackedPositionResult {
  status: PositionTestStatus;
  triggeredAt: number | null;
  hitAt: number | null;
  hitReason: PositionTestHitReason | null;
  observationsChecked: number;
  currentPrice: number | null;
  lastObservedAt: number | null;
  evidence: PositionEvidence;
}

export interface TrackedPositionSnapshot extends TrackedPositionResult {
  key: string;
  request: BtcPositionTestRequest;
}

export interface RestoredPositionState {
  request: BtcPositionTestRequest;
  status: PositionTestStatus;
  triggeredAt: number | null;
  hitAt: number | null;
  hitReason: PositionTestHitReason | null;
}

/** Candle-derived outcome used to upgrade a tracked position. */
export interface CandleOutcome {
  status: PositionTestStatus;
  triggeredAt: number | null;
  hitAt: number | null;
  hitReason: PositionTestHitReason | null;
}

type UpdateListener = (snapshot: TrackedPositionSnapshot) => void;

interface TrackedPosition extends TrackedPositionResult {
  request: BtcPositionTestRequest;
}

export function positionKey(request: BtcPositionTestRequest): string {
  return JSON.stringify([
    request.since,
    request.side,
    request.entry,
    request.stopLoss,
    request.takeProfit,
  ]);
}

function entryTouched(request: BtcPositionTestRequest, price: number): boolean {
  return request.side === "long"
    ? price <= request.entry
    : price >= request.entry;
}

function hitReason(
  request: BtcPositionTestRequest,
  price: number,
): PositionTestHitReason | null {
  if (request.side === "long") {
    if (price <= request.stopLoss) return "stop_loss";
    if (price >= request.takeProfit) return "take_profit";
    return null;
  }

  if (price >= request.stopLoss) return "stop_loss";
  if (price <= request.takeProfit) return "take_profit";
  return null;
}

function isClosed(status: PositionTestStatus): boolean {
  return (
    status === "successful" || status === "failed" || status === "expired"
  );
}

function publicResult(position: TrackedPosition): TrackedPositionResult {
  return {
    status: position.status,
    triggeredAt: position.triggeredAt,
    hitAt: position.hitAt,
    hitReason: position.hitReason,
    observationsChecked: position.observationsChecked,
    currentPrice: position.currentPrice,
    lastObservedAt: position.lastObservedAt,
    evidence: position.evidence,
  };
}

function snapshot(key: string, position: TrackedPosition): TrackedPositionSnapshot {
  return {
    key,
    request: { ...position.request },
    ...publicResult(position),
  };
}

/**
 * Tracks suggestions against ordered BTCUSDT perpetual ticker updates, and
 * accepts candle-derived upgrades (from the stored perp 1m record) so brief
 * spikes between ticks or API downtime are still caught.
 *
 * A tracked position only moves forward:
 * not_triggered -> waiting -> successful/failed
 * not_triggered -> expired (entry timeout)
 */
export class PerpetualPositionTracker {
  private positions = new Map<string, TrackedPosition>();
  private updateListener: UpdateListener | null = null;
  private entryTimeoutMs: number;

  constructor(entryTimeoutMs = DEFAULT_ENTRY_TIMEOUT_MS) {
    this.entryTimeoutMs =
      Number.isFinite(entryTimeoutMs) && entryTimeoutMs > 0
        ? entryTimeoutMs
        : DEFAULT_ENTRY_TIMEOUT_MS;
  }

  setEntryTimeoutMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) {
      this.entryTimeoutMs = ms;
    }
  }

  /** Called after a position is created or changes status. */
  setOnUpdate(listener: UpdateListener | null): void {
    this.updateListener = listener;
  }

  track(
    request: BtcPositionTestRequest,
    initialObservation?: PerpPriceObservation,
  ): TrackedPositionResult {
    this.prune(Date.now());

    const key = positionKey(request);
    const existing = this.positions.get(key);
    if (existing) return publicResult(existing);

    const position: TrackedPosition = {
      request: { ...request },
      status: "not_triggered",
      triggeredAt: null,
      hitAt: null,
      hitReason: null,
      observationsChecked: 0,
      currentPrice: null,
      lastObservedAt: null,
      evidence: "ticks",
    };
    this.positions.set(key, position);
    this.emit(key, position);

    if (initialObservation) {
      this.applyObservation(key, position, initialObservation);
    }

    this.expireIfNeeded(key, position, Date.now());

    return publicResult(position);
  }

  /** Reload previously persisted positions (API restart). */
  restore(states: RestoredPositionState[]): void {
    const now = Date.now();
    const oldestAllowed = now - TRACKING_RETENTION_MS;

    for (const state of states) {
      if (state.request.since < oldestAllowed) continue;
      const key = positionKey(state.request);
      if (this.positions.has(key)) continue;

      this.positions.set(key, {
        request: { ...state.request },
        status: state.status,
        triggeredAt: state.triggeredAt,
        hitAt: state.hitAt,
        hitReason: state.hitReason,
        observationsChecked: 0,
        currentPrice: null,
        lastObservedAt: null,
        evidence: "ticks",
      });
    }
  }

  get(request: BtcPositionTestRequest): TrackedPositionResult | null {
    this.prune(Date.now());
    const position = this.positions.get(positionKey(request));
    return position ? publicResult(position) : null;
  }

  /** Snapshots of every tracked position (open and closed). */
  list(): TrackedPositionSnapshot[] {
    this.prune(Date.now());
    return [...this.positions.entries()].map(([key, position]) =>
      snapshot(key, position),
    );
  }

  observeTicker(ticker: BtcTicker): void {
    const price = Number(ticker.price);
    if (!Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(ticker.eventTime)) return;

    this.observePrice({ price, observedAt: ticker.eventTime });
  }

  observePrice(observation: PerpPriceObservation): void {
    if (
      !Number.isFinite(observation.price) ||
      observation.price <= 0 ||
      !Number.isFinite(observation.observedAt)
    ) {
      return;
    }

    this.prune(observation.observedAt);
    for (const [key, position] of this.positions) {
      this.applyObservation(key, position, observation);
    }
    this.expireStaleEntries(observation.observedAt);
  }

  /**
   * Upgrade a position from a candle-based evaluation of the stored perp 1m
   * record. Only moves state forward — never downgrades tick-observed state.
   */
  applyCandleOutcome(
    request: BtcPositionTestRequest,
    outcome: CandleOutcome,
  ): TrackedPositionResult | null {
    const key = positionKey(request);
    const position = this.positions.get(key);
    if (!position) return null;
    if (isClosed(position.status)) return publicResult(position);

    let changed = false;

    if (
      position.status === "not_triggered" &&
      (outcome.status === "waiting" || isClosed(outcome.status)) &&
      outcome.triggeredAt != null
    ) {
      position.status = "waiting";
      position.triggeredAt = outcome.triggeredAt;
      changed = true;
    }

    if (
      (outcome.status === "successful" || outcome.status === "failed") &&
      outcome.hitReason &&
      outcome.hitAt != null
    ) {
      position.status = outcome.status;
      position.hitAt = outcome.hitAt;
      position.hitReason = outcome.hitReason;
      position.evidence = "candles";
      changed = true;
    }

    if (changed) this.emit(key, position);
    this.expireIfNeeded(key, position, Date.now());
    return publicResult(position);
  }

  /** Expire limit entries that never filled within the timeout. */
  expireStaleEntries(now = Date.now()): number {
    let expired = 0;
    for (const [key, position] of this.positions) {
      if (this.expireIfNeeded(key, position, now)) expired += 1;
    }
    return expired;
  }

  clear(): void {
    this.positions.clear();
  }

  private expireIfNeeded(
    key: string,
    position: TrackedPosition,
    now: number,
  ): boolean {
    if (position.status !== "not_triggered") return false;
    if (now - position.request.since < this.entryTimeoutMs) return false;

    position.status = "expired";
    position.hitAt = now;
    position.hitReason = null;
    this.emit(key, position);
    return true;
  }

  private applyObservation(
    key: string,
    position: TrackedPosition,
    observation: PerpPriceObservation,
  ): void {
    if (
      isClosed(position.status) ||
      observation.observedAt < position.request.since ||
      (position.lastObservedAt != null &&
        observation.observedAt < position.lastObservedAt)
    ) {
      return;
    }

    position.observationsChecked += 1;
    position.currentPrice = observation.price;
    position.lastObservedAt = observation.observedAt;

    if (position.status === "not_triggered") {
      if (!entryTouched(position.request, observation.price)) return;
      position.status = "waiting";
      position.triggeredAt = observation.observedAt;
      this.emit(key, position);
    }

    const reason = hitReason(position.request, observation.price);
    if (!reason) return;

    position.status = reason === "take_profit" ? "successful" : "failed";
    position.hitAt = observation.observedAt;
    position.hitReason = reason;
    position.evidence = "ticks";
    this.emit(key, position);
  }

  private emit(key: string, position: TrackedPosition): void {
    this.updateListener?.(snapshot(key, position));
  }

  private prune(now: number): void {
    const oldestAllowed = now - TRACKING_RETENTION_MS;
    for (const [key, position] of this.positions) {
      if (position.request.since < oldestAllowed) {
        this.positions.delete(key);
      }
    }
  }
}

export const btcPositionTracker = new PerpetualPositionTracker();
