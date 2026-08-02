import { Hono } from "hono"
import { cors } from "hono/cors"
import { createBunWebSocket } from "hono/bun"
import type { ServerWebSocket } from "bun"
import { config } from "./config"
import { healthRoutes } from "./routes/health"
import { candleRoutes } from "./routes/candles"
import { indicatorRoutes } from "./routes/indicators"
import { suggestRoutes } from "./routes/suggest"
import { testRoutes } from "./routes/test"
import { historyRoutes } from "./routes/history"
import { createWsRoutes } from "./routes/ws"

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>()

const app = new Hono()

app.use(
  "*",
  cors({
    origin: config.corsOrigin,
  }),
)

app.route("/", healthRoutes)
app.route("/", candleRoutes)
app.route("/", indicatorRoutes)
app.route("/", suggestRoutes)
app.route("/", testRoutes)
app.route("/", historyRoutes)
app.get("/ws/btc", createWsRoutes(upgradeWebSocket))

app.get("/", (c) =>
  c.json({
    name: "@trade/api",
    ws: "/ws/btc",
    candles: "/candles/btc",
    indicators: "/indicators/btc",
    suggest: "/suggest/btc",
    test: "/test/btc",
    history: "/history/btc",
  }),
)

export { app, websocket }
