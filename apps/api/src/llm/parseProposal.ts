import { validateLlmProposal } from "@trade/market"
import type { LlmPositionProposal } from "@trade/shared"

/**
 * Extract a JSON object from model content (plain JSON or ```json fences).
 */
export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error("Empty LLM response content")
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error("LLM response is not valid JSON")
  }
}

export function parseProposal(content: string): LlmPositionProposal {
  const raw = extractJsonObject(content)
  return validateLlmProposal(raw)
}
