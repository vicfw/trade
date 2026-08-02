<script setup lang="ts">
import type {
  PositionTestHitReason,
  PositionTestPriceSource,
  TradeHistoryEntry,
} from "@trade/shared"

const { records, pending, error, refresh, clear } = useTradeHistory()

function formatPrice(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(ts: number | null) {
  if (ts == null) return "—"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(ts)
}

function statusLabel(status: TradeHistoryEntry["status"]) {
  return status === "successful" ? "Successful" : "Failed"
}

function hitLabel(reason: PositionTestHitReason | null) {
  if (reason === "take_profit") return "Take-profit"
  if (reason === "stop_loss") return "Stop-loss"
  return "—"
}

function sourceLabel(source: PositionTestPriceSource) {
  switch (source) {
    case "perpetual_ticks":
      return "BTCUSDT perp ticks"
    case "perpetual_candles":
      return "BTCUSDT perp 1m"
    default:
      return source
  }
}

function onClear() {
  if (!records.value.length) return
  if (!window.confirm("Clear all trade history on the server?")) return
  void clear()
}
</script>

<template>
  <main class="page">
    <header class="history__header">
      <NuxtLink to="/" class="history__back">← Back</NuxtLink>
      <div class="history__title-row">
        <h1 class="history__title">Trade history</h1>
        <button
          type="button"
          class="history__refresh"
          :disabled="pending"
          @click="refresh"
        >
          {{ pending ? "Loading…" : "Refresh" }}
        </button>
      </div>
      <p class="history__lede">
        Closed outcomes only — take-profit (successful) or stop-loss (failed),
        checked on BTCUSDT perpetual.
      </p>
      <button
        type="button"
        class="history__clear"
        :disabled="!records.length || pending"
        @click="onClear"
      >
        Clear history
      </button>
    </header>

    <p v-if="error" class="history__error" role="status">{{ error }}</p>
    <p v-else-if="pending && !records.length" class="history__empty">
      Loading…
    </p>
    <p v-else-if="!records.length" class="history__empty">
      No closed trades yet. Analyze a position, then use Test — successes and
      failures appear here once take-profit or stop-loss is hit on perpetual
      price.
    </p>

    <template v-else>
      <div class="history__table-wrap">
        <table class="history__table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Stop-loss</th>
              <th>Take-profit</th>
              <th>Hit</th>
              <th>Triggered</th>
              <th>Hit at</th>
              <th>Suggested at</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in records" :key="row.id" :data-status="row.status">
              <td class="history__status">{{ statusLabel(row.status) }}</td>
              <td>{{ row.side === "long" ? "Long" : "Short" }}</td>
              <td>{{ formatPrice(row.entry) }}</td>
              <td>{{ formatPrice(row.stopLoss) }}</td>
              <td>{{ formatPrice(row.takeProfit) }}</td>
              <td>{{ hitLabel(row.hitReason) }}</td>
              <td>{{ formatDateTime(row.triggeredAt) }}</td>
              <td>{{ formatDateTime(row.hitAt) }}</td>
              <td>{{ formatDateTime(row.since) }}</td>
              <td>{{ sourceLabel(row.priceSource) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul class="history__cards" aria-label="Trade history">
        <li
          v-for="row in records"
          :key="`card-${row.id}`"
          class="history__card"
          :data-status="row.status"
        >
          <div class="history__card-top">
            <span class="history__status">{{ statusLabel(row.status) }}</span>
            <span class="history__card-side">{{
              row.side === "long" ? "Long" : "Short"
            }}</span>
          </div>
          <dl class="history__card-grid">
            <div>
              <dt>Entry</dt>
              <dd>{{ formatPrice(row.entry) }}</dd>
            </div>
            <div>
              <dt>Stop-loss</dt>
              <dd>{{ formatPrice(row.stopLoss) }}</dd>
            </div>
            <div>
              <dt>Take-profit</dt>
              <dd>{{ formatPrice(row.takeProfit) }}</dd>
            </div>
            <div>
              <dt>Hit</dt>
              <dd>{{ hitLabel(row.hitReason) }}</dd>
            </div>
          </dl>
          <div class="history__card-meta">
            <p>
              <span class="history__card-label">Triggered</span>
              {{ formatDateTime(row.triggeredAt) }}
            </p>
            <p>
              <span class="history__card-label">Hit at</span>
              {{ formatDateTime(row.hitAt) }}
            </p>
            <p>
              <span class="history__card-label">Suggested</span>
              {{ formatDateTime(row.since) }}
            </p>
            <p>
              <span class="history__card-label">Source</span>
              {{ sourceLabel(row.priceSource) }}
            </p>
          </div>
        </li>
      </ul>
    </template>
  </main>
</template>

<style>
html,
body {
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(ellipse 80% 60% at 20% 0%, #e8efe0 0%, transparent 55%),
    radial-gradient(ellipse 70% 50% at 100% 20%, #dfe8f0 0%, transparent 50%),
    #f3f5f0;
}

.page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1rem calc(3rem + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}

.history__header {
  width: min(1100px, 100%);
  margin-bottom: 1.5rem;
}

.history__back {
  display: inline-block;
  margin-bottom: 0.75rem;
  color: #4a5540;
  font-size: 0.9rem;
  text-decoration: none;
  padding: 0.25rem 0;
}

.history__back:hover {
  color: #1a1f16;
  text-decoration: underline;
}

.history__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 0.35rem;
}

.history__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: #1a1f16;
}

.history__refresh {
  appearance: none;
  border: 1px solid rgba(26, 31, 22, 0.25);
  background: transparent;
  color: #4a5540;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.45rem 0.85rem;
  cursor: pointer;
  min-height: 2.5rem;
}

.history__refresh:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.history__lede {
  margin: 0 0 1rem;
  color: #7a8470;
  font-size: 0.9rem;
  line-height: 1.45;
  max-width: 40rem;
}

.history__clear {
  appearance: none;
  border: 1px solid #1a1f16;
  background: transparent;
  color: #1a1f16;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  min-height: 2.5rem;
}

.history__clear:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.history__empty,
.history__error {
  width: min(1100px, 100%);
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.45;
}

.history__empty {
  color: #7a8470;
}

.history__error {
  color: #9b3a2f;
}

.history__table-wrap {
  width: min(1100px, 100%);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.history__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  color: #1a1f16;
}

.history__table th,
.history__table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid rgba(26, 31, 22, 0.1);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.history__table th {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7a8470;
}

.history__status {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.8rem;
}

.history__table tr[data-status="successful"] .history__status,
.history__card[data-status="successful"] .history__status {
  color: #2f6b3a;
}

.history__table tr[data-status="failed"] .history__status,
.history__card[data-status="failed"] .history__status {
  color: #9b3a2f;
}

.history__cards {
  display: none;
  width: min(1100px, 100%);
  margin: 0;
  padding: 0;
  list-style: none;
}

.history__card {
  padding: 1rem 0;
  border-bottom: 1px solid rgba(26, 31, 22, 0.1);
}

.history__card:first-child {
  border-top: 1px solid rgba(26, 31, 22, 0.1);
}

.history__card-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.history__card-side {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1a1f16;
}

.history__card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 1rem;
  margin: 0 0 0.85rem;
  padding: 0;
}

.history__card-grid dt {
  margin: 0 0 0.15rem;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a8470;
}

.history__card-grid dd {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 500;
  color: #1a1f16;
  font-variant-numeric: tabular-nums;
}

.history__card-meta {
  display: grid;
  gap: 0.35rem;
}

.history__card-meta p {
  margin: 0;
  font-size: 0.8rem;
  color: #1a1f16;
  line-height: 1.4;
}

.history__card-label {
  display: inline-block;
  min-width: 5.5rem;
  color: #7a8470;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

@media (max-width: 720px) {
  .page {
    padding-top: 1.25rem;
  }

  .history__title {
    font-size: 1.25rem;
  }

  .history__title-row {
    width: 100%;
    justify-content: space-between;
  }

  .history__clear {
    width: 100%;
  }

  .history__table-wrap {
    display: none;
  }

  .history__cards {
    display: block;
  }
}
</style>
