export interface LbankEnvelope<T> {
  error_code: number
  msg?: string
  result?: string | boolean
  data: T
  ts?: number
}

const FETCH_TIMEOUT_MS = 15_000

export async function lbankGet<T>(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `LBank ${path} failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`,
    )
  }

  const payload = (await response.json()) as Partial<LbankEnvelope<T>>
  if (typeof payload.error_code !== "number") {
    throw new Error(`LBank ${path} response missing error_code`)
  }
  if (payload.error_code !== 0) {
    throw new Error(
      `LBank ${path} error_code=${payload.error_code}${payload.msg ? ` — ${payload.msg}` : ""}`,
    )
  }
  if (!("data" in payload)) {
    throw new Error(`LBank ${path} response missing data`)
  }

  return payload.data as T
}

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}
