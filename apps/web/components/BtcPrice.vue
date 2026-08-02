<script setup lang="ts">
defineProps<{
  price: string | null
  change24h: string | null
  high: string | null
  low: string | null
  connected: boolean
  upstreamConnected: boolean
}>()

function formatPrice(value: string | null) {
  if (value == null) return "—"
  const n = Number(value)
  if (Number.isNaN(n)) return value
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function formatChange(value: string | null) {
  if (value == null) return "—"
  const n = Number(value)
  if (Number.isNaN(n)) return value
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(2)}%`
}

function changeClass(value: string | null) {
  if (value == null) return "flat"
  const n = Number(value)
  if (Number.isNaN(n) || n === 0) return "flat"
  return n > 0 ? "up" : "down"
}
</script>

<template>
  <section class="btc">
    <div class="btc__row">
      <div class="btc__identity">
        <h1 class="btc__symbol">BTC / USDT</h1>
        <p
          class="btc__status"
          :data-live="connected && upstreamConnected"
        >
          {{
            !connected
              ? "Connecting…"
              : upstreamConnected
                ? "Live"
                : "Waiting…"
          }}
        </p>
      </div>

      <p class="btc__price">{{ formatPrice(price) }}</p>

      <p class="btc__change" :data-dir="changeClass(change24h)">
        {{ formatChange(change24h) }}
        <span class="btc__change-label">24h</span>
      </p>

      <dl class="btc__range">
        <div>
          <dt>High</dt>
          <dd>{{ formatPrice(high) }}</dd>
        </div>
        <div>
          <dt>Low</dt>
          <dd>{{ formatPrice(low) }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.btc {
  width: min(960px, 100%);
  margin: 0 auto;
  padding: 0 1.5rem 0.75rem;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  box-sizing: border-box;
}

.btc__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1.25rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid rgba(26, 31, 22, 0.08);
}

.btc__identity {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.btc__symbol {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1a1f16;
}

.btc__status {
  margin: 0;
  font-size: 0.7rem;
  color: #7a8470;
}

.btc__status[data-live="true"] {
  color: #2f6b3a;
}

.btc__price {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #12150f;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.btc__change {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.btc__change[data-dir="up"] {
  color: #2f6b3a;
}

.btc__change[data-dir="down"] {
  color: #9b3a2f;
}

.btc__change[data-dir="flat"] {
  color: #5c6556;
}

.btc__change-label {
  margin-left: 0.25rem;
  font-size: 0.7rem;
  font-weight: 400;
  color: #7a8470;
}

.btc__range {
  display: flex;
  gap: 1rem;
  margin: 0 0 0 auto;
  padding: 0;
}

.btc__range dt {
  margin: 0 0 0.1rem;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a8470;
}

.btc__range dd {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 500;
  color: #1a1f16;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .btc {
    padding: 0 1rem 0.65rem;
  }

  .btc__row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: 0.35rem 0.75rem;
  }

  .btc__identity {
    grid-column: 1;
  }

  .btc__status {
    margin-left: 0.15rem;
  }

  .btc__price {
    grid-column: 1 / -1;
    font-size: 1.75rem;
    margin-top: 0.15rem;
  }

  .btc__change {
    grid-column: 1;
    align-self: end;
  }

  .btc__range {
    grid-column: 2;
    grid-row: 3;
    margin: 0;
    justify-content: flex-end;
    gap: 0.85rem;
  }
}
</style>
