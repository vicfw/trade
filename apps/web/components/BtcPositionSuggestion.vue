<script setup lang="ts">
import type {
  BtcPositionTestResponse,
  PositionSuggestion,
  SuggestionConfidence,
  TradeSide,
} from "@trade/shared"

const props = defineProps<{
  suggestion: PositionSuggestion | null
  pending: boolean
  error: string | null
  riskValid: boolean
  generatedAt: number | null
  marketPrice: number | null
  bias4h: string | null
  structure1h: string | null
  testResult: BtcPositionTestResponse | null
  testPending: boolean
  testError: string | null
}>()

const emit = defineEmits<{
  request: []
  retry: []
  test: []
  clear: []
}>()

function formatPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value == null || Number.isNaN(value)) return "—"
  return value.toFixed(digits)
}

function formatTime(ts: number | null) {
  if (ts == null) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(ts)
}

function formatDateTime(ts: number | null) {
  if (ts == null) return "—"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(ts)
}

function testStatusLabel(status: BtcPositionTestResponse["status"]) {
  switch (status) {
    case "successful":
      return "Take-profit"
    case "failed":
      return "Stop-loss"
    case "waiting":
      return "Triggered"
    case "not_triggered":
      return "Not triggered"
    default:
      return status
  }
}

function testSourceLabel(source: BtcPositionTestResponse["priceSource"]) {
  switch (source) {
    case "perpetual_ticks":
      return "BTCUSDT perpetual ticks"
    case "perpetual_candles":
      return "BTCUSDT perpetual 1m candles"
    default:
      return source
  }
}

function sideLabel(side: TradeSide) {
  switch (side) {
    case "long":
      return "Long"
    case "short":
      return "Short"
    default:
      return "No trade"
  }
}

function confidenceLabel(c: SuggestionConfidence) {
  return c.charAt(0).toUpperCase() + c.slice(1)
}

const hasSuggestion = computed(() => props.suggestion != null)
</script>

<template>
  <section class="suggest" :aria-busy="pending">
    <header class="suggest__header">
      <div class="suggest__actions">
        <button
          type="button"
          class="suggest__cta"
          :disabled="pending || !riskValid"
          @click="emit('request')"
        >
          {{ pending ? "Analyzing…" : "Analyze market" }}
        </button>
        <button
          v-if="hasSuggestion"
          type="button"
          class="suggest__delete"
          :disabled="pending"
          @click="emit('clear')"
        >
          Delete
        </button>
      </div>
    </header>

    <p v-if="error" class="suggest__state suggest__state--error" role="status">
      {{ error }}
      <button type="button" class="suggest__retry" @click="emit('retry')">
        Retry
      </button>
    </p>
    <p
      v-else-if="pending && !hasSuggestion"
      class="suggest__state"
      role="status"
    >
      Analyzing market… this may take 10–30s
    </p>
    <p v-else-if="!hasSuggestion" class="suggest__state" role="status">
      Set risk limits, then analyze for a structured position suggestion.
    </p>
    <template v-else-if="suggestion">
      <div class="suggest__meta">
        <div
          class="suggest__badge"
          :data-side="suggestion.side"
        >
          <span class="suggest__badge-label">Side</span>
          <span class="suggest__badge-value">{{
            sideLabel(suggestion.side)
          }}</span>
        </div>
        <div class="suggest__badge">
          <span class="suggest__badge-label">Confidence</span>
          <span class="suggest__badge-value">{{
            confidenceLabel(suggestion.confidence)
          }}</span>
        </div>
        <div v-if="generatedAt" class="suggest__badge">
          <span class="suggest__badge-label">Suggested</span>
          <span class="suggest__badge-value">{{ formatTime(generatedAt) }}</span>
        </div>
        <div v-if="marketPrice != null" class="suggest__badge">
          <span class="suggest__badge-label">Perp</span>
          <span class="suggest__badge-value">{{ formatPrice(marketPrice) }}</span>
        </div>
        <div v-if="bias4h" class="suggest__badge">
          <span class="suggest__badge-label">4h bias</span>
          <span class="suggest__badge-value">{{ bias4h }}</span>
        </div>
        <div v-if="structure1h" class="suggest__badge">
          <span class="suggest__badge-label">1h structure</span>
          <span class="suggest__badge-value">{{ structure1h }}</span>
        </div>
      </div>

      <dl
        v-if="suggestion.side !== 'no_trade' && suggestion.levels"
        class="suggest__grid"
      >
        <div>
          <dt>Entry</dt>
          <dd>{{ formatPrice(suggestion.levels.entry) }}</dd>
        </div>
        <div>
          <dt>Stop-loss</dt>
          <dd>{{ formatPrice(suggestion.levels.stopLoss) }}</dd>
        </div>
        <div>
          <dt>Take-profit</dt>
          <dd>{{ formatPrice(suggestion.levels.takeProfit) }}</dd>
        </div>
        <div>
          <dt>R:R</dt>
          <dd>
            {{
              suggestion.sizing?.riskReward != null
                ? formatNumber(suggestion.sizing.riskReward, 2)
                : "—"
            }}
          </dd>
        </div>
        <div>
          <dt>Risk $</dt>
          <dd>{{ formatPrice(suggestion.sizing?.riskAmountUsdt) }}</dd>
        </div>
        <div>
          <dt>Size (BTC)</dt>
          <dd>{{ formatNumber(suggestion.sizing?.quantityBtc, 6) }}</dd>
        </div>
        <div>
          <dt>Notional</dt>
          <dd>{{ formatPrice(suggestion.sizing?.notionalUsdt) }}</dd>
        </div>
        <div>
          <dt>Leverage</dt>
          <dd>
            {{
              suggestion.sizing
                ? `${formatNumber(suggestion.sizing.leverage, 2)}x`
                : "—"
            }}
            <span
              v-if="suggestion.sizing?.leverageCapped"
              class="suggest__capped"
              >capped</span
            >
          </dd>
        </div>
      </dl>

      <div class="suggest__test">
        <button
          type="button"
          class="suggest__test-cta"
          :disabled="testPending"
          @click="emit('test')"
        >
          {{ testPending ? "Checking…" : "Test" }}
        </button>

        <p v-if="testError" class="suggest__test-state suggest__test-state--error">
          {{ testError }}
        </p>
        <div
          v-else-if="testResult"
          class="suggest__test-state"
          :data-status="testResult.status"
        >
          <p class="suggest__test-summary">
            <span class="suggest__test-status">{{
              testStatusLabel(testResult.status)
            }}</span>
            <span v-if="testResult.status === 'not_triggered'">
              Entry never touched on BTCUSDT perpetual since
              {{ formatDateTime(testResult.since) }}.
            </span>
            <span v-else-if="testResult.status === 'waiting'">
              Entry filled
              <template v-if="testResult.triggeredAt">
                at {{ formatDateTime(testResult.triggeredAt) }}
              </template>
              — still open; neither stop-loss nor take-profit hit yet.
            </span>
            <span v-else-if="testResult.status === 'successful'">
              Take-profit hit at {{ formatDateTime(testResult.hitAt) }}
              <template v-if="testResult.triggeredAt">
                (entered {{ formatDateTime(testResult.triggeredAt) }})
              </template>
              .
            </span>
            <span v-else>
              Stop-loss hit at {{ formatDateTime(testResult.hitAt) }}
              <template v-if="testResult.triggeredAt">
                (entered {{ formatDateTime(testResult.triggeredAt) }})
              </template>
              .
            </span>
          </p>
          <p class="suggest__test-source">
            <span v-if="testResult.currentPrice != null">
              Current perp {{ formatPrice(testResult.currentPrice) }}
            </span>
            <span>{{ testSourceLabel(testResult.priceSource) }}</span>
            <NuxtLink to="/history" class="suggest__test-history">
              Trade history
            </NuxtLink>
          </p>
          <ul v-if="testResult.warnings.length" class="suggest__test-warnings">
            <li v-for="(warning, i) in testResult.warnings" :key="i">
              {{ warning }}
            </li>
          </ul>
        </div>
        <p v-else class="suggest__test-state suggest__test-state--muted">
          Check on BTCUSDT perpetual whether this suggestion (made
          {{ formatDateTime(generatedAt) }}) triggered, then hit take-profit or
          stop-loss.
          <NuxtLink to="/history" class="suggest__test-history">
            Trade history
          </NuxtLink>
        </p>
      </div>

      <div class="suggest__rationale">
        <h3 class="suggest__rationale-title">Rationale</h3>
        <p>{{ suggestion.rationale }}</p>
      </div>

      <ul v-if="suggestion.warnings.length" class="suggest__warnings">
        <li v-for="(warning, i) in suggestion.warnings" :key="i">
          {{ warning }}
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.suggest {
  width: min(960px, 100%);
  margin: 0 auto;
  padding: 0 1.5rem 1.5rem;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
}

.suggest__header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: flex-end;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.suggest__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}

.suggest__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1a1f16;
}

.suggest__subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: #7a8470;
}

.suggest__cta {
  appearance: none;
  border: 1px solid #2f6b3a;
  background: #2f6b3a;
  color: #f5f8f2;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.55rem 1rem;
  cursor: pointer;
}

.suggest__cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.suggest__delete {
  appearance: none;
  border: 1px solid #9b3a2f;
  background: transparent;
  color: #9b3a2f;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.55rem 1rem;
  cursor: pointer;
}

.suggest__delete:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.suggest__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  margin-bottom: 1rem;
  border-top: 1px solid rgba(26, 31, 22, 0.08);
  padding-top: 1rem;
}

.suggest__badge {
  display: grid;
  gap: 0.15rem;
  min-width: 6rem;
  padding-bottom: 0.15rem;
  border-bottom: 2px solid rgba(26, 31, 22, 0.12);
}

.suggest__badge[data-side="long"] {
  border-bottom-color: #2f6b3a;
}

.suggest__badge[data-side="short"] {
  border-bottom-color: #9b3a2f;
}

.suggest__badge[data-side="no_trade"] {
  border-bottom-color: #7a8470;
}

.suggest__badge-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a8470;
}

.suggest__badge-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: #1a1f16;
  text-transform: capitalize;
}

.suggest__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0 0 1.25rem;
  padding: 0;
}

@media (max-width: 720px) {
  .suggest__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.suggest__grid dt {
  margin: 0 0 0.2rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a8470;
}

.suggest__grid dd {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 500;
  color: #1a1f16;
}

.suggest__capped {
  margin-left: 0.35rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9b3a2f;
}

.suggest__test {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.85rem;
  margin: 0 0 1.25rem;
  padding-top: 0.9rem;
  border-top: 1px solid rgba(26, 31, 22, 0.08);
}

.suggest__test-cta {
  appearance: none;
  border: 1px solid #1a1f16;
  background: transparent;
  color: #1a1f16;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
}

.suggest__test-cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.suggest__test-state {
  margin: 0;
  font-size: 0.9rem;
  color: #1a1f16;
}

.suggest__test-summary {
  margin: 0;
}

.suggest__test-source {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.8rem;
  margin: 0.25rem 0 0;
  color: #7a8470;
  font-size: 0.75rem;
}

.suggest__test-history {
  color: #4a5540;
  font-weight: 600;
  text-decoration: none;
}

.suggest__test-history:hover {
  color: #1a1f16;
  text-decoration: underline;
}

.suggest__test-warnings {
  margin: 0.45rem 0 0;
  padding-left: 1rem;
  color: #8a6136;
  font-size: 0.75rem;
}

.suggest__test-state--muted {
  color: #7a8470;
}

.suggest__test-state--error {
  color: #9b3a2f;
}

.suggest__test-status {
  margin-right: 0.4rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.8rem;
}

.suggest__test-state[data-status="successful"] .suggest__test-status {
  color: #2f6b3a;
}

.suggest__test-state[data-status="failed"] .suggest__test-status {
  color: #9b3a2f;
}

.suggest__test-state[data-status="waiting"] .suggest__test-status {
  color: #7a8470;
}

.suggest__test-state[data-status="not_triggered"] .suggest__test-status {
  color: #6b5f3a;
}

.suggest__rationale-title {
  margin: 0 0 0.45rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #7a8470;
}

.suggest__rationale p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #1a1f16;
}

.suggest__warnings {
  margin: 1rem 0 0;
  padding: 0.75rem 1rem;
  list-style: disc inside;
  background: rgba(155, 58, 47, 0.06);
  color: #9b3a2f;
  font-size: 0.85rem;
}

.suggest__disclaimer {
  margin: 1.25rem 0 0;
  font-size: 0.8rem;
  color: #7a8470;
  line-height: 1.45;
}

.suggest__state {
  margin: 0;
  min-height: 4rem;
  display: grid;
  place-items: center;
  color: #7a8470;
  font-size: 0.95rem;
  border-top: 1px solid rgba(26, 31, 22, 0.08);
  padding-top: 1rem;
}

.suggest__state--error {
  color: #9b3a2f;
  gap: 0.75rem;
}

.suggest__retry {
  appearance: none;
  border: 1px solid #9b3a2f;
  background: transparent;
  color: #9b3a2f;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}
</style>
