<script setup lang="ts">
const { price, change24h, high, low, connected, upstreamConnected } =
  useBtcTicker();

const {
  intervals,
  activeInterval,
  activeCandles,
  pending,
  error,
  setIntervalTab,
} = useBtcCandles();

const {
  accountBalanceUsdt,
  maxRiskPercent,
  maxLeverage,
  isValid: riskValid,
  syncError: riskSyncError,
} = useRiskSettings();

const {
  suggestion,
  market,
  generatedAt,
  riskUsed,
  schedule,
  openPosition,
  pending: suggestionPending,
  error: suggestionError,
} = useBtcPositionSuggestion();

const chartLevels = computed(() => {
  if (!suggestion.value || suggestion.value.side === "no_trade") return null;
  // Drop Entry/SL/TP once the trade is done — expired, TP, or SL.
  const status = openPosition.value?.status;
  if (
    status == null ||
    status === "expired" ||
    status === "successful" ||
    status === "failed"
  ) {
    return null;
  }
  return suggestion.value.levels;
});
</script>

<template>
  <main class="page">
    <nav class="page__nav">
      <NuxtLink to="/history" class="page__nav-link">Trade history</NuxtLink>
    </nav>

    <BtcPrice
      :price="price"
      :change24h="change24h"
      :high="high"
      :low="low"
      :connected="connected"
      :upstream-connected="upstreamConnected"
    />

    <BtcCandleChart
      :candles="activeCandles"
      :intervals="intervals"
      :active-interval="activeInterval"
      :pending="pending"
      :error="error"
      :live-price="price"
      :levels="chartLevels"
      @update:active-interval="setIntervalTab"
    />

    <BtcRiskSettings
      v-model:account-balance-usdt="accountBalanceUsdt"
      v-model:max-risk-percent="maxRiskPercent"
      v-model:max-leverage="maxLeverage"
      :valid="riskValid"
    />
    <p v-if="riskSyncError" class="page__risk-error" role="status">
      {{ riskSyncError }}
    </p>

    <BtcPositionSuggestion
      :suggestion="suggestion"
      :pending="suggestionPending"
      :error="suggestionError"
      :generated-at="generatedAt"
      :market-price="market?.price ?? null"
      :bias4h="market?.bias4h ?? null"
      :structure1h="market?.structure1h ?? null"
      :risk-used="riskUsed"
      :schedule="schedule"
      :open-position="openPosition"
    />
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
  padding: 1.5rem 0 calc(2rem + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}

.page__nav {
  width: min(960px, 100%);
  padding: 0 1.5rem;
  margin-bottom: 0.75rem;
  box-sizing: border-box;
  display: flex;
  justify-content: flex-end;
}

.page__nav-link {
  color: #4a5540;
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}

.page__nav-link:hover {
  color: #1a1f16;
  text-decoration: underline;
}

.page__risk-error {
  width: min(960px, 100%);
  margin: -0.5rem auto 0.75rem;
  padding: 0 1.5rem;
  box-sizing: border-box;
  color: #9b3a2f;
  font-size: 0.85rem;
}
</style>
