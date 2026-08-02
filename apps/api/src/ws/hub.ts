import type { WSContext } from "hono/ws"
import type { WsServerMessage } from "@trade/shared"

type ClientSocket = WSContext

function clientKey(ws: ClientSocket): object {
  return (ws.raw as object | undefined) ?? ws
}

class TickerHub {
  private clients = new Map<object, ClientSocket>()

  add(ws: ClientSocket) {
    this.clients.set(clientKey(ws), ws)
  }

  remove(ws: ClientSocket) {
    this.clients.delete(clientKey(ws))
  }

  get size() {
    return this.clients.size
  }

  broadcast(message: WsServerMessage) {
    const payload = JSON.stringify(message)
    for (const [key, client] of this.clients) {
      try {
        client.send(payload)
      } catch {
        this.clients.delete(key)
      }
    }
  }
}

export const tickerHub = new TickerHub()
