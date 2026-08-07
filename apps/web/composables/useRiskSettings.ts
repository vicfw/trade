import { DEFAULT_RISK_RULES, type RiskRules } from "@trade/shared"

const PUT_DEBOUNCE_MS = 400

function riskEqual(a: RiskRules, b: RiskRules): boolean {
  return (
    a.accountBalanceUsdt === b.accountBalanceUsdt &&
    a.maxRiskPercent === b.maxRiskPercent &&
    a.maxLeverage === b.maxLeverage
  )
}

export function useRiskSettings() {
  const config = useRuntimeConfig()
  const accountBalanceUsdt = ref(DEFAULT_RISK_RULES.accountBalanceUsdt)
  const maxRiskPercent = ref(DEFAULT_RISK_RULES.maxRiskPercent)
  const maxLeverage = ref(DEFAULT_RISK_RULES.maxLeverage)
  const hydrated = ref(false)
  const syncError = ref<string | null>(null)
  let putTimer: ReturnType<typeof setTimeout> | null = null
  let abortController: AbortController | null = null
  let lastSynced: RiskRules = { ...DEFAULT_RISK_RULES }
  let suppressPush = true

  const risk = computed<RiskRules>(() => ({
    accountBalanceUsdt: accountBalanceUsdt.value,
    maxRiskPercent: maxRiskPercent.value,
    maxLeverage: maxLeverage.value,
  }))

  const isValid = computed(() => {
    return (
      accountBalanceUsdt.value > 0 &&
      maxRiskPercent.value > 0 &&
      maxRiskPercent.value <= 100 &&
      maxLeverage.value >= 1
    )
  })

  async function loadFromApi() {
    if (!import.meta.client) return
    suppressPush = true
    try {
      const response = await fetch(`${config.public.apiUrl}/settings/risk`)
      const payload = (await response.json()) as
        | { risk: RiskRules }
        | { error?: string }
      if (!response.ok || !("risk" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Failed to load risk settings (${response.status})`,
        )
      }
      accountBalanceUsdt.value = payload.risk.accountBalanceUsdt
      maxRiskPercent.value = payload.risk.maxRiskPercent
      maxLeverage.value = payload.risk.maxLeverage
      lastSynced = { ...payload.risk }
      syncError.value = null
    } catch (err) {
      syncError.value =
        err instanceof Error ? err.message : "Failed to load risk settings"
      lastSynced = { ...risk.value }
    } finally {
      hydrated.value = true
      await nextTick()
      suppressPush = false
    }
  }

  async function pushToApi(next: RiskRules, opts?: { keepalive?: boolean }) {
    if (!import.meta.client) return
    if (riskEqual(next, lastSynced)) return

    if (!opts?.keepalive) {
      abortController?.abort()
      abortController = new AbortController()
    }

    try {
      const response = await fetch(`${config.public.apiUrl}/settings/risk`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
        signal: opts?.keepalive ? undefined : abortController?.signal,
        keepalive: opts?.keepalive === true,
      })
      const payload = (await response.json()) as
        | { risk: RiskRules }
        | { error?: string }
      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Failed to save risk settings (${response.status})`,
        )
      }
      if ("risk" in payload) {
        lastSynced = { ...payload.risk }
      } else {
        lastSynced = { ...next }
      }
      syncError.value = null
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      syncError.value =
        err instanceof Error ? err.message : "Failed to save risk settings"
    }
  }

  function schedulePush() {
    if (suppressPush || !hydrated.value || !isValid.value) return
    if (riskEqual(risk.value, lastSynced)) return
    if (putTimer) clearTimeout(putTimer)
    putTimer = setTimeout(() => {
      putTimer = null
      void pushToApi(risk.value)
    }, PUT_DEBOUNCE_MS)
  }

  onMounted(() => {
    void loadFromApi()
  })

  watch(risk, schedulePush, { deep: true })

  onUnmounted(() => {
    if (putTimer) {
      clearTimeout(putTimer)
      putTimer = null
      if (hydrated.value && isValid.value && !riskEqual(risk.value, lastSynced)) {
        void pushToApi(risk.value, { keepalive: true })
      }
    }
    abortController?.abort()
  })

  return {
    accountBalanceUsdt,
    maxRiskPercent,
    maxLeverage,
    risk,
    isValid,
    syncError,
  }
}
