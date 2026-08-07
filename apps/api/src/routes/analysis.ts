import { Hono } from "hono"
import { validateRiskRules } from "@trade/market"
import type { RiskRules } from "@trade/shared"
import { analysisStore } from "../market/analysisStore"
import { buildAnalysisStatusResponse } from "../market/analysisScheduler"

export const analysisRoutes = new Hono()

analysisRoutes.get("/analysis/btc", (c) => {
  return c.json(buildAnalysisStatusResponse())
})

analysisRoutes.get("/settings/risk", (c) => {
  return c.json({ risk: analysisStore.getRisk() })
})

analysisRoutes.put("/settings/risk", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  let risk: RiskRules
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

  const saved = analysisStore.setRisk(risk)
  return c.json({ risk: saved })
})
