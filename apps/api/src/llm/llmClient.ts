import OpenAI from "openai"
import type { LlmPositionProposal } from "@trade/shared"
import { config } from "../config"
import type { MarketSnapshot } from "../market/buildSnapshot"
import { buildUserPrompt, POSITION_SYSTEM_PROMPT } from "./prompt"
import { parseProposal } from "./parseProposal"

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}

/**
 * OpenAI-compatible chat client for the active LLM_PROVIDER
 * (GapGPT or Moonshot / Kimi).
 */
export class LlmClient {
  private client: OpenAI | null = null

  isConfigured(): boolean {
    return Boolean(config.llm.apiKey)
  }

  private getClient(): OpenAI {
    if (!config.llm.apiKey) {
      throw new Error(`${config.llm.apiKeyEnv} is not configured`)
    }
    if (!this.client) {
      this.client = new OpenAI({
        baseURL: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        timeout: config.llmTimeoutMs,
        // Retries on timeout re-bill GapGPT and stretch wait ~3×; R1 is slow, not flaky.
        maxRetries: 0,
      })
    }
    return this.client
  }

  async suggestPosition(snapshot: MarketSnapshot): Promise<LlmPositionProposal> {
    const client = this.getClient()
    const userPrompt = buildUserPrompt(snapshot)
    const startedAt = Date.now()

    console.log(
      `[llm] chat.completions start provider=${config.llm.provider} model=${config.llm.model} timeoutMs=${config.llmTimeoutMs} base=${config.llm.baseUrl} systemChars=${POSITION_SYSTEM_PROMPT.length} userChars=${userPrompt.length}`,
    )

    try {
      const response = await client.chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: "system", content: POSITION_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      })

      const choice = response.choices[0]
      const message = choice?.message
      const content = message?.content
      const usage = response.usage
      // Some reasoning proxies put thinking in non-standard fields.
      const reasoningChars =
        message && "reasoning_content" in message
          ? String(
              (message as { reasoning_content?: unknown }).reasoning_content ??
                "",
            ).length
          : 0

      console.log(
        `[llm] chat.completions ok elapsedMs=${elapsedMs(startedAt)} id=${response.id ?? "—"} finish=${choice?.finish_reason ?? "—"} contentChars=${content?.length ?? 0} reasoningChars=${reasoningChars} promptTokens=${usage?.prompt_tokens ?? "—"} completionTokens=${usage?.completion_tokens ?? "—"} totalTokens=${usage?.total_tokens ?? "—"}`,
      )

      if (!content) {
        throw new Error(
          `LLM returned empty content (finish=${choice?.finish_reason ?? "—"}, reasoningChars=${reasoningChars})`,
        )
      }

      const proposal = parseProposal(content)
      console.log(
        `[llm] proposal parsed elapsedMs=${elapsedMs(startedAt)} side=${proposal.side} confidence=${proposal.confidence}`,
      )
      return proposal
    } catch (err) {
      const status =
        err instanceof OpenAI.APIError ? ` status=${err.status}` : ""
      const code =
        err instanceof OpenAI.APIError && err.code
          ? ` code=${err.code}`
          : ""
      console.error(
        `[llm] chat.completions failed elapsedMs=${elapsedMs(startedAt)} provider=${config.llm.provider} model=${config.llm.model} timeoutMs=${config.llmTimeoutMs}${status}${code}: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  }
}

export const llmClient = new LlmClient()
