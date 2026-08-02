import { describe, expect, test } from "bun:test"
import { extractJsonObject, parseProposal } from "./parseProposal"

describe("extractJsonObject", () => {
  test("parses plain JSON", () => {
    const raw = extractJsonObject(
      '{"side":"no_trade","entry":null,"stopLoss":null,"takeProfit":null,"confidence":"low","rationale":"Wait"}',
    )
    expect((raw as { side: string }).side).toBe("no_trade")
  })

  test("parses fenced JSON", () => {
    const raw = extractJsonObject(`\`\`\`json
{"side":"long","entry":100,"stopLoss":90,"takeProfit":130,"confidence":"medium","rationale":"Setup"}
\`\`\``)
    expect((raw as { entry: number }).entry).toBe(100)
  })

  test("extracts object from surrounding text", () => {
    const raw = extractJsonObject(
      'Here you go: {"side":"no_trade","entry":null,"stopLoss":null,"takeProfit":null,"confidence":"low","rationale":"Flat"} done',
    )
    expect((raw as { rationale: string }).rationale).toBe("Flat")
  })
})

describe("parseProposal", () => {
  test("returns typed proposal", () => {
    const proposal = parseProposal(
      JSON.stringify({
        side: "short",
        entry: 100_000,
        stopLoss: 102_000,
        takeProfit: 95_000,
        confidence: "high",
        rationale: "4h bear + 1h LH",
      }),
    )
    expect(proposal.side).toBe("short")
    expect(proposal.entry).toBe(100_000)
  })

  test("rejects invalid JSON", () => {
    expect(() => parseProposal("not json")).toThrow()
  })
})
