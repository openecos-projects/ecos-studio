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
    <p v-if="!compact" class="timing-source-legend">
      <span>Red cells</span> identify Worst-row sources, including ties; red does not
      necessarily mean a violation. NVP highlights non-zero contributors to the total.
    </p>
    <div class="timing-table-scroll">
      <table class="timing-table">
        <thead>
          <tr>
            <th class="timing-corner-col">Corner</th>
            <th>{{ compact ? 'Setup WNS' : 'Setup WNS (ns)' }}</th>
            <th>{{ compact ? 'Setup TNS' : 'Setup TNS (ns)' }}</th>
            <th title="Number of violating setup paths">
              {{ compact ? 'NVP' : 'Setup NVP' }}
            </th>
            <th>{{ compact ? 'Hold WNS' : 'Hold WNS (ns)' }}</th>
            <th>{{ compact ? 'Hold TNS' : 'Hold TNS (ns)' }}</th>
            <th title="Number of violating hold paths">
              {{ compact ? 'NVP' : 'Hold NVP' }}
            </th>
            <th v-if="!compact">Freq (MHz)</th>
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
                :class="metricCellClass(row, 'setup', 'wns')"
                :title="metricCellTitle(row, 'setup', 'wns')"
              >
                {{ formatSlack(row.setup?.wns) }}
              </td>
              <td
                :class="metricCellClass(row, 'setup', 'tns')"
                :title="metricCellTitle(row, 'setup', 'tns')"
              >
                {{ formatSlack(row.setup?.tns) }}
              </td>
              <td
                :class="metricCellClass(row, 'setup', 'nvp')"
                :title="metricCellTitle(row, 'setup', 'nvp')"
              >
                {{ row.setup?.nvp ?? '—' }}
              </td>
              <td
                :class="metricCellClass(row, 'hold', 'wns')"
                :title="metricCellTitle(row, 'hold', 'wns')"
              >
                {{ formatSlack(row.hold?.wns) }}
              </td>
              <td
                :class="metricCellClass(row, 'hold', 'tns')"
                :title="metricCellTitle(row, 'hold', 'tns')"
              >
                {{ formatSlack(row.hold?.tns) }}
              </td>
              <td
                :class="metricCellClass(row, 'hold', 'nvp')"
                :title="metricCellTitle(row, 'hold', 'nvp')"
              >
                {{ row.hold?.nvp ?? '—' }}
              </td>
              <td
                v-if="!compact"
                :class="metricCellClass(row, 'setup', 'frequencyMhz')"
                :title="metricCellTitle(row, 'setup', 'frequencyMhz')"
              >
                {{ row.setup?.frequencyMhz ?? '—' }}
              </td>
            </template>
          </tr>
          <tr class="timing-total-row">
            <th
              class="timing-corner-col"
              title="WNS/TNS and frequency are worst-corner values; NVP is summed across corners."
            >
              Worst
            </th>
            <td :class="slackClass(overview.worstSetup?.wns)">
              {{ formatSlack(overview.worstSetup?.wns) }}
            </td>
            <td :class="slackClass(minSetupTns)">{{ formatSlack(minSetupTns) }}</td>
            <td title="Total setup NVP across corners">
              {{ overview.setupViolationCount ?? '—' }}
            </td>
            <td :class="slackClass(overview.worstHold?.wns)">
              {{ formatSlack(overview.worstHold?.wns) }}
            </td>
            <td :class="slackClass(minHoldTns)">{{ formatSlack(minHoldTns) }}</td>
            <td title="Total hold NVP across corners">
              {{ overview.holdViolationCount ?? '—' }}
            </td>
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
const visibleRows = computed(() =>
  props.rows.length === 1 && !props.rows[0]?.missing ? [] : props.rows,
)

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

type TimingMetric = 'wns' | 'tns' | 'nvp' | 'frequencyMhz'

function metricValue(
  row: StaCornerRowModel,
  analysisType: 'setup' | 'hold',
  metric: TimingMetric,
): number | null {
  return metric === 'frequencyMhz'
    ? (row.setup?.frequencyMhz ?? null)
    : (row[analysisType]?.[metric] ?? null)
}

function isWorstSource(
  row: StaCornerRowModel,
  analysisType: 'setup' | 'hold',
  metric: TimingMetric,
): boolean {
  const value = metricValue(row, analysisType, metric)
  if (row.missing || value === null) return false
  if (metric === 'nvp') {
    const total =
      analysisType === 'setup'
        ? props.overview.setupViolationCount
        : props.overview.holdViolationCount
    return total !== null && value > 0
  }
  const target =
    metric === 'frequencyMhz'
      ? props.overview.frequencyMhz
      : metric === 'tns'
        ? analysisType === 'setup'
          ? minSetupTns.value
          : minHoldTns.value
        : analysisType === 'setup'
          ? props.overview.worstSetup?.wns
          : props.overview.worstHold?.wns
  return target !== null && target !== undefined && value === target
}

function metricCellClass(
  row: StaCornerRowModel,
  analysisType: 'setup' | 'hold',
  metric: TimingMetric,
): string[] {
  const value = metricValue(row, analysisType, metric)
  const classes =
    metric === 'nvp'
      ? countClass(value)
      : metric === 'frequencyMhz'
        ? []
        : slackClass(value)
  return isWorstSource(row, analysisType, metric)
    ? [...classes, 'is-worst-source']
    : classes
}

function metricCellTitle(
  row: StaCornerRowModel,
  analysisType: 'setup' | 'hold',
  metric: TimingMetric,
): string {
  const source = isWorstSource(row, analysisType, metric)
    ? metric === 'nvp'
      ? 'Contributes to the Worst-row NVP total'
      : 'Source of the Worst-row value (ties included)'
    : ''
  return [source, props.compact ? '' : formatStaPathPreview(row.firstPath)]
    .filter(Boolean)
    .join(' · ')
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

.timing-table-card:not(.is-compact) .timing-table-scroll {
  max-height: 320px;
}

.timing-table-card:not(.is-compact) .timing-table thead th {
  background: var(--bg-secondary);
  position: sticky;
  top: 0;
  z-index: 2;
}

.timing-table-card:not(.is-compact) .timing-total-row td,
.timing-table-card:not(.is-compact) .timing-total-row th {
  background: var(--bg-secondary);
  bottom: 0;
  position: sticky;
}

.timing-table {
  border-collapse: collapse;
  font-size: 10px;
  min-width: 100%;
}

.timing-table-card:not(.is-compact) .timing-table {
  font-size: 12px;
}

.timing-table-card:not(.is-compact) .timing-table th,
.timing-table-card:not(.is-compact) .timing-table td {
  padding: 6px 8px;
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

.timing-table .timing-corner-col {
  text-align: left;
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

.timing-table td.is-worst-source {
  background: color-mix(in srgb, var(--danger-color, #dc2626) 8%, transparent);
  color: var(--danger-color, #dc2626);
  font-weight: 700;
}

.timing-source-legend {
  color: var(--text-secondary);
  font-size: 11px;
  margin: 0;
}

.timing-source-legend span {
  color: var(--danger-color, #dc2626);
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
