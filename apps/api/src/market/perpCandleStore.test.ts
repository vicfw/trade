import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { createSchema } from "../db"
import { PerpCandleStore } from "./perpCandleStore"

describe("PerpCandleStore multi-interval", () => {
  test("migrates legacy 1m-only table and aggregates HTF", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE perp_candles (
        open_time INTEGER PRIMARY KEY,
        open TEXT NOT NULL,
        high TEXT NOT NULL,
        low TEXT NOT NULL,
        close TEXT NOT NULL,
        volume TEXT NOT NULL DEFAULT '0',
        turnover TEXT NOT NULL DEFAULT '0',
        update_time INTEGER NOT NULL
      );
    `)

    const now = Date.now()
    const start = now - 30 * 60_000
    const insert = db.prepare(`
      INSERT INTO perp_candles (open_time, open, high, low, close, volume, turnover, update_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < 30; i += 1) {
      const t = start + i * 60_000
      insert.run(t, "100", "101", "99", "100", "1", "100", t)
    }

    createSchema(db)
    const store = new PerpCandleStore(db)
    store.backfillFrom1m(now)

    const m1 = store.get("1m")
    expect(m1).toHaveLength(30)
    expect(m1[0]!.openTime).toBe(start)

    const m15 = store.get("15m")
    expect(m15.length).toBeGreaterThanOrEqual(1)

    const coverage = store.coverage(start, now)
    expect(coverage.candles).toHaveLength(30)
  })

  test("apply upserts 1m and skips open native HTF (live price owns forming HTF)", () => {
    const db = new Database(":memory:")
    createSchema(db)
    const store = new PerpCandleStore(db)
    const t0 = Math.floor(Date.now() / 60_000) * 60_000

    store.apply({
      symbol: "BTCUSDT",
      periodID: "1m",
      beginTime: t0,
      open: "100",
      high: "101",
      low: "99",
      close: "100.5",
      volume: "2",
      turnover: "200",
      updateTime: t0 + 1_000,
    })
    store.apply({
      symbol: "BTCUSDT",
      periodID: "15m",
      beginTime: Math.floor(t0 / (15 * 60_000)) * (15 * 60_000),
      open: "100",
      high: "102",
      low: "98",
      close: "101",
      volume: "10",
      turnover: "1000",
      updateTime: t0 + 1_000,
    })

    expect(store.get("1m")).toHaveLength(1)
    expect(store.get("15m")).toHaveLength(0)
    expect(store.getRange(t0)[0]!.close).toBe("100.5")

    store.applyLivePrice(64572.3, t0 + 30_000)
    const m15 = store.get("15m")
    expect(m15).toHaveLength(1)
    expect(m15[0]!.close).toBe("64572.3")
    expect(m15[0]!.isClosed).toBe(false)
    expect(store.get("1m")[0]!.close).toBe("64572.3")

    const aligned15 = Math.floor((t0 + 30_000) / (15 * 60_000)) * (15 * 60_000)
    const strayOpen = aligned15 + 5 * 60_000
    db.prepare(`
      INSERT INTO perp_candles (
        interval, open_time, open, high, low, close, volume, turnover, update_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("15m", strayOpen, "1", "2", "0.5", "1.5", "1", "1", t0 + 31_000)

    store.applyLivePrice(64600, t0 + 32_000)
    expect(store.get("15m").some((c) => c.openTime === strayOpen)).toBe(false)
    expect(store.get("15m")).toHaveLength(1)
    expect(store.get("15m")[0]!.openTime).toBe(aligned15)
    expect(store.get("15m")[0]!.close).toBe("64600")
  })
})
