<script setup lang="ts">
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from "lightweight-charts";
import type { Candle, KlineInterval, PositionLevels } from "@trade/shared";

const props = defineProps<{
  candles: Candle[];
  intervals: readonly KlineInterval[];
  activeInterval: KlineInterval;
  pending: boolean;
  error: string | null;
  /** Live perpetual last price — drives the forming bar close. */
  livePrice?: string | null;
  levels?: PositionLevels | null;
}>();

const emit = defineEmits<{
  "update:activeInterval": [interval: KlineInterval];
}>();

const hostRef = ref<HTMLElement | null>(null);
let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
const priceLines: IPriceLine[] = [];
let fittedOnce = false;

function parseLivePrice(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toChartData(
  candles: Candle[],
  livePrice: number | null,
): CandlestickData<Time>[] {
  return candles.map((c, index) => {
    const open = Number(c.open);
    let high = Number(c.high);
    let low = Number(c.low);
    let close = Number(c.close);
    const isLast = index === candles.length - 1;
    if (isLast && !c.isClosed && livePrice != null) {
      close = livePrice;
      high = Math.max(high, livePrice);
      low = Math.min(low, livePrice);
    }
    return {
      time: Math.floor(c.openTime / 1000) as Time,
      open,
      high,
      low,
      close,
    };
  });
}

function clearPriceLines() {
  if (!candleSeries) return;
  for (const line of priceLines) {
    candleSeries.removePriceLine(line);
  }
  priceLines.length = 0;
}

function applyLevels(levels: PositionLevels | null | undefined) {
  clearPriceLines();
  if (!candleSeries || !levels) return;

  const specs = [
    { price: levels.entry, color: "#3d6ea5", title: "Entry" },
    { price: levels.stopLoss, color: "#9b3a2f", title: "SL" },
    { price: levels.takeProfit, color: "#2f6b3a", title: "TP" },
  ] as const;

  for (const spec of specs) {
    priceLines.push(
      candleSeries.createPriceLine({
        price: spec.price,
        color: spec.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: spec.title,
      }),
    );
  }
}

function syncData(fit = false) {
  if (!candleSeries) return;
  const livePrice = parseLivePrice(props.livePrice);
  const data = toChartData(props.candles, livePrice);
  candleSeries.setData(data);
  applyLevels(props.levels);
  if (data.length > 0 && (fit || !fittedOnce)) {
    chart?.timeScale().fitContent();
    fittedOnce = true;
  }
}

function patchLiveClose(livePrice: number) {
  if (!candleSeries) return;
  const last = props.candles.at(-1);
  if (!last || last.isClosed) return;

  const open = Number(last.open);
  const high = Math.max(Number(last.high), livePrice);
  const low = Math.min(Number(last.low), livePrice);
  candleSeries.update({
    time: Math.floor(last.openTime / 1000) as Time,
    open,
    high,
    low,
    close: livePrice,
  });
}

function initChart() {
  const el = hostRef.value;
  if (!el || chart) return;

  chart = createChart(el, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "#5c6556",
      fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "rgba(26, 31, 22, 0.06)" },
      horzLines: { color: "rgba(26, 31, 22, 0.06)" },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#2f6b3a",
    downColor: "#9b3a2f",
    borderUpColor: "#2f6b3a",
    borderDownColor: "#9b3a2f",
    wickUpColor: "#2f6b3a",
    wickDownColor: "#9b3a2f",
  });

  syncData(true);
}

function destroyChart() {
  clearPriceLines();
  chart?.remove();
  chart = null;
  candleSeries = null;
  fittedOnce = false;
}

watch(
  () => props.candles,
  () => syncData(false),
  { deep: true },
);

watch(
  () => props.activeInterval,
  () => {
    fittedOnce = false;
    syncData(true);
  },
);

watch(
  () => props.livePrice,
  (value) => {
    const livePrice = parseLivePrice(value);
    if (livePrice == null) return;
    patchLiveClose(livePrice);
  },
);

watch(
  () => props.levels,
  (levels) => applyLevels(levels),
  { deep: true },
);

onMounted(() => {
  initChart();
});

onUnmounted(() => {
  destroyChart();
});
</script>

<template>
  <section class="chart">
    <header class="chart__header">
      <div class="chart__title-row">
        <h2 class="chart__title">Candles</h2>
        <p v-if="pending && candles.length === 0" class="chart__meta">Loading…</p>
        <p v-else-if="error" class="chart__meta chart__meta--error">
          {{ error }}
        </p>
        <p v-else class="chart__meta">
          {{ candles.length }} bars · {{ activeInterval }}
          <template v-if="livePrice"> · live {{ livePrice }}</template>
        </p>
      </div>

      <div class="chart__tabs" role="tablist" aria-label="Candle interval">
        <button
          v-for="interval in intervals"
          :key="interval"
          type="button"
          role="tab"
          class="chart__tab"
          :aria-selected="interval === activeInterval"
          :data-active="interval === activeInterval"
          @click="emit('update:activeInterval', interval)"
        >
          {{ interval }}
        </button>
      </div>
    </header>

    <div ref="hostRef" class="chart__host" />

    <p v-if="!pending && !error && candles.length === 0" class="chart__empty">
      No candle data yet — wait for warm-up or check the API.
    </p>
  </section>
</template>

<style scoped>
.chart {
  width: min(960px, 100%);
  margin: 0 auto 1.25rem;
  padding: 0 1.5rem;
  box-sizing: border-box;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
}

.chart__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 0.5rem;
}

.chart__title-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.chart__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1a1f16;
}

.chart__meta {
  margin: 0;
  font-size: 0.7rem;
  color: #7a8470;
}

.chart__meta--error {
  color: #9b3a2f;
}

.chart__tabs {
  display: flex;
  gap: 0.25rem;
}

.chart__tab {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: #5c6556;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.55rem;
  cursor: pointer;
  border-radius: 4px;
}

.chart__tab:hover {
  color: #1a1f16;
  background: rgba(26, 31, 22, 0.04);
}

.chart__tab[data-active="true"] {
  color: #1a1f16;
  border-color: rgba(26, 31, 22, 0.12);
  background: rgba(26, 31, 22, 0.05);
}

.chart__host {
  width: 100%;
  height: 360px;
  border-radius: 6px;
  border: 1px solid rgba(26, 31, 22, 0.08);
  background: rgba(255, 255, 255, 0.45);
}

.chart__empty {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #7a8470;
}
</style>
