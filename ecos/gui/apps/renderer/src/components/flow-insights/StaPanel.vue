<template>
  <div class="insight-module">
    <div v-if="!model || !model.corners.length" class="insight-empty">
      Waiting for STA corners…
    </div>
    <template v-else>
      <div class="sta-summary">
        <div class="sta-kpi" :class="worstSetupTone">
          <span>Worst setup WNS</span>
          <strong>{{ formatSlack(displayed.worstSetup?.wns) }}</strong>
          <small>{{ displayed.worstSetup?.corner ?? '--' }}</small>
        </div>
        <div class="sta-kpi" :class="worstHoldTone">
          <span>Worst hold WNS</span>
          <strong>{{ formatSlack(displayed.worstHold?.wns) }}</strong>
          <small>{{ displayed.worstHold?.corner ?? '--' }}</small>
        </div>
        <div class="sta-kpi" :class="overallTone">
          <span>Frequency</span>
          <strong>{{
            displayed.frequencyMhz === null
              ? '--'
              : `${Math.round(displayed.frequencyMhz)} MHz`
          }}</strong>
          <small>{{
            displayed.allCornersMet === null
              ? ''
              : displayed.allCornersMet
                ? 'all corners met'
                : 'violations'
          }}</small>
        </div>
      </div>

      <section class="sta-card">
        <header class="sta-subheader">
          <h3>Corner Overview</h3>
          <div class="sta-toolbar">
            <label v-if="pathGroupOptions.length" class="sta-toggle">
              Path group
              <select v-model="selectedPathGroup">
                <option value="summary">Summary</option>
                <option v-for="group in pathGroupOptions" :key="group" :value="group">
                  {{ group }}
                </option>
              </select>
            </label>
            <label class="sta-toggle"
              ><input v-model="negativeFirst" type="checkbox" />Negative first</label
            >
          </div>
        </header>
        <div class="sta-table-scroll">
          <table class="sta-table">
            <thead>
              <tr>
                <th class="sta-corner-col">Corner</th>
                <th>Setup WNS</th>
                <th>Setup TNS</th>
                <th>NVP</th>
                <th>Hold WNS</th>
                <th>Hold TNS</th>
                <th>NVP</th>
                <th>Freq</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in sortedCorners"
                :key="row.corner"
                :class="{ 'is-missing': row.missing }"
              >
                <th class="sta-corner-col" :title="row.corner">{{ row.corner }}</th>
                <template v-if="row.missing">
                  <td colspan="7" class="sta-missing-cell">missing</td>
                </template>
                <template v-else>
                  <td :class="slackClass(row.setup?.wns)" :title="pathPreviewTitle(row)">
                    {{ formatSlack(row.setup?.wns) }}
                  </td>
                  <td :class="slackClass(row.setup?.tns)" :title="pathPreviewTitle(row)">
                    {{ formatSlack(row.setup?.tns) }}
                  </td>
                  <td :class="countClass(row.setup?.nvp)" :title="pathPreviewTitle(row)">
                    {{ row.setup?.nvp ?? '—' }}
                  </td>
                  <td :class="slackClass(row.hold?.wns)" :title="pathPreviewTitle(row)">
                    {{ formatSlack(row.hold?.wns) }}
                  </td>
                  <td :class="slackClass(row.hold?.tns)" :title="pathPreviewTitle(row)">
                    {{ formatSlack(row.hold?.tns) }}
                  </td>
                  <td :class="countClass(row.hold?.nvp)" :title="pathPreviewTitle(row)">
                    {{ row.hold?.nvp ?? '—' }}
                  </td>
                  <td :title="pathPreviewTitle(row)">
                    {{ row.setup?.frequencyMhz ?? '—' }}
                  </td>
                </template>
              </tr>
              <tr class="sta-total-row">
                <th class="sta-corner-col">Worst</th>
                <td :class="slackClass(displayed.worstSetup?.wns)">
                  {{ formatSlack(displayed.worstSetup?.wns) }}
                </td>
                <td :class="slackClass(minSetupTns)">{{ formatSlack(minSetupTns) }}</td>
                <td>{{ displayed.setupViolationCount }}</td>
                <td :class="slackClass(displayed.worstHold?.wns)">
                  {{ formatSlack(displayed.worstHold?.wns) }}
                </td>
                <td :class="slackClass(minHoldTns)">{{ formatSlack(minHoldTns) }}</td>
                <td>{{ displayed.holdViolationCount }}</td>
                <td>
                  {{
                    displayed.frequencyMhz === null
                      ? '—'
                      : Math.round(displayed.frequencyMhz)
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="sta-card">
        <header class="sta-subheader">
          <h3>WNS by Corner</h3>
          <span class="sta-hint">▲ setup · ▼ hold · y=0 margin line</span>
        </header>
        <FlowTrendChart
          label="Setup and hold WNS across corners"
          :categories="chartCorners"
          :series="wnsSeries"
          left-unit="ns"
          height="220px"
          :mark-line-y="0"
          negative-band
        />
      </section>

      <section
        v-if="criticalPaths && (criticalPaths.setup.length || criticalPaths.hold.length)"
        class="sta-card"
      >
        <header class="sta-subheader">
          <h3>Critical Paths</h3>
          <span class="sta-hint">worst slack first · stage delay waterfall</span>
        </header>
        <div v-for="group in pathGroups" :key="group.id" class="sta-path-group">
          <h4>{{ group.title }}</h4>
          <article v-for="path in group.paths" :key="path.id" class="sta-path-card">
            <header>
              <strong>{{ path.id.split(':').slice(1).join(':') || path.id }}</strong>
              <span :class="slackClass(path.slackNs)"
                >{{ formatSlack(path.slackNs) }} ns</span
              >
              <small>{{ path.stageCount }} stages · {{ path.corner }}</small>
            </header>
            <div class="sta-path-waterfall" aria-hidden="true">
              <span
                v-for="(stage, index) in path.stages"
                :key="`${path.id}-${index}`"
                :style="{ flexGrow: Math.max(stage.delayNs ?? 0, 0.01) }"
                :title="stageTitle(stage, index)"
              />
            </div>
            <ol class="sta-path-stages">
              <li
                v-for="(stage, index) in path.stages"
                :key="`${path.id}-stage-${index}`"
              >
                <span>{{ stage.pin || `stage ${index + 1}` }}</span>
                <small>{{ stage.cell }}</small>
                <em>{{ formatDelay(stage.delayNs) }}</em>
              </li>
            </ol>
          </article>
        </div>
      </section>

      <section v-if="convergence" class="sta-card">
        <header class="sta-subheader">
          <h3>Cross-run Convergence</h3>
          <span class="sta-hint">baseline → current workspace</span>
        </header>
        <FlowTrendChart
          label="STA WNS across workspaces"
          :categories="convergence.points.map((point) => point.workspaceName)"
          :series="convergenceSeries"
          left-unit="ns"
          right-unit="MHz"
          height="200px"
          :mark-line-y="0"
          negative-band
        />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import {
  formatStaPathPreview,
  selectStaPathGroup,
  type StaConvergenceModel,
  type StaCornerRowModel,
  type StaCriticalPath,
  type StaCriticalPathsModel,
  type StaOverviewModel,
  type StaPathStage,
} from './flowInsightsData'

const props = defineProps<{
  model: StaOverviewModel | null
  criticalPaths?: StaCriticalPathsModel | null
  convergence?: StaConvergenceModel | null
}>()

const negativeFirst = ref(false)
const selectedPathGroup = ref('summary')

const pathGroupOptions = computed(() => props.model?.pathGroups ?? [])

watch(pathGroupOptions, (groups) => {
  if (
    selectedPathGroup.value !== 'summary' &&
    !groups.includes(selectedPathGroup.value)
  ) {
    selectedPathGroup.value = 'summary'
  }
})

const displayed = computed(() => {
  if (!props.model) {
    return {
      corners: [],
      pathGroups: [],
      selectedPathGroup: 'summary',
      worstSetup: null,
      worstHold: null,
      frequencyMhz: null,
      setupViolationCount: 0,
      holdViolationCount: 0,
      allCornersMet: null,
    }
  }
  return selectStaPathGroup(props.model, selectedPathGroup.value)
})

const sortedCorners = computed(() => {
  const rows = [...displayed.value.corners]
  if (!negativeFirst.value) return rows
  return rows.sort((left, right) => worstSlackOf(left) - worstSlackOf(right))
})

function worstSlackOf(row: StaCornerRowModel): number {
  const setup = row.setup?.wns
  const hold = row.hold?.wns
  const values = [setup, hold].filter(
    (value): value is number => value !== null && value !== undefined,
  )
  if (!values.length) return Number.POSITIVE_INFINITY
  return Math.min(...values)
}

const chartCorners = computed(() => sortedCorners.value.map((row) => row.corner))

const pathGroups = computed(() => {
  const groups: Array<{ id: string; title: string; paths: StaCriticalPath[] }> = []
  if (props.criticalPaths?.setup.length) {
    groups.push({
      id: 'setup',
      title: `Worst setup${displayed.value.worstSetup ? ` @ ${displayed.value.worstSetup.corner}` : ''}`,
      paths: props.criticalPaths.setup,
    })
  }
  if (props.criticalPaths?.hold.length) {
    groups.push({
      id: 'hold',
      title: `Worst hold${displayed.value.worstHold ? ` @ ${displayed.value.worstHold.corner}` : ''}`,
      paths: props.criticalPaths.hold,
    })
  }
  return groups
})

const convergenceSeries = computed<FlowTrendSeries[]>(() => {
  const points = props.convergence?.points ?? []
  return [
    {
      id: 'setup-wns-run',
      label: 'Setup WNS',
      type: 'line' as const,
      values: points.map((point) => point.setupWns),
      unit: 'ns',
      color: '#3b82f6',
      symbol: 'triangle',
    },
    {
      id: 'hold-wns-run',
      label: 'Hold WNS',
      type: 'line' as const,
      values: points.map((point) => point.holdWns),
      unit: 'ns',
      color: '#f59e0b',
      symbol: 'triangle',
      symbolRotate: 180,
    },
    {
      id: 'freq-run',
      label: 'Frequency',
      type: 'line' as const,
      values: points.map((point) => point.frequencyMhz),
      unit: 'MHz',
      color: '#10b981',
      yAxisIndex: 1 as const,
    },
  ]
})

const wnsSeries = computed<FlowTrendSeries[]>(() => [
  {
    id: 'setup-wns',
    label: 'Setup WNS',
    type: 'line',
    values: sortedCorners.value.map((row) => row.setup?.wns ?? null),
    unit: 'ns',
    color: '#3b82f6',
    symbol: 'triangle',
  },
  {
    id: 'hold-wns',
    label: 'Hold WNS',
    type: 'line',
    values: sortedCorners.value.map((row) => row.hold?.wns ?? null),
    unit: 'ns',
    color: '#f59e0b',
    symbol: 'triangle',
    symbolRotate: 180,
  },
])

const minSetupTns = computed(() => {
  const values = displayed.value.corners
    .map((row) => row.setup?.tns)
    .filter((value): value is number => value !== null && value !== undefined)
  return values.length ? Math.min(...values) : null
})

const minHoldTns = computed(() => {
  const values = displayed.value.corners
    .map((row) => row.hold?.tns)
    .filter((value): value is number => value !== null && value !== undefined)
  return values.length ? Math.min(...values) : null
})

const worstSetupTone = computed(() => slackTone(displayed.value.worstSetup?.wns))
const worstHoldTone = computed(() => slackTone(displayed.value.worstHold?.wns))
const overallTone = computed(() => {
  if (
    displayed.value.allCornersMet === null ||
    displayed.value.allCornersMet === undefined
  )
    return ''
  return displayed.value.allCornersMet ? 'is-good' : 'is-bad'
})

function pathPreviewTitle(row: StaCornerRowModel): string {
  return formatStaPathPreview(row.firstPath)
}

function slackTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value >= 0 ? 'is-good' : 'is-bad'
}

function slackClass(value: number | null | undefined): string[] {
  if (value === null || value === undefined) return ['is-missing']
  return value >= 0 ? ['is-good'] : ['is-bad']
}

function countClass(value: number | null | undefined): string[] {
  if (value === null || value === undefined) return ['is-missing']
  return value === 0 ? ['is-good'] : ['is-bad']
}

function formatSlack(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(3)}`
}

function formatDelay(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(3)} ns`
}

function stageTitle(stage: StaPathStage, index: number): string {
  const pin = stage.pin || `stage ${index + 1}`
  const cell = stage.cell ? ` · ${stage.cell}` : ''
  return `${pin}${cell} · ${formatDelay(stage.delayNs)}`
}
</script>

<style scoped>
.insight-module {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.insight-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 12px;
  justify-content: center;
  min-height: 160px;
}

.sta-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sta-kpi {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 14px;
}

.sta-kpi span {
  color: var(--text-secondary);
  font-size: 10px;
}

.sta-kpi strong {
  color: var(--text-primary);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.sta-kpi small {
  color: var(--text-secondary);
  font-size: 9px;
}

.sta-kpi.is-good strong {
  color: var(--success-color);
}

.sta-kpi.is-bad strong {
  color: var(--danger-color);
}

.sta-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.sta-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.sta-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.sta-hint {
  color: var(--text-secondary);
  font-size: 9px;
}

.sta-toolbar {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sta-toggle {
  align-items: center;
  color: var(--text-secondary);
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
}

.sta-toggle select {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 10px;
  padding: 1px 4px;
}

.sta-table-scroll {
  overflow-x: auto;
}

.sta-table {
  border-collapse: collapse;
  font-size: 10px;
  min-width: 100%;
}

.sta-table th,
.sta-table td {
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 3px 6px;
  text-align: right;
  white-space: nowrap;
}

.sta-table thead th {
  color: var(--text-secondary);
  font-weight: 600;
}

.sta-corner-col {
  background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
  color: var(--text-secondary);
  font-weight: 600;
  left: 0;
  position: sticky;
  text-align: left;
  z-index: 1;
}

.sta-table td.is-good {
  color: var(--success-color);
}

.sta-table td.is-bad {
  color: var(--danger-color);
  font-weight: 700;
}

.sta-table td.is-missing {
  color: var(--text-secondary);
  opacity: 0.6;
}

.sta-table tr.is-missing td,
.sta-table tr.is-missing th {
  opacity: 0.5;
}

.sta-missing-cell {
  text-align: center !important;
}

.sta-total-row {
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
}

.sta-total-row th,
.sta-total-row td {
  font-weight: 700;
}

.sta-path-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sta-path-group h4 {
  color: var(--text-primary);
  font-size: 11px;
  margin: 0;
}

.sta-path-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

.sta-path-card header {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sta-path-card header strong {
  color: var(--text-primary);
  font-size: 11px;
}

.sta-path-card header small {
  color: var(--text-secondary);
  font-size: 9px;
}

.sta-path-waterfall {
  display: flex;
  gap: 1px;
  height: 10px;
  overflow: hidden;
}

.sta-path-waterfall span {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 70%, transparent);
  min-width: 2px;
}

.sta-path-waterfall span:nth-child(odd) {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 42%, transparent);
}

.sta-path-stages {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
  padding: 0;
}

.sta-path-stages li {
  color: var(--text-secondary);
  display: grid;
  font-size: 10px;
  gap: 8px;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 64px;
}

.sta-path-stages em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
