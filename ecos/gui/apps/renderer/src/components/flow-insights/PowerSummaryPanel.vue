<template>
  <div class="insight-module power-summary-panel">
    <div v-if="loading" class="insight-empty">Loading power analysis…</div>
    <div v-else-if="error" class="insight-empty is-error">{{ error }}</div>
    <div v-else-if="!summary" class="insight-empty">
      Power analysis has not produced a result for this workspace.
    </div>
    <template v-else>
      <header class="power-summary-header">
        <div>
          <p class="power-summary-eyebrow">powerAnalysis.step.json</p>
          <h3>Power Summary</h3>
        </div>
        <span>µW</span>
      </header>
      <dl class="power-summary-grid">
        <div v-for="metric in metrics" :key="metric.id">
          <dt>{{ metric.label }}</dt>
          <dd>{{ formatValue(metric.key) }}</dd>
        </div>
      </dl>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { PowerSummaryModel } from './powerSummary'

const props = defineProps<{
  summary: PowerSummaryModel | null
  loading?: boolean
  error?: string | null
}>()

const metrics = [
  { id: 'internal', label: 'Internal', key: 'internalUw' },
  { id: 'switching', label: 'Switching', key: 'switchingUw' },
  { id: 'dynamic', label: 'Dynamic', key: 'dynamicUw' },
  { id: 'leakage', label: 'Leakage', key: 'leakageUw' },
] as const

function formatValue(key: (typeof metrics)[number]['key']): string {
  const value = props.summary?.[key]
  return value === undefined
    ? 'N/A'
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}
</script>

<style scoped>
.power-summary-panel {
  min-height: 100%;
  padding: 20px;
}

.power-summary-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.power-summary-header h3,
.power-summary-header p {
  margin: 0;
}

.power-summary-header h3 {
  color: var(--text-primary);
  font-size: 20px;
}

.power-summary-header > span,
.power-summary-eyebrow {
  color: var(--text-secondary);
  font-size: 11px;
}

.power-summary-eyebrow {
  margin-bottom: 5px !important;
  font-family: var(--font-mono, monospace);
}

.power-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.power-summary-grid div {
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-secondary) 45%, transparent);
}

.power-summary-grid dt {
  color: var(--text-secondary);
  font-size: 12px;
}

.power-summary-grid dd {
  margin: 7px 0 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 700;
}

@media (max-width: 560px) {
  .power-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
