import OpenAI from "openai"
import type { LlmPositionProposal } from "@trade/shared"
import { config } from "../config"
import type { MarketSnapshot } from "../market/buildSnapshot"
import { buildUserPrompt, POSITION_SYSTEM_PROMPT } from "./prompt"
import { parseProposal } from "./parseProposal"

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
      })
    }
    return this.client
  }

  async suggestPosition(snapshot: MarketSnapshot): Promise<LlmPositionProposal> {
    const client = this.getClient()

    const response = await client.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: "system", content: POSITION_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(snapshot) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error("LLM returned empty content")
    }

    return parseProposal(content)
  }
}

export const llmClient = new LlmClient()
