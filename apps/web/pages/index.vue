<script setup lang="ts">
const { price, change24h, high, low, connected, upstreamConnected } =
  useBtcTicker();

const {
  intervals,
  activeInterval,
  activeCandles,
  lastCandle,
  pending,
  error,
  refresh,
  setIntervalTab,
} = useBtcCandles();

const {
  context,
  activeIndicators,
  pending: indicatorsPending,
  error: indicatorsError,
  refresh: refreshIndicators,
} = useBtcIndicators(activeInterval);

const {
  accountBalanceUsdt,
  maxRiskPercent,
  maxLeverage,
  risk,
  isValid: riskValid,
} = useRiskSettings();

const {
  suggestion,
  market,
  generatedAt,
  pending: suggestionPending,
  error: suggestionError,
  request: requestSuggestion,
  clear: clearSuggestion,
} = useBtcPositionSuggestion();

const {
  result: testResult,
  pending: testPending,
  error: testError,
  request: requestTest,
  clear: clearTest,
} = useBtcPositionTest();

const chartLevels = computed(() => {
  if (!suggestion.value || suggestion.value.side === "no_trade") return null;
  return suggestion.value.levels;
});

function analyze() {
  if (!riskValid.value) return;
  clearTest();
  void requestSuggestion(risk.value);
}

function deleteSuggestion() {
  clearSuggestion();
  clearTest();
}

function testPosition() {
  const current = suggestion.value;
  if (!current || current.side === "no_trade" || !current.levels) return;
  if (generatedAt.value == null) return;

  void requestTest({
    side: current.side,
    entry: current.levels.entry,
    stopLoss: current.levels.stopLoss,
    takeProfit: current.levels.takeProfit,
    since: generatedAt.value,
  });
}
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

    <BtcPositionSuggestion
      :suggestion="suggestion"
      :pending="suggestionPending"
      :error="suggestionError"
      :risk-valid="riskValid"
      :generated-at="generatedAt"
      :market-price="market?.price ?? null"
      :bias4h="market?.bias4h ?? null"
      :structure1h="market?.structure1h ?? null"
      :test-result="testResult"
      :test-pending="testPending"
      :test-error="testError"
      @request="analyze"
      @retry="analyze"
      @test="testPosition"
      @clear="deleteSuggestion"
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
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 2rem;
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
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
}

.page__nav-link:hover {
  color: #1a1f16;
  text-decoration: underline;
}
</style>
