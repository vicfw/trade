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

function tableColumns(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function ensureColumn(
  db: Database,
  table: string,
  column: string,
  ddl: string,
): void {
  if (tableColumns(db, table).has(column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

function migrateTradeHistoryEnrichment(db: Database): void {
  const exists = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'",
    )
    .get() as { name: string } | null
  if (!exists) return

  ensureColumn(db, "trade_history", "confidence", "confidence TEXT")
  ensureColumn(db, "trade_history", "rationale", "rationale TEXT")
  ensureColumn(db, "trade_history", "risk_reward", "risk_reward REAL")
  ensureColumn(db, "trade_history", "leverage", "leverage REAL")
  ensureColumn(db, "trade_history", "quantity_btc", "quantity_btc REAL")
  ensureColumn(db, "trade_history", "risk_amount_usdt", "risk_amount_usdt REAL")
  ensureColumn(
    db,
    "trade_history",
    "account_balance_usdt",
    "account_balance_usdt REAL",
  )
  ensureColumn(db, "trade_history", "max_risk_percent", "max_risk_percent REAL")
  ensureColumn(db, "trade_history", "max_leverage", "max_leverage REAL")
  ensureColumn(db, "trade_history", "bias_4h", "bias_4h TEXT")
  ensureColumn(db, "trade_history", "structure_1h", "structure_1h TEXT")
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
      interval TEXT NOT NULL,
      confidence TEXT,
      rationale TEXT,
      risk_reward REAL,
      leverage REAL,
      quantity_btc REAL,
      risk_amount_usdt REAL,
      account_balance_usdt REAL,
      max_risk_percent REAL,
      max_leverage REAL,
      bias_4h TEXT,
      structure_1h TEXT
    );

    CREATE TABLE IF NOT EXISTS risk_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      account_balance_usdt REAL NOT NULL,
      max_risk_percent REAL NOT NULL,
      max_leverage REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS latest_analysis (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      symbol TEXT NOT NULL,
      generated_at INTEGER,
      snapshot_at INTEGER,
      suggestion_json TEXT,
      market_json TEXT,
      risk_used_json TEXT,
      schedule_status TEXT NOT NULL,
      next_analysis_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS open_trade_meta (
      key TEXT PRIMARY KEY,
      meta_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)

  migrateTradeHistoryEnrichment(db)
}

export function openDatabase(path = resolveDbPath()): Database {
  const db = new Database(path)
  db.exec("PRAGMA journal_mode = WAL;")
  createSchema(db)
  return db
}

export const db = openDatabase()
