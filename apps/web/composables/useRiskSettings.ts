import type { RiskRules } from "@trade/shared"

const STORAGE_KEY = "trade.riskSettings"

const DEFAULTS: RiskRules = {
  accountBalanceUsdt: 10_000,
  maxRiskPercent: 1,
  maxLeverage: 5,
}

function loadStored(): RiskRules {
  if (!import.meta.client) return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<RiskRules>
    return {
      accountBalanceUsdt:
        Number(parsed.accountBalanceUsdt) || DEFAULTS.accountBalanceUsdt,
      maxRiskPercent:
        Number(parsed.maxRiskPercent) || DEFAULTS.maxRiskPercent,
      maxLeverage: Number(parsed.maxLeverage) || DEFAULTS.maxLeverage,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function useRiskSettings() {
  const accountBalanceUsdt = ref(DEFAULTS.accountBalanceUsdt)
  const maxRiskPercent = ref(DEFAULTS.maxRiskPercent)
  const maxLeverage = ref(DEFAULTS.maxLeverage)

  onMounted(() => {
    const stored = loadStored()
    accountBalanceUsdt.value = stored.accountBalanceUsdt
    maxRiskPercent.value = stored.maxRiskPercent
    maxLeverage.value = stored.maxLeverage
  })

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

  function persist() {
    if (!import.meta.client || !isValid.value) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(risk.value))
  }

  watch(risk, persist, { deep: true })

  return {
    accountBalanceUsdt,
    maxRiskPercent,
    maxLeverage,
    risk,
    isValid,
  }
}
