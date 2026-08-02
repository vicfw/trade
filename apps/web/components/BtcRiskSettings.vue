<script setup lang="ts">
const accountBalanceUsdt = defineModel<number>("accountBalanceUsdt", {
  required: true,
})
const maxRiskPercent = defineModel<number>("maxRiskPercent", { required: true })
const maxLeverage = defineModel<number>("maxLeverage", { required: true })

defineProps<{
  valid: boolean
}>()
</script>

<template>
  <section class="risk">
  

    <div class="risk__fields">
      <label class="risk__field">
        <span class="risk__label">Account balance (USDT)</span>
        <input
          v-model.number="accountBalanceUsdt"
          class="risk__input"
          type="number"
          min="1"
          step="100"
        />
      </label>
      <label class="risk__field">
        <span class="risk__label">Max risk %</span>
        <input
          v-model.number="maxRiskPercent"
          class="risk__input"
          type="number"
          min="0.1"
          max="100"
          step="0.1"
        />
      </label>
      <label class="risk__field">
        <span class="risk__label">Max leverage</span>
        <input
          v-model.number="maxLeverage"
          class="risk__input"
          type="number"
          min="1"
          step="1"
        />
      </label>
    </div>

    <p v-if="!valid" class="risk__hint risk__hint--error">
      Enter a positive balance, risk % in (0, 100], and leverage ≥ 1.
    </p>
  </section>
</template>

<style scoped>
.risk {
  width: min(960px, 100%);
  margin: 0 auto;
  padding: 0 1.5rem 0.75rem;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
}

.risk__header {
  margin-bottom: 1rem;
}

.risk__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1a1f16;
}

.risk__subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: #7a8470;
}

.risk__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  border-top: 1px solid rgba(26, 31, 22, 0.08);
  padding-top: 1rem;
}

@media (max-width: 640px) {
  .risk__fields {
    grid-template-columns: 1fr;
  }
}

.risk__field {
  display: grid;
  gap: 0.35rem;
}

.risk__label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a8470;
}

.risk__input {
  appearance: none;
  border: 1px solid rgba(26, 31, 22, 0.15);
  background: rgba(255, 255, 255, 0.7);
  color: #1a1f16;
  font: inherit;
  font-size: 0.95rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0;
}

.risk__input:focus {
  outline: 2px solid rgba(47, 107, 58, 0.35);
  outline-offset: 1px;
}

.risk__hint {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  color: #7a8470;
}

.risk__hint--error {
  color: #9b3a2f;
}
</style>
