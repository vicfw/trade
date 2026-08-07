import { Hono } from "hono"
import { validateRiskRules } from "@trade/market"
import {
  runSuggest,
  SuggestBusyError,
  SuggestNotConfiguredError,
  SuggestNotReadyError,
  resetSuggestGuardsForTests,
} from "../market/runSuggest"

export const suggestRoutes = new Hono()

/** Test-only: clear rate-limit / in-flight guards between cases. */
export { resetSuggestGuardsForTests }

suggestRoutes.post("/suggest/btc", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  let risk
  try {
    risk = validateRiskRules(body)
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : "Invalid risk rules",
      },
      400,
    )
  }

  try {
    const response = await runSuggest({ risk })
    return c.json(response)
  } catch (err) {
    if (err instanceof SuggestNotConfiguredError) {
      return c.json({ error: err.message }, 503)
    }
    if (err instanceof SuggestBusyError) {
      return c.json(
        {
          error: err.message,
          ...(err.retryAfterSec != null
            ? { retryAfterSec: err.retryAfterSec }
            : {}),
        },
        429,
      )
    }
    if (err instanceof SuggestNotReadyError) {
      return c.json({ error: err.message }, 503)
    }
    const message =
      err instanceof Error ? err.message : "Suggestion request failed"
    return c.json({ error: message }, 502)
  }
})
