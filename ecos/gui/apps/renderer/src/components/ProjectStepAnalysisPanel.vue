<template>
  <section class="stage-workbench" aria-label="Project Step Analysis">
    <aside class="stage-rail" aria-label="Flow stages">
      <span class="stage-rail-label">Flow Stages</span>
      <button
        v-for="stage in steps"
        :key="stage.step"
        type="button"
        class="stage-rail-item"
        :class="{ selected: stage.step === selectedStep }"
        :aria-pressed="stage.step === selectedStep"
        @click="emit('select-step', stage.step)"
      >
        <strong>{{ stage.step }}</strong>
        <span>{{ stage.successCount }}/{{ stage.configuredCount }}</span>
        <i v-if="stage.missingCount > 0">{{ stage.missingCount }}</i>
      </button>
    </aside>

    <div class="stage-main">
      <header class="stage-header">
        <div>
          <span class="stage-kicker">{{ selectedStep }} Analysis</span>
          <div class="stage-status-row">
            <strong>{{ selectedStage?.successCount ?? 0 }} successful</strong>
            <span>{{ selectedStage?.configuredCount ?? 0 }} configured</span>
            <span :class="{ warning: (selectedStage?.missingCount ?? 0) > 0 }">
              {{ selectedStage?.missingCount ?? 0 }} unavailable
            </span>
            <span v-if="stageCoverage">{{ stageCoverage }}</span>
            <span
              v-if="selectedSignoffStatus"
              class="stage-signoff-status"
              :class="selectedSignoffStatus"
            >
              signoff {{ selectedSignoffStatus }}
            </span>
          </div>
        </div>
        <span class="stage-baseline">Baseline: {{ qorTrendSummary.baselineLabel }}</span>
      </header>

      <section class="stage-metric-surface" aria-label="Selected step V3 metrics">
        <header class="stage-surface-header">
          <span>Workspace Metrics</span>
          <small>{{ selectedMetrics.length }} primary and secondary metrics</small>
        </header>
        <div
          v-if="selectedMetrics.length > 0"
          class="stage-metric-table"
          :style="{ '--metric-count': String(selectedMetrics.length) }"
        >
          <div class="stage-metric-heading workspace">Workspace</div>
          <div
            v-for="metric in selectedMetrics"
            :key="metric.id"
            class="stage-metric-heading"
            :title="metric.hint"
          >
            {{ metric.label }}
          </div>
          <template v-for="row in workspaceMetricRows" :key="row.workspaceId">
            <button
              type="button"
              class="stage-workspace-cell"
              :class="{ selected: row.workspaceId === selectedWorkspaceId }"
              @click="emit('select-workspace', row.workspaceId)"
            >
              {{ row.workspaceName }}
            </button>
            <button
              v-for="cell in row.cells"
              :key="`${row.workspaceId}-${cell.metric.id}`"
              type="button"
              class="stage-metric-cell"
              :class="cell.point.state"
              :title="metricCellTitle(row.workspaceName, cell.metric, cell.point)"
              @click="emit('select-workspace', row.workspaceId)"
            >
              <strong>{{ cell.point.label }}</strong>
            </button>
          </template>
        </div>
        <p v-else class="stage-empty">No V3 metrics are available for this stage.</p>
      </section>

      <section
        v-if="selectedDetails.length > 0"
        class="stage-detail-surface"
        aria-label="Selected workspace detail summaries"
      >
        <header class="stage-surface-header">
          <span>Selected Workspace Details</span>
          <small>{{ selectedWorkspace?.workspaceName ?? 'No workspace selected' }}</small>
        </header>
        <div class="stage-detail-list">
          <article
            v-for="detail in selectedDetails"
            :key="detail.id"
            class="stage-detail-view"
          >
            <header>
              <span>{{ detailLabel(detail.presentation) }}</span>
              <small>{{ detail.id }}</small>
            </header>
            <div v-if="detailCoverage(detail)" class="detail-coverage">
              <span
                >{{ detailCoverage(detail)?.available }}/{{
                  detailCoverage(detail)?.expected
                }}
                corners</span
              >
              <strong :class="detailCoverage(detail)?.status">{{
                detailCoverage(detail)?.status
              }}</strong>
            </div>
            <div v-if="detailRows(detail).length > 0" class="detail-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th v-for="field in detailFields(detail)" :key="field">
                      {{ fieldLabel(field) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, index) in detailRows(detail)"
                    :key="detailRowKey(detail, row, index)"
                  >
                    <td v-for="field in detailFields(detail)" :key="field">
                      {{ detailValue(row, field) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="stage-empty">No bounded detail rows are available.</p>
          </article>
        </div>
      </section>
    </div>

    <aside class="findings-rail" aria-label="Selected step findings">
      <header>
        <span>Findings</span>
        <small>{{ findings.length }}</small>
      </header>
      <ul v-if="findings.length > 0">
        <li v-for="finding in findings" :key="finding.id" :class="finding.severity">
          <button type="button" @click="emit('select-workspace', finding.workspaceId)">
            <span>{{ finding.workspaceName }}</span>
            <strong>{{ finding.label }}</strong>
            <small>{{ finding.detail }}</small>
          </button>
        </li>
      </ul>
      <p v-else class="stage-empty">No blocking issues or hotspots.</p>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  FlowStep,
  ProjectMetricPoint,
  ProjectStepCompareMetric,
  ProjectStepCompareSummary,
  ProjectWorkspaceSummary,
} from '@/utils/projectManagement'
import type {
  ProjectQorDetailDescriptor,
  ProjectQorTrendSummary,
} from '@/utils/projectQorTrend'

const props = defineProps<{
  steps: ProjectStepCompareSummary[]
  workspaceSummaries: ProjectWorkspaceSummary[]
  qorTrendSummary: ProjectQorTrendSummary
  selectedStep: FlowStep
  selectedWorkspaceId: string
}>()

const emit = defineEmits<{
  'select-step': [step: FlowStep]
  'select-workspace': [workspaceId: string]
}>()

const selectedStage = computed(
  () => props.steps.find((stage) => stage.step === props.selectedStep) ?? null,
)
const selectedMetrics = computed<ProjectStepCompareMetric[]>(
  () => selectedStage.value?.metrics ?? [],
)
const workspaceMetricRows = computed(() =>
  props.workspaceSummaries.map((summary) => ({
    workspaceId: summary.workspaceId,
    workspaceName: summary.workspaceName,
    cells: selectedMetrics.value.map((metric) => ({
      metric,
      point:
        metric.points.find((point) => point.workspaceId === summary.workspaceId) ??
        emptyPoint(summary),
    })),
  })),
)
const selectedWorkspace = computed(
  () =>
    props.workspaceSummaries.find(
      (summary) => summary.workspaceId === props.selectedWorkspaceId,
    ) ??
    props.workspaceSummaries[0] ??
    null,
)
const selectedDetails = computed(
  () => selectedWorkspace.value?.analysis.steps[props.selectedStep]?.details ?? [],
)
const stageCoverage = computed(() => {
  const metrics =
    selectedWorkspace.value?.analysis.steps[props.selectedStep]?.metrics ?? []
  const prefix =
    props.selectedStep === 'RCX' ? 'rcx_' : props.selectedStep === 'STA' ? 'sta_' : null
  if (!prefix) return null
  const available =
    metrics.find((metric) => metric.metricName === `${prefix}corner_count`) ??
    metrics.find((metric) => metric.metricName === `${prefix}spef_file_count`)
  const expected = metrics.find(
    (metric) => metric.metricName === `${prefix}expected_corner_count`,
  )
  if (
    available?.value === null ||
    available?.value === undefined ||
    expected?.value === null ||
    expected?.value === undefined
  ) {
    return null
  }
  return `${available.value}/${expected.value} corners`
})
const selectedSignoffStatus = computed(() => {
  if (props.selectedStep !== 'RCX' && props.selectedStep !== 'STA') return null
  const groups = selectedWorkspace.value?.analysis.signoffReadiness.groups ?? []
  const statuses = groups
    .filter((group) => group.step === props.selectedStep)
    .map((group) => group.status)
  if (statuses.length === 0) return null
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('incomplete')) return 'incomplete'
  if (statuses.every((status) => status === 'pass')) return 'pass'
  return 'unavailable'
})
const findings = computed(() =>
  props.workspaceSummaries
    .flatMap((summary) => {
      const analysis = summary.analysis.steps[props.selectedStep]
      if (!analysis) return []
      return [
        ...analysis.blockingIssues.map((issue) => ({
          id: `blocking-${summary.workspaceId}-${issue.metric}`,
          workspaceId: summary.workspaceId,
          workspaceName: summary.workspaceName,
          severity: 'critical' as const,
          label: issue.displayName,
          detail: issue.reason,
        })),
        ...analysis.hotspots.map((hotspot) => ({
          id: `hotspot-${summary.workspaceId}-${hotspot.metric}-${hotspot.kind}`,
          workspaceId: summary.workspaceId,
          workspaceName: summary.workspaceName,
          severity: hotspot.severity,
          label: hotspot.displayName,
          detail: hotspot.description,
        })),
        ...analysis.integrityIssues.flatMap((issue) => [
          ...issue.invalidMetricSourceIds.map((id) => ({
            id: `integrity-metric-${summary.workspaceId}-${id}`,
            workspaceId: summary.workspaceId,
            workspaceName: summary.workspaceName,
            severity: 'warning' as const,
            label: 'Metric provenance',
            detail: id,
          })),
          ...issue.invalidDetailIds.map((id) => ({
            id: `integrity-detail-${summary.workspaceId}-${id}`,
            workspaceId: summary.workspaceId,
            workspaceName: summary.workspaceName,
            severity: 'warning' as const,
            label: 'Detail provenance',
            detail: id,
          })),
        ]),
      ]
    })
    .slice(0, 24),
)

function emptyPoint(summary: ProjectWorkspaceSummary): ProjectMetricPoint {
  return {
    workspaceId: summary.workspaceId,
    workspaceName: summary.workspaceName,
    label: 'N/A',
    value: null,
    state: 'pending',
  }
}

function metricCellTitle(
  workspaceName: string,
  metric: ProjectStepCompareMetric,
  point: ProjectMetricPoint,
): string {
  return `${workspaceName} ${metric.label}: ${point.label}`
}

function detailLabel(presentation: string): string {
  return (
    {
      place_map_summary: 'Placement Maps',
      cts_clock_skew_table: 'Clock Timing Quality',
      layer_table: 'Route Layers',
      rule_layer_table: 'DRC Rule / Layer',
      rcx_spef_corner_table: 'RCX Corners',
      path_group_table: 'STA Path Groups',
    }[presentation] ?? presentation
  )
}

function detailRows(detail: ProjectQorDetailDescriptor): Record<string, unknown>[] {
  const summary = detail.summary
  const key = {
    place_map_summary: 'maps',
    cts_clock_skew_table: 'clocks',
    layer_table: 'layers',
    rule_layer_table: 'top_violations',
    rcx_spef_corner_table: 'rc_corners',
    path_group_table: 'records',
  }[detail.presentation]
  const rows = key && Array.isArray(summary[key]) ? summary[key] : []
  return rows.filter(isRecord)
}

function detailFields(detail: ProjectQorDetailDescriptor): string[] {
  const fields = {
    place_map_summary: ['group', 'metric', 'mean', 'maximum'],
    cts_clock_skew_table: [
      'clock',
      'sink_count',
      'optimized_skew_ns',
      'max_insertion_latency_ns',
    ],
    layer_table: ['layer', 'wire_length', 'via_count', 'overflow'],
    rule_layer_table: ['display_name', 'value', 'unit'],
    rcx_spef_corner_table: [
      'rc_corner',
      'availability',
      'total_capacitance_ff',
      'coupling_capacitance_ff',
      'total_resistance_ohm',
    ],
    path_group_table: ['corner_context', 'path_group', 'setup', 'hold'],
  }[detail.presentation]
  return fields ?? Object.keys(detailRows(detail)[0] ?? {}).slice(0, 5)
}

function detailCoverage(detail: ProjectQorDetailDescriptor): {
  status: string
  expected: number | string
  available: number | string
} | null {
  const coverage = isRecord(detail.summary.coverage) ? detail.summary.coverage : null
  if (!coverage) return null
  const status = stringValue(coverage.status)
  const expected = coverage.expected_count
  const available = coverage.available_count
  if (!status || !isDisplayValue(expected) || !isDisplayValue(available)) return null
  return { status, expected, available }
}

function detailValue(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (isRecord(value)) {
    const label = stringValue(value.label)
    if (label) return label
    const wns = value.worst_wns ?? value.wns
    const tns = value.worst_tns ?? value.tns
    return [wns, tns].filter(isDisplayValue).join(' / ') || 'N/A'
  }
  return isDisplayValue(value) ? String(value) : 'N/A'
}

function detailRowKey(
  detail: ProjectQorDetailDescriptor,
  row: Record<string, unknown>,
  index: number,
): string {
  const id =
    row.rc_corner ??
    row.path_group ??
    row.layer ??
    row.metric ??
    row.display_name ??
    index
  return `${detail.id}-${String(id)}`
}

function fieldLabel(field: string): string {
  if (field === 'corner_context') return 'PVT / RC corner'
  return field.replace(/_/g, ' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isDisplayValue(value: unknown): value is string | number {
  return (
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
  )
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
</script>

<style scoped>
.stage-workbench {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr) minmax(176px, 0.28fr);
  min-height: 0;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 36%, transparent);
  overflow: hidden;
}

.stage-rail,
.findings-rail {
  min-width: 0;
  padding: 10px 8px;
  background: color-mix(in srgb, var(--bg-primary) 65%, transparent);
}

.stage-rail {
  display: grid;
  align-content: start;
  gap: 4px;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

.stage-rail-label,
.stage-kicker,
.stage-surface-header small,
.findings-rail header small,
.stage-detail-view header small {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 760;
  text-transform: uppercase;
}

.stage-rail-item {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 6px;
  min-height: 36px;
  border: 0;
  border-left: 2px solid transparent;
  padding: 6px 6px 6px 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.stage-rail-item:hover,
.stage-rail-item.selected {
  color: var(--text-primary);
  background: var(--success-bg);
}

.stage-rail-item.selected {
  border-left-color: var(--success-color);
}

.stage-rail-item strong {
  font-size: 11px;
}

.stage-rail-item span,
.stage-rail-item i {
  align-self: center;
  font-size: 10px;
  font-style: normal;
}

.stage-rail-item i {
  grid-column: 2;
  color: var(--warning-color);
}

.stage-main {
  display: grid;
  grid-template-rows: auto minmax(170px, 0.85fr) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.stage-header,
.stage-surface-header,
.stage-detail-view header,
.findings-rail header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stage-header {
  min-height: 58px;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

.stage-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}

.stage-status-row strong {
  color: var(--text-primary);
}

.stage-status-row .warning {
  color: var(--warning-color);
}

.stage-signoff-status {
  font-weight: 760;
  text-transform: uppercase;
}

.stage-signoff-status.pass {
  color: var(--success-color);
}
.stage-signoff-status.blocked {
  color: var(--error-color);
}
.stage-signoff-status.incomplete,
.stage-signoff-status.unavailable {
  color: var(--warning-color);
}

.stage-baseline {
  color: var(--warning-color);
  font-size: 11px;
  white-space: nowrap;
}

.stage-metric-surface,
.stage-detail-surface {
  display: grid;
  min-height: 0;
  padding: 10px 12px;
}

.stage-metric-surface {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

.stage-surface-header {
  min-height: 20px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 760;
}

.stage-metric-table {
  display: grid;
  grid-template-columns: minmax(116px, 0.8fr) repeat(
      var(--metric-count),
      minmax(92px, 1fr)
    );
  min-height: 0;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  border-radius: 6px;
}

.stage-metric-heading,
.stage-workspace-cell,
.stage-metric-cell {
  min-width: 0;
  min-height: 36px;
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 64%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 64%, transparent);
  padding: 7px 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  text-align: left;
}

.stage-metric-heading {
  font-weight: 760;
  text-transform: uppercase;
}

.stage-workspace-cell,
.stage-metric-cell {
  cursor: pointer;
}

.stage-workspace-cell:hover,
.stage-workspace-cell.selected,
.stage-metric-cell:hover {
  background: color-mix(in srgb, var(--success-bg) 72%, transparent);
}

.stage-workspace-cell.selected {
  color: var(--success-color);
}

.stage-metric-cell strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-metric-cell.bad strong {
  color: var(--error-color);
}
.stage-metric-cell.warn strong {
  color: var(--warning-color);
}
.stage-metric-cell.good strong {
  color: var(--success-color);
}

.stage-detail-list {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.stage-detail-view {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 66%, transparent);
  padding-top: 8px;
}

.stage-detail-view header {
  font-size: 11px;
  font-weight: 760;
}

.detail-coverage {
  display: flex;
  justify-content: space-between;
  margin: 6px 0;
  color: var(--text-secondary);
  font-size: 10px;
}

.detail-coverage strong.pass {
  color: var(--success-color);
}
.detail-coverage strong.blocked {
  color: var(--error-color);
}
.detail-coverage strong.incomplete,
.detail-coverage strong.unavailable {
  color: var(--warning-color);
}

.detail-table-wrap {
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 6px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}

th,
td {
  min-width: 92px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
  padding: 6px 7px;
  text-align: left;
  white-space: nowrap;
}

th {
  color: var(--text-secondary);
  font-weight: 760;
  text-transform: capitalize;
}

.findings-rail {
  border-left: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

.findings-rail header {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 760;
}

.findings-rail ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.findings-rail li {
  border-left: 2px solid var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
}

.findings-rail li.critical {
  border-left-color: var(--error-color);
}
.findings-rail li.warning {
  border-left-color: var(--warning-color);
}

.findings-rail button {
  display: grid;
  width: 100%;
  gap: 3px;
  border: 0;
  padding: 7px 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.findings-rail button:hover {
  background: var(--success-bg);
}
.findings-rail button span {
  font-size: 10px;
}
.findings-rail button strong {
  color: var(--text-primary);
  font-size: 11px;
}
.findings-rail button small {
  font-size: 10px;
  line-height: 1.25;
}

.stage-empty {
  align-self: center;
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 1080px) {
  .stage-workbench {
    grid-template-columns: 94px minmax(0, 1fr);
  }
  .findings-rail {
    grid-column: 1 / -1;
    border-top: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
    border-left: 0;
  }
}
</style>
