import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MarketSnapshot } from "../market/buildSnapshot";

const LOG_DIR = join(import.meta.dir, "../../logs");
const LOG_FILE = join(LOG_DIR, "llm-snapshots.log");

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString();
}

function formatSnapshotLog(snapshot: MarketSnapshot, loggedAt: string): string {
  const lines: string[] = [];
  const divider = "─".repeat(72);

  lines.push("");
  lines.push(`[suggest] LLM snapshot ${loggedAt} ${divider}`);
  lines.push(
    `  symbol=${snapshot.symbol}  snapshotAt=${fmtTime(snapshot.snapshotAt)}  loggedAt=${loggedAt}`,
  );
  lines.push(
    `  ticker.price=${fmt(snapshot.ticker.price)}  24h%=${fmt(snapshot.ticker.changePercent24h)}  high=${fmt(snapshot.ticker.high24h)}  low=${fmt(snapshot.ticker.low24h)}`,
  );
  lines.push(
    `  context.bias4h=${snapshot.context.bias4h}  structure1h=${snapshot.context.structure1h}`,
  );

  if (snapshot.warnings.length > 0) {
    lines.push(`  warnings:`);
    for (const w of snapshot.warnings) {
      lines.push(`    - ${w}`);
    }
  } else {
    lines.push(`  warnings: (none)`);
  }

  for (const iv of snapshot.intervals) {
    const ind = iv.indicators;
    const first = iv.recentCandles[0];
    const last = iv.recentCandles.at(-1);
    lines.push("");
    lines.push(
      `  [${iv.interval}] closedBars=${iv.barCount}  recentCandles=${iv.recentCandles.length}  current=${iv.currentCandle ? fmt(iv.currentCandle.c) : "—"}  window=${first ? fmtTime(first.t) : "—"} → ${last ? fmtTime(last.t) : "—"}`,
    );
    lines.push(
      `    lastClose=${fmt(ind.lastClose)}  ema20=${fmt(ind.ema20)}  ema50=${fmt(ind.ema50)}  ema200=${fmt(ind.ema200)}`,
    );
    lines.push(
      `    rsi14=${fmt(ind.rsi14)}  atr14=${fmt(ind.atr14)}  swings=${ind.swings.length}`,
    );
    if (ind.swings.length > 0) {
      const swingBits = ind.swings
        .map((s) => `${s.kind}@${fmt(s.price)}`)
        .join("  ");
      lines.push(`    swings: ${swingBits}`);
    }
  }

  lines.push("");
  lines.push(`  full snapshot JSON (exact payload nested under user prompt):`);
  lines.push(JSON.stringify(snapshot, null, 2));
  lines.push(`[suggest] end LLM snapshot ${loggedAt} ${divider}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Dump of the market snapshot sent to the LLM.
 * Writes to apps/api/logs/llm-snapshots.log (with datetime) and mirrors to stdout.
 */
export function logLlmSnapshot(snapshot: MarketSnapshot): void {
  const loggedAt = new Date().toISOString();
  const text = formatSnapshotLog(snapshot, loggedAt);

  console.log(text);

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, text, "utf8");
  } catch (err) {
    console.error(
      `[suggest] failed to write snapshot log to ${LOG_FILE}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
