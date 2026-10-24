<template>
  <div class="insight-module step-details-panel">
    <div v-if="loading" class="insight-empty">Loading {{ title }}…</div>
    <div v-else-if="error" class="insight-empty is-error">{{ error }}</div>
    <div v-else-if="!summary" class="insight-empty">{{ emptyMessage }}</div>
    <template v-else>
      <header class="step-details-header">
        <div>
          <p class="step-details-eyebrow">{{ source }}</p>
          <h3>{{ title }}</h3>
        </div>
        <div
          v-if="summary.violationCount !== null"
          class="step-details-violation-count"
          :class="summary.violationCount === 0 ? 'is-clean' : 'is-dirty'"
        >
          <strong>{{ summary.violationCount }}</strong>
          <span>{{
            summary.violationCount === 0 ? 'Violations · clean' : 'Violations'
          }}</span>
        </div>
      </header>

      <p v-if="!summary.sections.length" class="insight-empty">
        {{ source }} contains no displayable data.
      </p>
      <div v-else class="step-details-sections">
        <section
          v-for="section in summary.sections"
          :key="section.id"
          class="step-details-section"
        >
          <header class="step-details-section-header">
            <h4>{{ section.title }}</h4>
            <span>{{ rowSummary(section.rows.length) }}</span>
          </header>
          <div v-if="section.rows.length" class="step-details-table-scroll">
            <table class="step-details-table">
              <thead>
                <tr>
                  <th
                    v-for="column in section.columns"
                    :key="column.key"
                    :title="column.key"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in section.rows" :key="rowIndex">
                  <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="step-details-section-empty">{{ section.emptyLabel }}</p>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { StepDetailsModel } from './stepDetails'

withDefaults(
  defineProps<{
    title: string
    source: string
    summary: StepDetailsModel | null
    loading?: boolean
    error?: string | null
    emptyMessage?: string
  }>(),
  {
    loading: false,
    error: null,
    emptyMessage: 'This analysis has not produced a result for this workspace.',
  },
)

function rowSummary(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`
}
</script>

<style scoped>
.step-details-panel {
  min-height: 100%;
  padding: 20px;
}

.step-details-header {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 18px;
}

.step-details-header h3,
.step-details-eyebrow {
  margin: 0;
}

.step-details-header h3 {
  color: var(--text-primary);
  font-size: 20px;
}

.step-details-eyebrow {
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  margin-bottom: 5px;
}

.step-details-violation-count {
  align-items: flex-end;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  min-width: 134px;
  padding: 9px 14px;
}

.step-details-violation-count strong {
  color: var(--text-primary);
  font-size: 24px;
  line-height: 1;
}

.step-details-violation-count span {
  color: var(--text-secondary);
  font-size: 10px;
  margin-top: 5px;
  text-transform: uppercase;
}

.step-details-violation-count.is-clean {
  background: color-mix(in srgb, var(--success-color) 8%, transparent);
  border-color: color-mix(in srgb, var(--success-color) 40%, var(--border-color));
}

.step-details-violation-count.is-clean strong {
  color: var(--success-color);
}

.step-details-violation-count.is-dirty {
  background: color-mix(in srgb, var(--danger-color) 8%, transparent);
  border-color: color-mix(in srgb, var(--danger-color) 40%, var(--border-color));
}

.step-details-violation-count.is-dirty strong {
  color: var(--danger-color);
}

.step-details-sections {
  display: grid;
  gap: 14px;
}

.step-details-section {
  background: color-mix(in srgb, var(--bg-secondary) 35%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.step-details-section-header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 11px 14px;
}

.step-details-section-header h4 {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  margin: 0;
}

.step-details-section-header span {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.step-details-table-scroll {
  border-top: 1px solid var(--border-color);
  overflow: auto;
}

.step-details-table {
  border-collapse: collapse;
  color: var(--text-primary);
  font-size: 11px;
  min-width: 100%;
}

.step-details-table th,
.step-details-table td {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  padding: 7px 11px;
  text-align: left;
  white-space: nowrap;
}

.step-details-table th {
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
  color: var(--text-secondary);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.step-details-table tbody tr:last-child td {
  border-bottom: 0;
}

.step-details-table tbody tr:hover {
  background: color-mix(in srgb, var(--accent-color) 6%, transparent);
}

.step-details-section-empty {
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
  padding: 18px 14px;
  text-align: center;
}

@media (max-width: 560px) {
  .step-details-header {
    align-items: stretch;
    flex-direction: column;
  }

  .step-details-violation-count {
    align-items: flex-start;
  }
}
</style>
