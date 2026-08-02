import type { BtcTicker } from "@trade/shared";
import { config } from "../config";
import { tickerHub } from "../ws/hub";
import {
  buildLbankPerpKlineSubscribe,
  parseLbankPerpKlines,
  type PerpKlineUpdate,
} from "./perpKline";
import { lbankGet } from "./rest";
import {
  buildLbankPerpMarketSubscribe,
  isLbankPerpPong,
  parseLbankPerpMarketRow,
  parseLbankPerpTicker,
  type LbankPerpMarketRow,
} from "./ticker";

const MIN_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 3_000;
const CONNECT_TIMEOUT_MS = 5_000;
const WATCHDOG_MS = 5_000;
const STALE_MS = 12_000;
const REST_POLL_MS = 5_000;
const HEARTBEAT_MS = 6_000;

type TickerListener = (ticker: BtcTicker) => void;
type KlineListener = (update: PerpKlineUpdate) => void;

export class LbankTickerClient {
  private ws: WebSocket | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private restPollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private connecting = false;
  private listeners = new Set<TickerListener>();
  private klineListeners = new Set<KlineListener>();
  private lastTicker: BtcTicker | null = null;
  private lastMessageAt = 0;
  private generation = 0;
  private subscribeSeq = 0;

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get latest() {
    return this.lastTicker;
  }

  onTicker(listener: TickerListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Live BTCUSDT perpetual kline updates (config.perpKlinePeriods). */
  onKline(listener: KlineListener) {
    this.klineListeners.add(listener);
    return () => this.klineListeners.delete(listener);
  }

  start() {
    this.stopped = false;
    this.connect();
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => this.watchdog(), WATCHDOG_MS);
    }
    if (!this.restPollTimer) {
      this.restPollTimer = setInterval(() => {
        if (!this.connected) {
          void this.pollRestTicker();
        }
      }, REST_POLL_MS);
      void this.pollRestTicker();
    }
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.tearDownSocket();
    tickerHub.broadcast({ type: "status", connected: false });
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.restPollTimer) {
      clearInterval(this.restPollTimer);
      this.restPollTimer = null;
    }
    this.clearHeartbeat();
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private tearDownSocket() {
    this.clearHeartbeat();
    const ws = this.ws;
    this.ws = null;
    this.connecting = false;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  private publish(ticker: BtcTicker) {
    this.lastTicker = ticker;
    this.lastMessageAt = Date.now();
    for (const listener of this.listeners) {
      listener(ticker);
    }
    tickerHub.broadcast({ type: "ticker", data: ticker });
  }

  private watchdog() {
    if (this.stopped) return;

    const stale =
      this.lastMessageAt === 0 || Date.now() - this.lastMessageAt > STALE_MS;

    if (this.connected && !stale) return;

    if (!this.connected && !this.connecting && !this.reconnectTimer) {
      console.warn("[lbank] watchdog: not connected, reconnecting");
      this.connect();
      return;
    }

    if (this.connected && stale) {
      console.warn("[lbank] watchdog: ticker stale, forcing reconnect");
      this.tearDownSocket();
      tickerHub.broadcast({ type: "status", connected: false });
      this.scheduleReconnect();
    }
  }

  private async pollRestTicker() {
    if (this.stopped) return;

    try {
      const data = await lbankGet<LbankPerpMarketRow[]>(
        config.lbankPerpRestUrl,
        "/cfd/openApi/v1/pub/marketData",
        { productGroup: config.perpProductGroup },
      );
      if (!Array.isArray(data) || data.length === 0) {
        console.warn("[lbank] REST perp ticker empty data");
        return;
      }

      const symbol = config.tickerSymbol.toUpperCase();
      const row = data.find((item) => item.symbol?.toUpperCase() === symbol);
      if (!row) {
        console.warn(`[lbank] REST perp ticker missing ${symbol}`);
        return;
      }

      const ticker = parseLbankPerpMarketRow(row);
      if (!ticker) return;

      // Prefer live WS once it recovers; REST only fills gaps.
      if (this.connected) return;

      this.publish(ticker);
      tickerHub.broadcast({ type: "status", connected: true });
    } catch (err) {
      console.warn(
        "[lbank] REST perp ticker failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private subscribeMarket(ws: WebSocket) {
    this.subscribeSeq += 1;
    const tsn = String(1_000_000_000 + this.subscribeSeq);
    ws.send(buildLbankPerpMarketSubscribe(config.tickerSymbol, tsn));

    for (const period of config.perpKlinePeriods) {
      this.subscribeSeq += 1;
      const klineTsn = String(1_000_000_000 + this.subscribeSeq);
      ws.send(
        buildLbankPerpKlineSubscribe(config.tickerSymbol, period, klineTsn),
      );
    }
  }

  private startHeartbeat(ws: WebSocket) {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send("ping");
      } catch {
        // ignore
      }
    }, HEARTBEAT_MS);
  }

  private connect() {
    if (this.stopped || this.connecting) return;

    this.connecting = true;
    this.generation += 1;
    const generation = this.generation;

    this.tearDownSocket();
    this.connecting = true;

    console.log(
      `[lbank] connecting to ${config.lbankWsUrl} (${config.tickerSymbol} perp)`,
    );
    const ws = new WebSocket(config.lbankWsUrl);
    this.ws = ws;

    this.connectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn("[lbank] connect timeout");
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      if (generation !== this.generation) return;
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.connecting = false;
      console.log("[lbank] connected");
      this.backoffMs = MIN_BACKOFF_MS;
      this.subscribeMarket(ws);
      this.startHeartbeat(ws);
      tickerHub.broadcast({ type: "status", connected: true });
    });

    ws.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      const raw =
        typeof event.data === "string" ? event.data : String(event.data);

      if (isLbankPerpPong(raw)) {
        this.lastMessageAt = Date.now();
        return;
      }

      const ticker = parseLbankPerpTicker(raw, config.tickerSymbol);
      if (ticker) {
        this.publish(ticker);
        return;
      }

      const klines = parseLbankPerpKlines(
        raw,
        config.tickerSymbol,
        config.perpKlinePeriods,
      );
      if (klines.length > 0) {
        this.lastMessageAt = Date.now();
        for (const update of klines) {
          for (const listener of this.klineListeners) {
            listener(update);
          }
        }
      }
    });

    ws.addEventListener("close", (event) => {
      if (generation !== this.generation) return;
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.clearHeartbeat();
      console.warn(
        `[lbank] closed code=${event.code} reason=${event.reason || "n/a"}`,
      );
      this.ws = null;
      this.connecting = false;
      tickerHub.broadcast({ type: "status", connected: false });
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      if (generation !== this.generation) return;
      console.error("[lbank] socket error");
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    console.log(`[lbank] reconnecting in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export const lbankTickerClient = new LbankTickerClient();
