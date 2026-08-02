import type { Database, Statement } from "bun:sqlite";
import { aggregateCandles, intervalDurationMs } from "@trade/market";
import {
  KLINE_INTERVALS,
  type Candle,
  type KlineInterval,
} from "@trade/shared";
import type { PerpKlineUpdate } from "../lbank/perpKline";

const MINUTE_MS = 60_000;
const RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const TRACKING_INTERVAL = "1m" as const;

/** Contiguity tolerance — LBank skips bars with zero trades (rare on BTC). */
const MAX_GAP_MS = 3 * MINUTE_MS;

/** Minimum closed HTF bars before suggest / indicators are considered ready. */
export const MIN_PERP_CLOSED_BARS = 30;

export type PerpStoredInterval = "1m" | KlineInterval;

const HTF_INTERVALS: readonly KlineInterval[] = KLINE_INTERVALS;

interface PerpCandleRow {
  open_time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

export interface PerpCandleCoverage {
  candles: Candle[];
  /** True when the stored record contiguously covers [since, now]. */
  coversSince: boolean;
  /** Earliest stored bar open time in the requested range, if any. */
  coverageStart: number | null;
  /** Number of >MAX_GAP_MS holes inside the requested range. */
  gapCount: number;
  /** True when the newest stored bar is too old to represent "now". */
  staleTail: boolean;
}

function isStoredInterval(value: string): value is PerpStoredInterval {
  return (
    value === "1m" || (KLINE_INTERVALS as readonly string[]).includes(value)
  );
}

function durationMs(interval: PerpStoredInterval): number {
  if (interval === "1m") return MINUTE_MS;
  return intervalDurationMs(interval);
}

/**
 * Persistent multi-interval BTCUSDT perpetual candles from the LBank futures
 * WS kline stream, with closed HTF bars also backfilled from 1m aggregation.
 */
export class PerpCandleStore {
  private upsertStmt: Statement;
  private rangeStmt: Statement;
  private allIntervalStmt: Statement;
  private getOneStmt: Statement;
  private deleteStrayOpenStmt: Statement;
  private pruneStmt: Statement;
  private countClosedStmt: Statement;
  private lastPruneAt = 0;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO perp_candles (
        interval, open_time, open, high, low, close, volume, turnover, update_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(interval, open_time) DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        turnover = excluded.turnover,
        update_time = excluded.update_time
    `);
    this.rangeStmt = db.prepare(`
      SELECT open_time, open, high, low, close, volume, turnover
      FROM perp_candles
      WHERE interval = ? AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `);
    this.allIntervalStmt = db.prepare(`
      SELECT open_time, open, high, low, close, volume, turnover
      FROM perp_candles
      WHERE interval = ?
      ORDER BY open_time ASC
    `);
    this.getOneStmt = db.prepare(`
      SELECT open_time, open, high, low, close, volume, turnover
      FROM perp_candles
      WHERE interval = ? AND open_time = ?
    `);
    this.deleteStrayOpenStmt = db.prepare(`
      DELETE FROM perp_candles
      WHERE interval = ?
        AND open_time != ?
        AND open_time + ? - 1 > ?
    `);
    this.pruneStmt = db.prepare("DELETE FROM perp_candles WHERE open_time < ?");
    this.countClosedStmt = db.prepare(`
      SELECT COUNT(*) AS count
      FROM perp_candles
      WHERE interval = ? AND open_time + ? - 1 <= ?
    `);

    this.backfillFrom1m();
  }

  apply(update: PerpKlineUpdate): void {
    if (!isStoredInterval(update.periodID)) return;

    const now = Date.now();
    const barCloseTime = update.beginTime + durationMs(update.periodID) - 1;
    const isOpenBar = barCloseTime > now;

    // Forming HTF bars are kept in sync via applyLivePrice (ticker).
    // Skipping open native HTF upserts avoids stale kline closes overwriting live price.
    if (isOpenBar && update.periodID !== TRACKING_INTERVAL) {
      return;
    }

    this.upsertStmt.run(
      update.periodID,
      update.beginTime,
      update.open,
      update.high,
      update.low,
      update.close,
      update.volume,
      update.turnover,
      update.updateTime,
    );

    if (update.periodID === TRACKING_INTERVAL) {
      this.upsertAggregatedAround(update.beginTime);
    }

    if (now - this.lastPruneAt > PRUNE_EVERY_MS) {
      this.lastPruneAt = now;
      this.pruneStmt.run(now - RETENTION_MS);
    }
  }

  /**
   * Keep every in-progress bar's close (and high/low envelope) aligned with the
   * live perpetual last price so chart + LLM snapshot match the ticker.
   */
  applyLivePrice(price: number, eventTimeMs = Date.now()): void {
    if (!Number.isFinite(price) || price <= 0) return;

    const now =
      Number.isFinite(eventTimeMs) && eventTimeMs > 0
        ? eventTimeMs
        : Date.now();
    const priceStr = String(price);
    const intervals: readonly PerpStoredInterval[] = [
      TRACKING_INTERVAL,
      ...HTF_INTERVALS,
    ];

    for (const interval of intervals) {
      const duration = durationMs(interval);
      const alignedOpen = Math.floor(now / duration) * duration;
      const alignedClose = alignedOpen + duration - 1;
      if (alignedClose <= now) continue;

      // Drop stray open HTF bars that are not on the current wall-clock bucket
      // (native WS sometimes emits misaligned beginTimes).
      if (interval !== TRACKING_INTERVAL) {
        this.deleteStrayOpenStmt.run(interval, alignedOpen, duration, now);
      }

      const existing = this.getOneStmt.get(interval, alignedOpen) as
        | PerpCandleRow
        | null
        | undefined;

      if (existing) {
        const high = Math.max(Number(existing.high), price);
        const low = Math.min(Number(existing.low), price);
        this.upsertStmt.run(
          interval,
          alignedOpen,
          existing.open,
          String(Number.isFinite(high) ? high : price),
          String(Number.isFinite(low) ? low : price),
          priceStr,
          existing.volume,
          existing.turnover,
          now,
        );
      } else {
        this.upsertStmt.run(
          interval,
          alignedOpen,
          priceStr,
          priceStr,
          priceStr,
          priceStr,
          "0",
          "0",
          now,
        );
      }
    }
  }

  /** All stored candles for an interval (including the in-progress bar). */
  get(interval: PerpStoredInterval): Candle[] {
    const rows = this.allIntervalStmt.all(interval) as PerpCandleRow[];
    return rows.map((row) => this.rowToCandle(interval, row));
  }

  closedCount(interval: PerpStoredInterval, now = Date.now()): number {
    const row = this.countClosedStmt.get(
      interval,
      durationMs(interval),
      now,
    ) as { count: number } | null;
    return row?.count ?? 0;
  }

  /**
   * True when every HTF interval has at least `minClosed` closed bars
   * (default {@link MIN_PERP_CLOSED_BARS}).
   */
  isReady(
    intervals: readonly KlineInterval[] = HTF_INTERVALS,
    minClosed = MIN_PERP_CLOSED_BARS,
  ): boolean {
    return intervals.every(
      (interval) => this.closedCount(interval) >= minClosed,
    );
  }

  /**
   * Refresh 1m→HTF aggregation, then briefly wait for WS-fed bars.
   * Callers must re-check {@link isReady}.
   */
  async ensureReady(
    intervals: readonly KlineInterval[] = HTF_INTERVALS,
    minClosed = MIN_PERP_CLOSED_BARS,
    waitMs = 3_000,
  ): Promise<void> {
    this.backfillFrom1m();
    if (this.isReady(intervals, minClosed)) return;

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await Bun.sleep(200);
      this.backfillFrom1m();
      if (this.isReady(intervals, minClosed)) return;
    }
  }

  /** Rebuild closed HTF bars from the full 1m record. */
  backfillFrom1m(now = Date.now()): void {
    const candles1m = this.get(TRACKING_INTERVAL);
    if (candles1m.length === 0) return;

    for (const interval of HTF_INTERVALS) {
      const aggregated = aggregateCandles(candles1m, interval, { now });
      for (const candle of aggregated) {
        this.upsertCandle(interval, candle, now);
      }
    }
  }

  /** 1m range used by position tracking / test. */
  getRange(fromMs: number, toMs = Date.now()): Candle[] {
    const alignedFrom = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
    const rows = this.rangeStmt.all(
      TRACKING_INTERVAL,
      alignedFrom,
      toMs,
    ) as PerpCandleRow[];
    return rows.map((row) => this.rowToCandle(TRACKING_INTERVAL, row));
  }

  /** Candles + contiguity analysis for evaluating a position since `sinceMs`. */
  coverage(sinceMs: number, now = Date.now()): PerpCandleCoverage {
    const candles = this.getRange(sinceMs, now);

    if (candles.length === 0) {
      return {
        candles,
        coversSince: false,
        coverageStart: null,
        gapCount: 0,
        staleTail: true,
      };
    }

    let gapCount = 0;
    for (let i = 1; i < candles.length; i += 1) {
      if (candles[i]!.openTime - candles[i - 1]!.openTime > MAX_GAP_MS) {
        gapCount += 1;
      }
    }

    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const coversStart =
      first.openTime <= sinceMs || first.openTime - sinceMs <= MAX_GAP_MS;
    const staleTail = now - last.openTime > MAX_GAP_MS;

    return {
      candles,
      coversSince: coversStart && gapCount === 0 && !staleTail,
      coverageStart: first.openTime,
      gapCount,
      staleTail,
    };
  }

  private upsertAggregatedAround(minuteOpenMs: number, now = Date.now()): void {
    const candles1m = this.get(TRACKING_INTERVAL);
    if (candles1m.length === 0) return;

    for (const interval of HTF_INTERVALS) {
      const duration = intervalDurationMs(interval);
      const bucketStart = Math.floor(minuteOpenMs / duration) * duration;
      // Re-aggregate a small window of 1m around this bucket (+ neighbors).
      const from = bucketStart - duration;
      const to = bucketStart + 2 * duration;
      const slice = candles1m.filter(
        (c) => c.openTime >= from && c.openTime < to,
      );
      const aggregated = aggregateCandles(slice, interval, { now });
      for (const candle of aggregated) {
        this.upsertCandle(interval, candle, now);
      }
    }
  }

  private upsertCandle(
    interval: PerpStoredInterval,
    candle: Candle,
    updateTime: number,
  ): void {
    this.upsertStmt.run(
      interval,
      candle.openTime,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.quoteVolume,
      updateTime,
    );
  }

  private rowToCandle(
    interval: PerpStoredInterval,
    row: PerpCandleRow,
    now = Date.now(),
  ): Candle {
    const closeTime = row.open_time + durationMs(interval) - 1;
    return {
      openTime: row.open_time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      closeTime,
      quoteVolume: row.turnover,
      isClosed: closeTime <= now,
    };
  }
}
