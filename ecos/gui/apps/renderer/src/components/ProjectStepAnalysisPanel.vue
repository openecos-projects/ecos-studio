<template>
  <section class="stage-workbench" aria-label="Project Step Analysis">
    <aside class="stage-rail" aria-label="Flow stages">
      <span class="stage-rail-label">Flow Stages</span>
      <div class="stage-rail-list">
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
      </div>
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
          <small>{{ selectedMetrics.length }} step key metrics</small>
        </header>
        <div
          v-if="selectedMetrics.length > 0"
          class="stage-metric-table"
          :style="{ '--workspace-count': String(workspaceMetricColumns.length) }"
        >
          <div class="stage-metric-heading metric">Metric</div>
          <button
            v-for="workspace in workspaceMetricColumns"
            :key="workspace.workspaceId"
            type="button"
            class="stage-workspace-cell stage-workspace-heading"
            :class="{ selected: workspace.workspaceId === selectedWorkspaceId }"
            :title="workspace.workspaceName"
            @click="emit('select-workspace', workspace.workspaceId)"
          >
            {{ workspace.workspaceName }}
          </button>
          <template v-for="row in metricWorkspaceRows" :key="row.metric.id">
            <div class="stage-metric-heading metric" :title="row.metric.hint">
              {{ row.metric.label }}
            </div>
            <button
              v-for="cell in row.cells"
              :key="`${cell.workspaceId}-${row.metric.id}`"
              type="button"
              class="stage-metric-cell"
              :class="cell.point.state"
              :title="metricCellTitle(cell.workspaceName, row.metric, cell.point)"
              @click="emit('select-workspace', cell.workspaceId)"
            >
              <strong>{{ cell.point.label }}</strong>
            </button>
          </template>
        </div>
        <p v-else class="stage-empty">
          No step-specific V3 metrics are available for this stage.
        </p>
      </section>

      <section
        class="stage-detail-surface"
        aria-label="Selected workspace detail summaries"
      >
        <header class="stage-surface-header">
          <span>Selected Workspace Details</span>
          <small>{{ selectedWorkspace?.workspaceName ?? 'No workspace selected' }}</small>
        </header>
        <div v-if="selectedDetails.length > 0" class="stage-detail-list">
          <article
            v-for="detail in selectedDetails"
            :key="detail.id"
            class="stage-detail-view"
          >
            <header>
              <span>{{ detailLabel(detail.presentation) }}</span>
              <small>{{ detail.id }}</small>
            </header>
            <div class="stage-detail-content">
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
                      <th
                        v-for="field in detailFields(detail)"
                        :key="field"
                        :title="fieldLabel(field)"
                      >
                        {{ fieldLabel(field) }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, index) in detailRows(detail)"
                      :key="detailRowKey(detail, row, index)"
                    >
                      <td
                        v-for="field in detailFields(detail)"
                        :key="field"
                        :title="detailValue(row, field)"
                      >
                        {{ detailValue(row, field) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="stage-empty">{{ detailEmptyMessage(detail) }}</p>
            </div>
          </article>
        </div>
        <p v-else class="stage-empty">
          No bounded detail data is available for this stage.
        </p>
      </section>
    </div>

    <aside class="findings-rail" aria-label="Selected step findings">
      <header>
        <span>Findings</span>
        <small>{{ findings.length }}</small>
      </header>
      <ul v-if="findings.length > 0">
        <li v-for="finding in findings" :key="finding.id" :class="finding.severity">
          <button
            type="button"
            class="finding-select"
            @click="emit('select-workspace', finding.workspaceId)"
          >
            <span>{{ finding.workspaceName }}</span>
            <strong>{{ finding.label }}</strong>
            <em>Actual: {{ findingValueLabel(finding) }}</em>
            <small>{{ finding.detail }}</small>
          </button>
          <details class="finding-detail-info">
            <summary>Detail info</summary>
            <dl>
              <div>
                <dt>Type</dt>
                <dd>{{ finding.kind }}</dd>
              </div>
              <div>
                <dt>Metric</dt>
                <dd>{{ finding.metric }}</dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd>{{ findingValueLabel(finding) }}</dd>
              </div>
              <div v-if="finding.expected !== undefined && finding.expected !== null">
                <dt>Expected</dt>
                <dd>{{ findingExpectedLabel(finding) }}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{{ finding.source }}</dd>
              </div>
            </dl>
          </details>
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

interface StageFinding {
  id: string
  workspaceId: string
  workspaceName: string
  severity: 'info' | 'warning' | 'critical'
  kind: string
  label: string
  metric: string
  value: number | string | null
  unit?: string
  expected?: number | string | null
  detail: string
  source: string
}

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
const workspaceMetricColumns = computed(() =>
  props.workspaceSummaries.map((summary) => ({
    workspaceId: summary.workspaceId,
    workspaceName: summary.workspaceName,
    summary,
  })),
)
const metricWorkspaceRows = computed(() =>
  selectedMetrics.value.map((metric) => ({
    metric,
    cells: workspaceMetricColumns.value.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      metric,
      point:
        metric.points.find((point) => point.workspaceId === workspace.workspaceId) ??
        emptyPoint(workspace.summary),
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
const findings = computed<StageFinding[]>(() =>
  props.workspaceSummaries
    .flatMap((summary) => stageFindingsForWorkspace(summary))
    .sort((left, right) => findingSeverityRank(left) - findingSeverityRank(right))
    .slice(0, 24),
)

function stageFindingsForWorkspace(summary: ProjectWorkspaceSummary): StageFinding[] {
  const analysis = summary.analysis.steps[props.selectedStep]
  if (!analysis) return []

  const unitFor = (metric: string) =>
    analysis.metrics.find((item) => item.metricName === metric)?.unit
  const findings: StageFinding[] = []
  const findingsByMetric = new Map<string, StageFinding>()

  if (analysis.flowStatus === 'success') {
    for (const artifact of [
      {
        status: analysis.artifactStatus,
        label: 'QoR metrics artifact',
        source: 'analysis/qor_metrics.json',
      },
      {
        status: analysis.summaryArtifactStatus,
        label: 'QoR summary artifact',
        source: 'analysis/qor_summary.json',
      },
      {
        status: analysis.hotspotArtifactStatus,
        label: 'QoR hotspots artifact',
        source: 'analysis/qor_hotspots.json',
      },
    ]) {
      if (artifact.status === 'available') continue
      findings.push({
        id: `artifact-${summary.workspaceId}-${artifact.source}`,
        workspaceId: summary.workspaceId,
        workspaceName: summary.workspaceName,
        severity: artifact.status === 'invalid' ? 'critical' : 'warning',
        kind: 'Analysis artifact',
        label: artifact.label,
        metric: artifact.source,
        value: artifact.status,
        expected: 'available',
        detail:
          artifact.status === 'invalid'
            ? 'The artifact does not match the current analysis schema.'
            : 'The successful step did not produce this required analysis artifact.',
        source: artifact.source,
      })
    }
  }

  for (const issue of analysis.blockingIssues) {
    const finding: StageFinding = {
      id: `blocking-${summary.workspaceId}-${issue.metric}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: 'critical',
      kind: 'Blocking issue',
      label: issue.displayName,
      metric: issue.metric,
      value: issue.value,
      unit: unitFor(issue.metric),
      detail: issue.reason,
      source: 'analysis/qor_summary.json',
    }
    findings.push(finding)
    findingsByMetric.set(issue.metric, finding)
  }

  for (const gate of analysis.hardGateFailures) {
    const existing = findingsByMetric.get(gate.metric)
    if (existing) {
      existing.kind = `${existing.kind} / failed hard gate`
      existing.expected = gate.threshold
      existing.detail = `${existing.detail} Hard gate ${gate.id} failed.`
      continue
    }
    const finding: StageFinding = {
      id: `hard-gate-${summary.workspaceId}-${gate.id}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: 'critical',
      kind: gate.kind ? `Failed hard gate: ${gate.kind}` : 'Failed hard gate',
      label: titleFromIdentifier(gate.id),
      metric: gate.metric,
      value: gate.actual,
      unit: unitFor(gate.metric),
      expected: gate.threshold,
      detail: `Hard gate ${gate.id} did not meet its required threshold.`,
      source: 'analysis/qor_summary.json',
    }
    findings.push(finding)
    findingsByMetric.set(gate.metric, finding)
  }

  for (const hotspot of analysis.hotspots) {
    if (findingsByMetric.has(hotspot.metric)) continue
    const finding: StageFinding = {
      id: `hotspot-${summary.workspaceId}-${hotspot.metric}-${hotspot.kind}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: hotspot.severity,
      kind: `Hotspot: ${hotspot.kind}`,
      label: hotspot.displayName,
      metric: hotspot.metric,
      value: hotspot.value,
      unit: unitFor(hotspot.metric),
      detail: hotspot.description,
      source: hotspot.sourceFile,
    }
    findings.push(finding)
    findingsByMetric.set(hotspot.metric, finding)
  }

  for (const missingMetric of analysis.missingMetrics) {
    findings.push({
      id: `missing-metric-${summary.workspaceId}-${missingMetric.metricName}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: 'warning',
      kind: 'Required metric unavailable',
      label: missingMetric.metricName,
      metric: missingMetric.metricName,
      value: null,
      detail: missingMetric.reason,
      source: 'analysis/qor_summary.json',
    })
  }

  for (const issue of analysis.integrityIssues) {
    for (const id of issue.invalidMetricSourceIds) {
      findings.push({
        id: `integrity-metric-${summary.workspaceId}-${id}`,
        workspaceId: summary.workspaceId,
        workspaceName: summary.workspaceName,
        severity: 'warning',
        kind: 'Metric provenance',
        label: 'Metric provenance',
        metric: id,
        value: null,
        detail: 'The metric source reference is invalid.',
        source: 'analysis/qor_metrics.json',
      })
    }
    for (const id of issue.invalidDetailIds) {
      findings.push({
        id: `integrity-detail-${summary.workspaceId}-${id}`,
        workspaceId: summary.workspaceId,
        workspaceName: summary.workspaceName,
        severity: 'warning',
        kind: 'Detail provenance',
        label: 'Detail provenance',
        metric: id,
        value: null,
        detail: 'The detail source reference is invalid.',
        source: 'analysis/qor_metrics.json',
      })
    }
  }

  for (const group of summary.analysis.signoffReadiness.groups.filter(
    (item) => item.step === props.selectedStep && item.status !== 'pass',
  )) {
    const reasonCodes = summary.analysis.signoffReadiness.reasonCodes
    findings.push({
      id: `signoff-${summary.workspaceId}-${group.id}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: group.status === 'blocked' ? 'critical' : 'warning',
      kind: group.gate ? 'Required signoff gate' : 'Signoff readiness',
      label: titleFromIdentifier(group.id),
      metric: group.id,
      value: group.status,
      expected: 'pass',
      detail:
        reasonCodes.length > 0
          ? `Signoff readiness reason: ${reasonCodes.join(', ')}.`
          : 'Signoff readiness for this group is not complete.',
      source: 'analysis/qor_summary.json',
    })
  }

  for (const timingIssue of analysis.timingIssues) {
    findings.push({
      id: `timing-${summary.workspaceId}-${timingIssue.issueId}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: timingIssue.severity,
      kind: `Timing path: ${timingIssue.analysisType}`,
      label: `${timingIssue.analysisType.toUpperCase()} ${timingIssue.checkType}`,
      metric: timingIssue.issueId,
      value: timingIssue.slackNs,
      unit: 'ns',
      expected: '>= 0 ns',
      detail: `${timingIssue.corner} · ${timingIssue.pathGroup}.`,
      source: 'analysis/sta_timing_issues.json',
    })
  }

  if (analysis.timingCoverage) {
    findings.push({
      id: `timing-coverage-${summary.workspaceId}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: 'warning',
      kind: 'STA timing coverage',
      label: 'STA timing corners missing',
      metric: 'sta_missing_corner_count',
      value: analysis.timingCoverage.missingCornerCount,
      unit: 'count',
      expected: 0,
      detail: `${analysis.timingCoverage.availableArtifactCount} timing corner artifacts are available.`,
      source: 'analysis/sta_timing_issues.json',
    })
  }

  const hasSummaryEvidence = findings.some(
    (finding) => finding.source === 'analysis/qor_summary.json',
  )
  if (
    analysis.summaryStatus &&
    analysis.summaryStatus !== 'pass' &&
    !hasSummaryEvidence
  ) {
    findings.push({
      id: `summary-status-${summary.workspaceId}-${props.selectedStep}`,
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      severity: analysis.summaryStatus === 'blocked' ? 'critical' : 'warning',
      kind: 'Step analysis status',
      label: `${props.selectedStep} analysis ${analysis.summaryStatus}`,
      metric: 'qor_summary.status',
      value: analysis.summaryStatus,
      expected: 'pass',
      detail: 'The step summary did not report a passing analysis status.',
      source: 'analysis/qor_summary.json',
    })
  }

  return findings
}

function findingSeverityRank(finding: StageFinding): number {
  return { critical: 0, warning: 1, info: 2 }[finding.severity]
}

function findingValueLabel(finding: StageFinding): string {
  return formatFindingScalar(finding.value, finding.unit)
}

function findingExpectedLabel(finding: StageFinding): string {
  return formatFindingScalar(finding.expected ?? null, finding.unit)
}

function formatFindingScalar(value: number | string | null, unit?: string): string {
  if (value === null) return 'Not reported'
  if (typeof value === 'string') return value
  const absolute = Math.abs(value)
  const digits = absolute > 0 && absolute < 0.01 ? 6 : absolute < 1 ? 4 : 3
  const label = String(Number(value.toFixed(digits)))
  return unit ? `${label} ${unit}` : label
}

function titleFromIdentifier(value: string): string {
  return value.replace(/[_-]+/g, ' ')
}

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
  if (detail.presentation === 'cts_clock_skew_table') {
    return [
      {
        clock_count: summary.clock_count,
        worst_optimized_skew_ns: summary.worst_optimized_skew_ns,
        worst_max_insertion_latency_ns: summary.worst_max_insertion_latency_ns,
        target_unmet_count: summary.target_unmet_count,
      },
    ].filter((row) => Object.values(row).some(isDisplayValue))
  }
  if (detail.presentation === 'place_map_summary') {
    return arrayRows(summary.maps).map((row) => ({
      group: row.group,
      metric: row.metric,
      top_5_percent_average: row.top_5_percent_average,
      max: row.max,
      high_bin_ratio: row.high_bin_ratio,
    }))
  }
  if (detail.presentation === 'layer_table') {
    return arrayRows(summary.layers).map((row) => ({
      layer: row.layer,
      dr_wirelength: recordValue(row.dr, 'wirelength'),
      dr_via_count: recordValue(row.dr, 'via_count'),
      la_overflow: recordValue(row.la, 'overflow'),
    }))
  }
  const key = {
    rule_layer_table: 'top_violations',
    rcx_spef_corner_table: 'rc_corners',
    path_group_table: 'records',
  }[detail.presentation]
  const rows = key && Array.isArray(summary[key]) ? summary[key] : []
  return rows.filter(isRecord)
}

function detailFields(detail: ProjectQorDetailDescriptor): string[] {
  const fields = {
    place_map_summary: [
      'group',
      'metric',
      'top_5_percent_average',
      'max',
      'high_bin_ratio',
    ],
    cts_clock_skew_table: [
      'clock_count',
      'worst_optimized_skew_ns',
      'worst_max_insertion_latency_ns',
      'target_unmet_count',
    ],
    layer_table: ['layer', 'dr_wirelength', 'dr_via_count', 'la_overflow'],
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

function detailEmptyMessage(detail: ProjectQorDetailDescriptor): string {
  return detail.presentation === 'rule_layer_table'
    ? 'No DRC violations.'
    : 'No bounded detail rows are available.'
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
  const labels: Record<string, string> = {
    corner_context: 'PVT / RC corner',
    clock_count: 'Clock count',
    worst_optimized_skew_ns: 'Worst skew [ns]',
    worst_max_insertion_latency_ns: 'Worst insertion latency [ns]',
    target_unmet_count: 'Target unmet',
    top_5_percent_average: 'Top 5% average',
    max: 'Maximum',
    high_bin_ratio: 'High-bin ratio',
    dr_wirelength: 'DR wirelength',
    dr_via_count: 'DR via count',
    la_overflow: 'LA overflow',
  }
  if (labels[field]) return labels[field]
  return field.replace(/_/g, ' ')
}

function arrayRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function recordValue(value: unknown, field: string): unknown {
  return isRecord(value) ? value[field] : null
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
  height: 100%;
  min-height: 0;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 36%, transparent);
  overflow: hidden;
}

.stage-rail,
.findings-rail {
  min-width: 0;
  min-height: 0;
  padding: 10px 8px;
  background: color-mix(in srgb, var(--bg-primary) 65%, transparent);
}

.stage-rail {
  display: grid;
  grid-template-rows: 16px minmax(0, 1fr);
  border-right: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

.stage-rail-list {
  display: grid;
  align-content: start;
  min-height: 0;
  gap: 4px;
  overflow-y: auto;
  scrollbar-gutter: stable;
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
  box-sizing: border-box;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  border: 0;
  border-left: 2px solid transparent;
  padding: 6px 6px 6px 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
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
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-rail-item span,
.stage-rail-item i {
  align-self: center;
  overflow: hidden;
  font-size: 10px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-rail-item i {
  grid-column: 2;
  color: var(--warning-color);
}

.stage-main {
  display: grid;
  grid-template-rows: 64px minmax(0, 1.06fr) minmax(0, 0.94fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
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
  box-sizing: border-box;
  height: 64px;
  min-height: 64px;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  overflow: hidden;
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
  grid-template-rows: 28px minmax(0, 1fr);
  min-height: 0;
  padding: 10px 12px;
  gap: 8px;
}

.stage-metric-surface {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

.stage-surface-header {
  box-sizing: border-box;
  height: 28px;
  min-height: 28px;
  margin: 0;
  font-size: 12px;
  font-weight: 760;
  overflow: hidden;
}

.stage-surface-header > span,
.stage-surface-header > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-metric-table {
  display: grid;
  grid-template-columns: minmax(160px, 1.35fr) repeat(
      var(--workspace-count),
      minmax(104px, 1fr)
    );
  min-height: 0;
  min-width: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  border-radius: 6px;
}

.stage-metric-heading,
.stage-workspace-cell,
.stage-metric-cell {
  box-sizing: border-box;
  min-width: 0;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 64%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 64%, transparent);
  padding: 7px 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-metric-heading {
  font-weight: 760;
  text-transform: uppercase;
}

.stage-metric-heading.metric {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-secondary);
}

.stage-workspace-cell,
.stage-metric-cell {
  cursor: pointer;
}

.stage-workspace-heading {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 760;
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
  scrollbar-gutter: stable;
}

.stage-detail-view {
  display: grid;
  grid-template-rows: 28px minmax(0, 1fr);
  box-sizing: border-box;
  height: 176px;
  min-height: 176px;
  max-height: 176px;
  gap: 6px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 66%, transparent);
  padding-top: 6px;
  overflow: hidden;
}

.stage-detail-view header {
  min-width: 0;
  height: 28px;
  min-height: 28px;
  font-size: 11px;
  font-weight: 760;
  overflow: hidden;
}

.stage-detail-view header span,
.stage-detail-view header small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-detail-content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  gap: 6px;
}

.stage-detail-content > .detail-table-wrap:first-child,
.stage-detail-content > .stage-empty:first-child {
  grid-row: 1 / -1;
}

.detail-coverage {
  box-sizing: border-box;
  min-height: 20px;
  max-height: 20px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 10px;
  overflow: hidden;
}

.detail-coverage span,
.detail-coverage strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
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
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  max-height: 32px;
  min-width: 92px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
  padding: 6px 7px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

th {
  color: var(--text-secondary);
  font-weight: 760;
  text-transform: capitalize;
}

.findings-rail {
  display: grid;
  grid-template-rows: 28px minmax(0, 1fr);
  gap: 8px;
  border-left: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  overflow: hidden;
}

.findings-rail header {
  box-sizing: border-box;
  height: 28px;
  min-height: 28px;
  margin: 0;
  font-size: 12px;
  font-weight: 760;
}

.findings-rail ul {
  display: grid;
  align-content: start;
  gap: 6px;
  margin: 0;
  min-height: 0;
  padding: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  list-style: none;
}

.findings-rail > .stage-empty {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.findings-rail li {
  position: relative;
  box-sizing: border-box;
  height: 108px;
  min-height: 108px;
  max-height: 108px;
  border-left: 2px solid var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  overflow: visible;
}

.findings-rail li.critical {
  border-left-color: var(--error-color);
}
.findings-rail li.warning {
  border-left-color: var(--warning-color);
}

.findings-rail .finding-select {
  display: grid;
  grid-template-rows: 12px 14px 13px minmax(0, 1fr);
  width: 100%;
  box-sizing: border-box;
  height: 78px;
  min-height: 78px;
  max-height: 78px;
  gap: 3px;
  border: 0;
  padding: 7px 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
}

.findings-rail .finding-select:hover {
  background: var(--success-bg);
}
.findings-rail .finding-select span {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findings-rail .finding-select strong {
  color: var(--text-primary);
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findings-rail .finding-select em {
  color: var(--warning-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  font-size: 10px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findings-rail li.critical .finding-select em {
  color: var(--error-color);
}
.findings-rail .finding-select small {
  display: -webkit-box;
  overflow: hidden;
  font-size: 10px;
  line-height: 1.25;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.finding-detail-info {
  box-sizing: border-box;
  height: 30px;
  min-height: 30px;
  max-height: 30px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 54%, transparent);
  color: var(--text-secondary);
  font-size: 10px;
  overflow: hidden;
}

.finding-detail-info[open] {
  position: absolute;
  z-index: 2;
  top: 78px;
  right: 0;
  left: 0;
  height: 150px;
  max-height: 150px;
  background: var(--bg-secondary);
  box-shadow: 0 8px 18px color-mix(in srgb, #000 36%, transparent);
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.finding-detail-info summary {
  box-sizing: border-box;
  height: 29px;
  min-height: 29px;
  padding: 6px 8px;
  color: var(--success-color);
  cursor: pointer;
  font-weight: 760;
}

.finding-detail-info dl {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0 8px 8px;
}

.finding-detail-info dl div {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 6px;
}

.finding-detail-info dt {
  color: var(--text-secondary);
}

.finding-detail-info dd {
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
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
