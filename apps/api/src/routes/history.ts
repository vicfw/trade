import { Hono } from "hono";
import type { BtcTradeHistoryResponse } from "@trade/shared";
import { tradeStore } from "../market/tracking";

export const historyRoutes = new Hono();

/** Closed trades only — every record is a take-profit (success) or stop-loss (failure). */
historyRoutes.get("/history/btc", (c) => {
  const response: BtcTradeHistoryResponse = {
    records: tradeStore.listHistory(),
  };
  return c.json(response);
});

historyRoutes.delete("/history/btc", (c) => {
  tradeStore.clearHistory();
  return c.json({ ok: true });
});
