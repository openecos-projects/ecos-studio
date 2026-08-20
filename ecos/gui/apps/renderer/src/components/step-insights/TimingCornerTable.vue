<template>
  <section class="timing-table-card" :class="{ 'is-compact': compact }">
    <header v-if="!compact" class="timing-subheader">
      <h3>Corner Overview</h3>
      <div class="timing-toolbar">
        <label v-if="pathGroupOptions?.length" class="timing-toggle">
          Path group
          <select :value="selectedPathGroup" @change="onPathGroupChange">
            <option value="summary">Summary</option>
            <option v-for="group in pathGroupOptions" :key="group" :value="group">
              {{ group }}
            </option>
          </select>
        </label>
        <label class="timing-toggle"
          ><input
            type="checkbox"
            :checked="negativeFirst"
            @change="onNegativeFirstChange"
          />Negative first</label
        >
      </div>
    </header>
    <div class="timing-table-scroll">
      <table class="timing-table">
        <thead>
          <tr>
            <th class="timing-corner-col">Corner</th>
            <th>Setup WNS</th>
            <th>Setup TNS</th>
            <th>NVP</th>
            <th>Hold WNS</th>
            <th>Hold TNS</th>
            <th>NVP</th>
            <th v-if="!compact">Freq</th>
          </tr>
        </thead>
        <tbody>
          <!-- A single-corner summary duplicates the Worst row, so it is skipped. -->
          <tr
            v-for="row in visibleRows"
            :key="row.corner"
            :class="{ 'is-missing': row.missing }"
          >
            <th class="timing-corner-col" :title="row.corner">{{ row.corner }}</th>
            <template v-if="row.missing">
              <td :colspan="compact ? 6 : 7" class="timing-missing-cell">missing</td>
            </template>
            <template v-else>
              <td
                :class="slackClass(row.setup?.wns)"
                :title="compact ? undefined : pathPreviewTitle(row)"
              >
                {{ formatSlack(row.setup?.wns) }}
              </td>
              <td
                :class="slackClass(row.setup?.tns)"
                :title="compact ? undefined : pathPreviewTitle(row)"
              >
                {{ formatSlack(row.setup?.tns) }}
              </td>
              <td
                :class="countClass(row.setup?.nvp)"
                :title="compact ? undefined : pathPreviewTitle(row)"
              >
                {{ row.setup?.nvp ?? '—' }}
              </td>
              <td
                :class="slackClass(row.hold?.wns)"
                :title="compact ? undefined : pathPreviewTitle(row)"
              >
                {{ formatSlack(row.hold?.wns) }}
              </td>
              <td
                :class="slackClass(row.hold?.tns)"
                :title="compact ? undefined : pathPreviewTitle(row)"
              >
                {{ formatSlack(row.hold?.tns) }}
              </td>
              <td
                :class="countClass(row.hold?.nvp)"
                :title="compact ? undefined : pathPreviewTitle(row)"
              >
                {{ row.hold?.nvp ?? '—' }}
              </td>
              <td v-if="!compact" :title="pathPreviewTitle(row)">
                {{ row.setup?.frequencyMhz ?? '—' }}
              </td>
            </template>
          </tr>
          <tr class="timing-total-row">
            <th class="timing-corner-col">Worst</th>
            <td :class="slackClass(overview.worstSetup?.wns)">
              {{ formatSlack(overview.worstSetup?.wns) }}
            </td>
            <td :class="slackClass(minSetupTns)">{{ formatSlack(minSetupTns) }}</td>
            <td>{{ overview.setupViolationCount }}</td>
            <td :class="slackClass(overview.worstHold?.wns)">
              {{ formatSlack(overview.worstHold?.wns) }}
            </td>
            <td :class="slackClass(minHoldTns)">{{ formatSlack(minHoldTns) }}</td>
            <td>{{ overview.holdViolationCount }}</td>
            <td v-if="!compact">
              {{
                overview.frequencyMhz === null ? '—' : Math.round(overview.frequencyMhz)
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  formatStaPathPreview,
  type StaCornerRowModel,
  type StaOverviewModel,
} from '../flow-insights/flowInsightsData'
import { countClass, formatSlack, slackClass } from './timingFormat'

const props = defineProps<{
  overview: StaOverviewModel
  rows: readonly StaCornerRowModel[]
  pathGroupOptions?: string[]
  selectedPathGroup?: string
  negativeFirst?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:selectedPathGroup': [value: string]
  'update:negativeFirst': [value: boolean]
}>()

/** Corner rows to render; a single corner duplicates the Worst summary row. */
const visibleRows = computed(() => (props.rows.length === 1 ? [] : props.rows))

const minSetupTns = computed(() => {
  const values = props.overview.corners
    .map((row) => row.setup?.tns)
    .filter((value): value is number => value !== null && value !== undefined)
  return values.length ? Math.min(...values) : null
})

const minHoldTns = computed(() => {
  const values = props.overview.corners
    .map((row) => row.hold?.tns)
    .filter((value): value is number => value !== null && value !== undefined)
  return values.length ? Math.min(...values) : null
})

function pathPreviewTitle(row: StaCornerRowModel): string {
  return formatStaPathPreview(row.firstPath)
}

function onPathGroupChange(event: Event): void {
  emit('update:selectedPathGroup', (event.target as HTMLSelectElement).value)
}

function onNegativeFirstChange(event: Event): void {
  emit('update:negativeFirst', (event.target as HTMLInputElement).checked)
}
</script>

<style scoped>
.timing-table-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.timing-table-card.is-compact {
  background: transparent;
  border: 0;
  border-radius: 0;
  gap: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.timing-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.timing-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.timing-toolbar {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
}

.timing-toggle {
  align-items: center;
  color: var(--text-secondary);
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
}

.timing-toggle select {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 10px;
  padding: 1px 4px;
}

.timing-table-scroll {
  min-height: 0;
  overflow: auto;
}

.timing-table {
  border-collapse: collapse;
  font-size: 10px;
  min-width: 100%;
}

.timing-table th,
.timing-table td {
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 3px 6px;
  text-align: right;
  white-space: nowrap;
}

.timing-table thead th {
  color: var(--text-secondary);
  font-weight: 600;
}

.timing-corner-col {
  background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
  color: var(--text-secondary);
  font-weight: 600;
  left: 0;
  position: sticky;
  text-align: left;
  z-index: 1;
}

.timing-table-card.is-compact .timing-corner-col {
  position: static;
}

.timing-table td.is-good {
  color: var(--success-color);
}

.timing-table td.is-bad {
  color: var(--danger-color);
  font-weight: 700;
}

.timing-table td.is-missing {
  color: var(--text-secondary);
  opacity: 0.6;
}

.timing-table tr.is-missing td,
.timing-table tr.is-missing th {
  opacity: 0.5;
}

.timing-missing-cell {
  text-align: center !important;
}

.timing-total-row {
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
}

.timing-total-row th,
.timing-total-row td {
  font-weight: 700;
}
</style>
