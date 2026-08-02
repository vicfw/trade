import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { config } from "./config"

function resolveDbPath(): string {
  // Keep unit tests hermetic — never touch the real database file.
  if (process.env.NODE_ENV === "test") return ":memory:"
  if (config.dbPath === ":memory:") return ":memory:"

  const path = isAbsolute(config.dbPath)
    ? config.dbPath
    : resolve(import.meta.dir, "..", config.dbPath)
  mkdirSync(dirname(path), { recursive: true })
  return path
}

function migratePerpCandles(db: Database): void {
  const exists = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='perp_candles'",
    )
    .get() as { name: string } | null

  if (!exists) {
    db.exec(`
      CREATE TABLE perp_candles (
        interval TEXT NOT NULL,
        open_time INTEGER NOT NULL,
        open TEXT NOT NULL,
        high TEXT NOT NULL,
        low TEXT NOT NULL,
        close TEXT NOT NULL,
        volume TEXT NOT NULL DEFAULT '0',
        turnover TEXT NOT NULL DEFAULT '0',
        update_time INTEGER NOT NULL,
        PRIMARY KEY (interval, open_time)
      );
    `)
    return
  }

  const columns = db.query("PRAGMA table_info(perp_candles)").all() as {
    name: string
  }[]
  const hasInterval = columns.some((c) => c.name === "interval")
  if (hasInterval) return

  db.exec(`
    CREATE TABLE perp_candles_new (
      interval TEXT NOT NULL,
      open_time INTEGER NOT NULL,
      open TEXT NOT NULL,
      high TEXT NOT NULL,
      low TEXT NOT NULL,
      close TEXT NOT NULL,
      volume TEXT NOT NULL DEFAULT '0',
      turnover TEXT NOT NULL DEFAULT '0',
      update_time INTEGER NOT NULL,
      PRIMARY KEY (interval, open_time)
    );

    INSERT INTO perp_candles_new (
      interval, open_time, open, high, low, close, volume, turnover, update_time
    )
    SELECT
      '1m', open_time, open, high, low, close, volume, turnover, update_time
    FROM perp_candles;

    DROP TABLE perp_candles;
    ALTER TABLE perp_candles_new RENAME TO perp_candles;
  `)
}

export function createSchema(db: Database): void {
  migratePerpCandles(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      key TEXT PRIMARY KEY,
      since INTEGER NOT NULL,
      side TEXT NOT NULL,
      entry REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      status TEXT NOT NULL,
      triggered_at INTEGER,
      hit_at INTEGER,
      hit_reason TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_history (
      key TEXT PRIMARY KEY,
      recorded_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      side TEXT NOT NULL,
      entry REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      since INTEGER NOT NULL,
      triggered_at INTEGER,
      hit_at INTEGER,
      hit_reason TEXT,
      price_source TEXT NOT NULL,
      interval TEXT NOT NULL
    );
  `)
}

export function openDatabase(path = resolveDbPath()): Database {
  const db = new Database(path)
  db.exec("PRAGMA journal_mode = WAL;")
  createSchema(db)
  return db
}

export const db = openDatabase()
