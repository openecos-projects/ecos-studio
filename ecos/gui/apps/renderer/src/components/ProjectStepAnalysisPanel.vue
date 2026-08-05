<template>
  <section class="step-analysis" aria-label="Step analysis">
    <nav class="step-rail" aria-label="Flow steps">
      <button
        v-for="tab in stepTabs"
        :key="tab.step"
        type="button"
        class="step-rail-item"
        :class="{
          selected: tab.step === selectedStep,
          muted: tab.analysisAvailability === 'unavailable',
        }"
        :aria-pressed="tab.step === selectedStep"
        :title="stepTabTitle(tab)"
        @click="emit('select-step', tab.step)"
      >
        <span class="step-rail-name">{{ tab.step }}</span>
        <span class="step-rail-mark" :class="stepTabTone(tab)" aria-hidden="true">
          {{ stepTabBadge(tab) }}
        </span>
      </button>
    </nav>

    <div class="verdict-bar">
      <div class="workspace-picker" role="group" aria-label="Workspace">
        <button
          type="button"
          class="workspace-cycle"
          :disabled="!canSelectPreviousWorkspace"
          title="Previous workspace"
          aria-label="Previous workspace"
          @click="moveActiveWorkspace(-1)"
        >
          <i class="ri-arrow-left-s-line" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="workspace-selector"
          :aria-expanded="workspacePickerOpen"
          aria-controls="workspace-picker-list"
          aria-haspopup="listbox"
          :title="
            activeWorkspaceChip
              ? workspaceChipTitle(activeWorkspaceChip)
              : 'Select workspace'
          "
          @click="workspacePickerOpen = !workspacePickerOpen"
        >
          <small>Workspace</small>
          <span class="workspace-selector-value">
            <i
              class="status-dot"
              :class="activeWorkspaceChip?.tone"
              aria-hidden="true"
            ></i>
            <strong>{{ activeWorkspaceChip?.workspaceName ?? 'No workspace' }}</strong>
            <em
              v-if="activeWorkspaceChip && activeWorkspaceChip.findingCount > 0"
              class="chip-count"
              :class="activeWorkspaceChip.blockingCount > 0 ? 'bad' : 'neutral'"
            >
              {{ activeWorkspaceChip.findingCount }}
            </em>
            <small v-if="activeWorkspaceChip?.isBaseline" class="chip-role">base</small>
            <small v-if="activeWorkspaceChip?.isBest" class="chip-role accent"
              >best</small
            >
          </span>
          <i
            class="workspace-selector-chevron"
            :class="workspacePickerOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"
            aria-hidden="true"
          ></i>
        </button>
        <button
          type="button"
          class="workspace-cycle"
          :disabled="!canSelectNextWorkspace"
          title="Next workspace"
          aria-label="Next workspace"
          @click="moveActiveWorkspace(1)"
        >
          <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
        </button>
        <small class="workspace-picker-total"
          >{{ workspaceChips.length }} workspaces</small
        >

        <div
          v-if="workspacePickerOpen"
          id="workspace-picker-list"
          class="workspace-picker-popover"
          @keydown.esc="workspacePickerOpen = false"
        >
          <label class="workspace-picker-search">
            <i class="ri-search-line" aria-hidden="true"></i>
            <input
              v-model="workspacePickerQuery"
              type="search"
              placeholder="Search workspace"
              aria-label="Search workspaces"
            />
          </label>
          <ul v-if="visibleWorkspacePickerOptions.length > 0" role="listbox">
            <li v-for="chip in visibleWorkspacePickerOptions" :key="chip.workspaceId">
              <button
                type="button"
                role="option"
                class="workspace-picker-option"
                :class="{ selected: chip.workspaceId === activeWorkspaceId }"
                :aria-selected="chip.workspaceId === activeWorkspaceId"
                :title="workspaceChipTitle(chip)"
                @click="selectWorkspaceFromPicker(chip.workspaceId)"
              >
                <i class="status-dot" :class="chip.tone" aria-hidden="true"></i>
                <span class="workspace-picker-option-name">{{ chip.workspaceName }}</span>
                <span class="workspace-picker-option-status">{{ chip.statusLabel }}</span>
                <em
                  v-if="chip.findingCount > 0"
                  class="chip-count"
                  :class="chip.blockingCount > 0 ? 'bad' : 'neutral'"
                >
                  {{ chip.findingCount }}
                </em>
                <small v-if="chip.isBaseline" class="chip-role">base</small>
                <small v-if="chip.isBest" class="chip-role accent">best</small>
              </button>
            </li>
          </ul>
          <p v-else class="workspace-picker-empty">No matching workspace.</p>
          <button
            v-if="canToggleWorkspacePickerPreview"
            type="button"
            class="workspace-picker-preview-toggle"
            :aria-expanded="workspacePickerShowsAll"
            @click="workspacePickerShowsAll = !workspacePickerShowsAll"
          >
            {{
              workspacePickerShowsAll
                ? 'Show fewer'
                : `Show all ${workspacePickerOptions.length}`
            }}
          </button>
        </div>
      </div>

      <div class="verdict" aria-label="Step verdict">
        <span v-if="verdict.status" class="verdict-badge" :class="verdict.status">
          {{ verdict.label }}
        </span>
        <span class="verdict-summary">{{ verdict.summary }}</span>
        <span v-for="fact in verdict.facts" :key="fact.label" class="verdict-fact">
          <small>{{ fact.label }}</small>
          <strong :class="fact.tone">{{ fact.value }}</strong>
        </span>
      </div>
    </div>

    <div class="mode-bar" role="tablist" aria-label="Step analysis view">
      <button
        v-for="option in modeOptions"
        :key="option.id"
        type="button"
        role="tab"
        class="mode-tab"
        :class="{ selected: mode === option.id }"
        :aria-selected="mode === option.id"
        @click="mode = option.id"
      >
        {{ option.label }}
        <em v-if="option.count !== null" :class="option.tone">{{ option.count }}</em>
      </button>
      <small class="mode-hint">{{ modeHint }}</small>
    </div>

    <div v-if="mode === 'findings'" class="step-body">
      <section class="issue-pane" aria-label="Issues">
        <header class="pane-header">
          <span class="pane-title">Issues</span>
          <div class="severity-filters" aria-label="Filter issues by finding channel">
            <button
              v-for="filter in issueFilters"
              :key="filter.id"
              type="button"
              :class="{ selected: issueFilter === filter.id }"
              :aria-pressed="issueFilter === filter.id"
              @click="issueFilter = filter.id"
            >
              {{ filter.label }} {{ filter.count }}
            </button>
          </div>
        </header>

        <ul v-if="filteredIssues.length > 0" class="issue-list">
          <li v-for="issue in filteredIssues" :key="issue.id">
            <button
              type="button"
              class="issue-item"
              :class="[
                issue.severity,
                { blocking: issue.blocking, selected: issue.id === selectedIssue?.id },
              ]"
              :aria-current="issue.id === selectedIssue?.id ? 'true' : undefined"
              :title="issueRowTitle(issue)"
              @click="selectedIssueId = issue.id"
            >
              <span class="issue-kind">{{ issue.kind }}</span>
              <strong class="issue-title">{{ issue.title }}</strong>
              <code class="issue-actual">{{ issue.actual }}</code>
            </button>
          </li>
        </ul>
        <p v-else class="pane-empty">{{ issueEmptyMessage }}</p>
      </section>

      <section class="evidence-pane" aria-label="Evidence">
        <article
          v-if="evidenceIssue"
          class="evidence-card"
          :class="[evidenceIssue.severity, { blocking: evidenceIssue.blocking }]"
        >
          <header>
            <strong class="evidence-kind">{{ evidenceIssue.kind }}</strong>
            <span v-if="evidenceIssue.blocking" class="evidence-flag">blocking</span>
            <span v-if="evidenceIssue.severity" class="evidence-severity">
              {{ evidenceIssue.severity }}
            </span>
          </header>
          <dl class="evidence-facts">
            <div>
              <dt>Actual</dt>
              <dd class="mono strong">{{ evidenceIssue.actual }}</dd>
            </div>
            <div v-if="evidenceIssue.expected">
              <dt>Expected</dt>
              <dd class="mono">{{ evidenceIssue.expected }}</dd>
            </div>
            <div v-if="evidenceIssue.condition">
              <dt>Pass condition</dt>
              <dd class="mono">{{ evidenceIssue.condition }}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd class="mono">
                {{ evidenceIssue.location ?? evidenceIssue.source }}
                <span v-if="evidenceMetricId(evidenceIssue)" class="evidence-metric-id">
                  {{ evidenceMetricId(evidenceIssue) }}
                </span>
              </dd>
            </div>
            <div v-if="evidenceIssue.diagnosis" class="evidence-diagnosis">
              <dt>Diagnosis</dt>
              <dd>{{ evidenceIssue.diagnosis }}</dd>
            </div>
          </dl>
        </article>
        <p v-else-if="!selectedIssue" class="pane-empty">{{ evidenceEmptyMessage }}</p>

        <section class="evidence-block" aria-label="Step metrics">
          <header class="pane-header">
            <span class="pane-title">Metrics</span>
            <small>{{ metricsCaption }}</small>
          </header>
          <div v-if="metricGroups.length > 0" class="metric-groups">
            <div v-for="group in metricGroups" :key="group.id" class="metric-group">
              <span class="metric-group-label">{{ group.label }}</span>
              <div
                v-for="row in group.rows"
                :key="row.id"
                class="metric-row"
                :class="{ highlighted: row.id === selectedIssue?.metric }"
                :title="metricRowTitle(row)"
              >
                <span class="metric-name">{{ row.label }}</span>
                <span class="metric-value mono">{{ row.value }}</span>
                <span v-if="row.delta" class="metric-delta" :class="row.deltaTone">
                  {{ row.delta }}
                  <em v-if="row.deltaPercent">{{ row.deltaPercent }}</em>
                </span>
                <span v-else-if="row.deltaNote" class="metric-delta compare-note">
                  {{ row.deltaNote }}
                </span>
              </div>
            </div>
          </div>
          <p v-else class="pane-empty">
            No V3 metrics were reported for {{ selectedStep }} in this workspace.
          </p>
        </section>

        <section
          v-for="table in detailTables"
          :key="table.id"
          class="evidence-block"
          :aria-label="table.title"
        >
          <header class="pane-header">
            <span class="pane-title">{{ table.title }}</span>
            <small v-if="table.coverage" :class="table.coverage.tone">
              {{ table.coverage.label }} · {{ table.coverage.status }}
            </small>
            <small
              v-else
              :class="detailSourceTone(table.sourceStatus)"
              :title="`${table.sourceFile}: ${table.sourceStatus}`"
            >
              {{ detailSourceLabel(table.sourceFile, table.sourceStatus) }}
            </small>
          </header>
          <div v-if="table.rows.length > 0" class="detail-table-wrap">
            <table>
              <thead>
                <tr>
                  <th v-for="column in table.columns" :key="column">{{ column }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in table.rows" :key="`${table.id}-${index}`">
                  <td v-for="(cell, cellIndex) in row" :key="cellIndex" :title="cell">
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="pane-empty pane-empty-detail">
            <span>{{ table.emptyMessage }}</span>
            <small v-if="table.emptyDetail">{{ table.emptyDetail }}</small>
          </p>
        </section>
      </section>
    </div>

    <section v-else class="compare-view" aria-label="Cross-workspace comparison">
      <header class="compare-summary">
        <div class="compare-summary-head">
          <span class="pane-title">{{ selectedStep }} across workspaces</span>
          <small class="compare-caption">{{ compareCaption }}</small>
          <span
            v-if="activeCompareVerdict"
            class="verdict-card"
            :class="{ baseline: activeCompareVerdict.isBaseline }"
            :title="`${activeCompareVerdict.workspaceName} · ${activeCompareVerdict.summary}`"
          >
            <span class="verdict-card-head">
              <strong>{{
                abbreviateWorkspaceName(activeCompareVerdict.workspaceName)
              }}</strong>
              <small v-if="activeCompareVerdict.isBaseline" class="chip-role">base</small>
              <small v-if="activeCompareVerdict.isBest" class="chip-role accent"
                >best</small
              >
            </span>
            <span
              v-if="activeCompareVerdict.segments.length > 0"
              class="win-bar"
              aria-hidden="true"
            >
              <i
                v-for="segment in activeCompareVerdict.segments"
                :key="segment.outcome"
                :class="segment.tone"
                :style="{ width: `${segment.percent}%` }"
              ></i>
            </span>
            <small class="verdict-card-summary">{{ activeCompareVerdict.summary }}</small>
          </span>
          <small v-else class="compare-no-baseline">
            No baseline workspace is set, so no value here can be read as better or worse.
          </small>
        </div>

        <div class="compare-controls">
          <div
            class="compare-column-filters"
            role="group"
            aria-label="Which workspaces to compare"
          >
            <button
              v-for="option in columnFilterOptions"
              :key="option.id"
              type="button"
              :class="{ selected: option.id === columnFilter }"
              :aria-pressed="option.id === columnFilter"
              :disabled="option.disabled"
              :title="option.title"
              @click="columnFilter = option.id"
            >
              {{ option.label }}
              <em>{{ option.count }}</em>
            </button>
          </div>

          <label class="compare-column-search">
            <i class="ri-search-line" aria-hidden="true"></i>
            <input
              v-model="columnQuery"
              type="search"
              placeholder="Filter workspaces"
              aria-label="Filter comparison columns by workspace name"
            />
          </label>

          <button
            v-if="canFilterDiffering"
            type="button"
            class="differ-toggle"
            :class="{ selected: onlyDiffering }"
            :aria-pressed="onlyDiffering"
            @click="onlyDiffering = !onlyDiffering"
          >
            Only differing {{ compareMatrix.differingCount }}
          </button>
          <button
            v-if="compareScopeIsNarrowed"
            type="button"
            class="scope-reset"
            title="Show every workspace again, in the project's own order"
            @click="resetCompareScope"
          >
            Reset
          </button>
          <small class="compare-column-count">{{ compareColumnCount }}</small>
        </div>
      </header>

      <div class="compare-scroll">
        <div
          v-if="compareGroups.length > 0"
          class="compare-table"
          role="grid"
          :aria-colcount="compareMatrix.columns.length + 1"
          :aria-rowcount="compareVisibleRowCount + compareGroups.length + 1"
        >
          <div class="compare-row" role="row" :style="compareGridStyle">
            <div role="columnheader" class="compare-corner">Metric</div>
            <div
              v-for="column in compareMatrix.columns"
              :key="column.workspaceId"
              role="columnheader"
              class="compare-head"
              :class="{
                selected: column.workspaceId === activeWorkspaceId,
                pinned: column.isBaseline,
              }"
            >
              <button
                type="button"
                :title="compareColumnTitle(column)"
                @click="emit('select-workspace', column.workspaceId)"
              >
                <span class="compare-head-name">
                  {{ abbreviateWorkspaceName(column.workspaceName) }}
                </span>
                <small v-if="column.isBaseline">base</small>
                <small v-else-if="column.isBest" class="accent">best</small>
              </button>
            </div>
          </div>
          <template v-for="group in compareGroups" :key="group.id">
            <div class="compare-group" role="row">
              <div role="rowheader">{{ group.label }}</div>
            </div>
            <div
              v-for="row in group.rows"
              :key="row.id"
              class="compare-row"
              role="row"
              :style="compareGridStyle"
            >
              <div
                role="rowheader"
                class="compare-metric"
                :class="{ ranked: compareSort?.metricName === row.id }"
              >
                <button
                  type="button"
                  :title="compareRankTitle(row)"
                  @click="cycleCompareRank(row)"
                >
                  <strong>{{ row.label }}</strong>
                  <small>{{ row.descriptor }}</small>
                  <i
                    v-if="compareSort?.metricName === row.id"
                    class="compare-rank-mark"
                    :class="
                      compareSort?.direction === 'leading'
                        ? 'ri-sort-desc'
                        : 'ri-sort-asc'
                    "
                    aria-hidden="true"
                  ></i>
                </button>
              </div>
              <div
                v-for="cell in row.cells"
                :key="`${row.id}-${cell.workspaceId}`"
                role="gridcell"
                class="compare-cell"
                :class="{
                  selected: cell.workspaceId === activeWorkspaceId,
                  pinned: cell.workspaceId === compareBaselineColumnId,
                  unreported: cell.availability === 'not-reported',
                  'not-applicable': cell.availability === 'not-applicable',
                  leads: cell.leads,
                }"
              >
                <button
                  type="button"
                  :title="compareCellTitle(row, cell)"
                  @click="emit('select-workspace', cell.workspaceId)"
                >
                  <span class="compare-value">
                    <strong>{{ cell.value }}</strong>
                    <small v-if="cell.leads" class="lead-flag">best</small>
                  </span>
                  <small v-if="cell.delta" class="compare-delta" :class="cell.deltaTone">
                    {{ cell.delta }}
                    <em v-if="cell.deltaPercent">{{ cell.deltaPercent }}</em>
                  </small>
                  <small v-else-if="cell.deltaNote" class="compare-delta compare-note">
                    {{ cell.deltaNote }}
                  </small>
                  <span
                    v-if="cell.barRatio !== null"
                    class="delta-bar"
                    aria-hidden="true"
                  >
                    <i
                      class="delta-bar-fill"
                      :class="cell.deltaTone"
                      :style="deltaBarStyle(cell)"
                    ></i>
                  </span>
                </button>
              </div>
            </div>
          </template>
        </div>
        <p v-else class="pane-empty">{{ compareEmptyMessage }}</p>
      </div>

      <footer class="compare-legend">
        <span><i class="legend-swatch good"></i>Better than the baseline</span>
        <span><i class="legend-swatch bad"></i>Worse</span>
        <span>
          <i class="legend-swatch neutral"></i>
          No reported direction, so the bar shows only which way the value moved
        </span>
        <span>Full bar = {{ barFullScalePercent }}% change or more</span>
        <span class="compare-legend-hint">Click a metric to rank the columns by it</span>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  abbreviateWorkspaceName,
  buildStepCompareCandidates,
  buildStepCompareMatrix,
  buildStepDetailTables,
  buildStepIssueFilters,
  buildStepIssues,
  buildStepMetricGroups,
  buildStepTabs,
  buildStepVerdict,
  buildStepWorkspaceChips,
  COMPARE_BAR_FULL_SCALE_PERCENT,
  countStepIssues,
  filterStepCompareGroups,
  hasStepIssueEvidence,
  matchesStepIssueFilter,
  type StepCompareCell,
  type StepCompareColumn,
  type StepCompareRow,
  type StepIssue,
  type StepMetricRow,
  type StepTab,
  type StepWorkspaceChip,
} from './projectStepAnalysis'
import {
  STEP_COMPARE_COLUMN_FILTERS,
  buildStepComparisonScope,
  type StepCompareColumnFilterId,
  type StepCompareSort,
} from './projectStepComparisonScope'
import type {
  FlowStep,
  ProjectStepCompareSummary,
  ProjectWorkspaceSummary,
} from '@/utils/projectManagement'
import type { ProjectQorTrendSummary } from '@/utils/projectQorTrend'

const props = defineProps<{
  steps: ProjectStepCompareSummary[]
  workspaceSummaries: ProjectWorkspaceSummary[]
  qorTrendSummary: ProjectQorTrendSummary
  projectName: string
  projectObjective: string
  bestWorkspaceId: string
  bestWorkspaceReason?: string
  selectedStep: FlowStep
  selectedWorkspaceId: string
  selectedIssueMetric?: string | null
}>()

const emit = defineEmits<{
  'select-step': [step: FlowStep]
  'select-workspace': [workspaceId: string]
}>()

type StepAnalysisMode = 'findings' | 'compare'

const issueFilter = ref('all')
const selectedIssueId = ref<string | null>(null)
const mode = ref<StepAnalysisMode>('findings')
const onlyDiffering = ref(false)
const workspacePickerOpen = ref(false)
const workspacePickerQuery = ref('')
const workspacePickerShowsAll = ref(false)
const columnFilter = ref<StepCompareColumnFilterId>('all')
const columnQuery = ref('')
const compareSort = ref<StepCompareSort | null>(null)
const barFullScalePercent = COMPARE_BAR_FULL_SCALE_PERCENT
const WORKSPACE_PICKER_PREVIEW_COUNT = 16

const activeWorkspace = computed(
  () =>
    props.workspaceSummaries.find(
      (summary) => summary.workspaceId === props.selectedWorkspaceId,
    ) ??
    props.workspaceSummaries[0] ??
    null,
)
const activeWorkspaceId = computed(() => activeWorkspace.value?.workspaceId ?? '')
const baselineWorkspace = computed(
  () =>
    props.workspaceSummaries.find(
      (summary) => summary.workspaceId === props.qorTrendSummary.baselineWorkspaceId,
    ) ?? null,
)

const issues = computed(() => buildStepIssues(activeWorkspace.value, props.selectedStep))
const issueCounts = computed(() => countStepIssues(issues.value))
const issueFilters = computed(() => buildStepIssueFilters(issues.value))
const filteredIssues = computed(() =>
  issues.value.filter((issue) => matchesStepIssueFilter(issue, issueFilter.value)),
)
// Falls back to the first queued issue so the evidence pane is never empty after
// switching step, workspace, or filter.
const selectedIssue = computed(
  () =>
    filteredIssues.value.find((issue) => issue.id === selectedIssueId.value) ??
    filteredIssues.value[0] ??
    null,
)
// Channels whose artifacts add nothing past the queue row get no card at all, so the
// pane goes straight to the step metrics with the matching row highlighted.
const evidenceIssue = computed(() =>
  selectedIssue.value && hasStepIssueEvidence(selectedIssue.value)
    ? selectedIssue.value
    : null,
)
const issueEmptyMessage = computed(() =>
  issueCounts.value.total === 0
    ? `No findings reported for ${props.selectedStep} in this workspace.`
    : 'No findings match this filter.',
)
const evidenceEmptyMessage = computed(() =>
  issueCounts.value.total === 0
    ? `No findings reported for ${props.selectedStep} in this workspace.`
    : 'No findings match this filter.',
)

// Context changes start from the complete queue. A metric supplied by Dashboard then
// becomes the selected evidence, instead of relying on whichever issue happens to sort first.
watch(
  [() => props.selectedStep, activeWorkspaceId, () => props.selectedIssueMetric],
  () => {
    issueFilter.value = 'all'
    const requested = props.selectedIssueMetric
      ? issues.value.find((issue) => issue.metric === props.selectedIssueMetric)
      : null
    selectedIssueId.value = requested?.id ?? null
  },
  { immediate: true },
)

const verdict = computed(() =>
  buildStepVerdict(activeWorkspace.value, props.selectedStep, issues.value),
)
const stepTabs = computed(() => buildStepTabs(props.steps, activeWorkspace.value))
const workspaceChips = computed(() =>
  buildStepWorkspaceChips(
    props.workspaceSummaries,
    props.qorTrendSummary,
    props.bestWorkspaceId,
    props.selectedStep,
  ),
)
const workspaceChipById = computed(
  () => new Map(workspaceChips.value.map((chip) => [chip.workspaceId, chip])),
)
const activeWorkspaceChip = computed(
  () =>
    workspaceChipById.value.get(activeWorkspaceId.value) ??
    workspaceChips.value[0] ??
    null,
)
const activeWorkspaceIndex = computed(() =>
  workspaceChips.value.findIndex((chip) => chip.workspaceId === activeWorkspaceId.value),
)
const canSelectPreviousWorkspace = computed(() => activeWorkspaceIndex.value > 0)
const canSelectNextWorkspace = computed(
  () =>
    activeWorkspaceIndex.value >= 0 &&
    activeWorkspaceIndex.value < workspaceChips.value.length - 1,
)
const workspacePickerOptions = computed(() => {
  const query = workspacePickerQuery.value.trim().toLocaleLowerCase()
  if (!query) return workspaceChips.value
  return workspaceChips.value.filter((chip) =>
    [chip.workspaceId, chip.workspaceName, chip.statusLabel]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query),
  )
})
const visibleWorkspacePickerOptions = computed(() =>
  workspacePickerShowsAll.value
    ? workspacePickerOptions.value
    : workspacePickerOptions.value.slice(0, WORKSPACE_PICKER_PREVIEW_COUNT),
)
const canToggleWorkspacePickerPreview = computed(
  () => workspacePickerOptions.value.length > WORKSPACE_PICKER_PREVIEW_COUNT,
)
const compareCandidates = computed(() =>
  buildStepCompareCandidates(
    props.workspaceSummaries,
    props.qorTrendSummary,
    props.selectedStep,
  ),
)
const compareScope = computed(() =>
  buildStepComparisonScope({
    candidates: compareCandidates.value,
    baselineWorkspaceId: props.qorTrendSummary.baselineWorkspaceId,
    selectedWorkspaceId: activeWorkspaceId.value,
    filter: columnFilter.value,
    query: columnQuery.value,
    sort: compareSort.value,
  }),
)
const columnFilterOptions = computed(() =>
  STEP_COMPARE_COLUMN_FILTERS.map((option) => {
    const count = compareScope.value.filterCounts[option.id]
    // A narrowing that would leave only the reference columns is not worth offering, and
    // pressing it would look like the table had broken.
    const disabled = option.id !== 'all' && count === 0
    return {
      ...option,
      count,
      disabled,
      title: disabled
        ? `${option.title}. No workspace qualifies right now.`
        : option.title,
    }
  }),
)
const compareScopeIsNarrowed = computed(
  () =>
    columnFilter.value !== 'all' ||
    columnQuery.value.trim().length > 0 ||
    compareSort.value !== null,
)
const comparisonWorkspaceSummaries = computed(() => {
  const summaryById = new Map(
    props.workspaceSummaries.map((summary) => [summary.workspaceId, summary]),
  )
  return compareScope.value.workspaceIds.flatMap((workspaceId) => {
    const summary = summaryById.get(workspaceId)
    return summary ? [summary] : []
  })
})
const metricGroups = computed(() =>
  buildStepMetricGroups(
    activeWorkspace.value,
    baselineWorkspace.value,
    props.selectedStep,
  ),
)
const detailTables = computed(() =>
  buildStepDetailTables(activeWorkspace.value, props.selectedStep),
)
const compareMatrix = computed(() =>
  buildStepCompareMatrix(
    comparisonWorkspaceSummaries.value,
    props.qorTrendSummary,
    props.bestWorkspaceId,
    props.selectedStep,
  ),
)
const activeCompareVerdict = computed(
  () =>
    compareMatrix.value.verdicts.find(
      (verdict) => verdict.workspaceId === activeWorkspaceId.value,
    ) ??
    compareMatrix.value.verdicts[0] ??
    null,
)
/**
 * The baseline column is frozen beside the metric column, so its width has to be a value
 * the stylesheet can offset by rather than whatever a fraction of the panel works out to.
 */
const compareGridStyle = computed(() => ({
  gridTemplateColumns: `var(--compare-metric-width) repeat(${compareMatrix.value.columns.length}, minmax(var(--compare-column-width), 1fr))`,
}))
const compareBaselineColumnId = computed(
  () =>
    compareMatrix.value.columns.find((column) => column.isBaseline)?.workspaceId ?? null,
)
const compareColumnCount = computed(() => {
  const shown = compareMatrix.value.columns.length
  const total = compareCandidates.value.length
  if (shown === total) return `${total} workspaces`
  // The baseline and the current workspace stay whatever the search says, so a search
  // with no match has to explain the columns that are still there.
  if (compareScope.value.filterCounts.all === 0)
    return 'no match · reference columns only'
  return `${shown} of ${total} workspaces`
})
const compareCaption = computed(() => {
  const { rowCount, differingCount } = compareMatrix.value
  const baseline = `baseline ${props.qorTrendSummary.baselineLabel}`
  if (rowCount === 0) return baseline
  if (differingCount === 0) return `${baseline} · no metric differs`
  return `${baseline} · ${differingCount} of ${rowCount} differ`
})
// Hiding matched rows is only ever an improvement when some of them would remain.
const canFilterDiffering = computed(
  () =>
    compareMatrix.value.differingCount > 0 &&
    compareMatrix.value.differingCount < compareMatrix.value.rowCount,
)
const compareGroups = computed(() =>
  filterStepCompareGroups(
    compareMatrix.value.groups,
    onlyDiffering.value && canFilterDiffering.value,
  ),
)
const compareVisibleRowCount = computed(() =>
  compareGroups.value.reduce((total, group) => total + group.rows.length, 0),
)
const compareEmptyMessage = computed(() =>
  compareMatrix.value.rowCount === 0
    ? `No V3 metrics were reported for ${props.selectedStep} in the workspaces shown.`
    : `Every ${props.selectedStep} metric matches the baseline.`,
)
const modeOptions = computed(() => [
  {
    id: 'findings' as const,
    label: 'Findings',
    count: issues.value.length,
    tone: issueCounts.value.blocking > 0 ? 'bad' : 'neutral',
  },
  {
    id: 'compare' as const,
    label: 'Compare',
    count: compareMatrix.value.rowCount === 0 ? null : compareMatrix.value.differingCount,
    tone: 'neutral',
  },
])
const modeHint = computed(() =>
  mode.value === 'findings'
    ? `${activeWorkspace.value?.workspaceName ?? 'No workspace'} · ${props.selectedStep}`
    : `${compareMatrix.value.columns.length} workspaces · ${props.selectedStep}`,
)
const metricsCaption = computed(() => {
  const name = activeWorkspace.value?.workspaceName ?? 'No workspace'
  const baseline = baselineWorkspace.value
  if (!baseline || baseline.workspaceId === activeWorkspaceId.value) {
    return `${name} · reference workspace`
  }
  return `${name} · vs ${baseline.workspaceName}`
})

// A rank belongs to one metric of one step, and the next step reports its own metrics.
watch(
  () => props.selectedStep,
  () => {
    compareSort.value = null
  },
)

watch(workspacePickerQuery, () => {
  workspacePickerShowsAll.value = false
})

function moveActiveWorkspace(direction: -1 | 1): void {
  const next = workspaceChips.value[activeWorkspaceIndex.value + direction]
  if (next) emit('select-workspace', next.workspaceId)
}

function selectWorkspaceFromPicker(workspaceId: string): void {
  workspacePickerOpen.value = false
  workspacePickerQuery.value = ''
  workspacePickerShowsAll.value = false
  emit('select-workspace', workspaceId)
}

function compareColumnTitle(column: StepCompareColumn): string {
  const roles = [
    column.isBaseline ? 'baseline' : null,
    column.workspaceId === activeWorkspaceId.value ? 'current workspace' : null,
    column.isBest ? 'best' : null,
  ]
    .filter(Boolean)
    .join(', ')
  return [
    column.workspaceName,
    roles,
    workspaceChipById.value.get(column.workspaceId)?.statusLabel,
  ]
    .filter(Boolean)
    .join(' · ')
}

function compareRankTitle(row: StepCompareRow): string {
  if (compareSort.value?.metricName !== row.id) {
    return row.higherIsBetter === null
      ? `Rank the columns by ${row.label}, largest value first. This metric reports no better direction.`
      : `Rank the columns by ${row.label}, best first (${row.descriptor}).`
  }
  return compareSort.value.direction === 'leading'
    ? `Reverse the ranking on ${row.label}`
    : `Clear the ranking on ${row.label}`
}

/** Leading, then trailing, then back to the project's own order. */
function cycleCompareRank(row: StepCompareRow): void {
  const sort = compareSort.value
  if (sort?.metricName !== row.id) {
    compareSort.value = {
      metricName: row.id,
      higherIsBetter: row.higherIsBetter,
      direction: 'leading',
    }
    return
  }
  compareSort.value =
    sort.direction === 'leading' ? { ...sort, direction: 'trailing' } : null
}

function resetCompareScope(): void {
  columnFilter.value = 'all'
  columnQuery.value = ''
  compareSort.value = null
}

// Red is reserved for what the artifacts call blocking. Other findings are counted but
// not ranked, since their importance is not something these artifacts report.
function stepTabTone(tab: StepTab): string {
  if (tab.blockingCount > 0) return 'bad'
  if (tab.findingCount > 0 || tab.analysisAvailability === 'incomplete') return 'warn'
  if (tab.analysisAvailability === 'available') return 'good'
  return 'none'
}

function stepTabBadge(tab: StepTab): string {
  return tab.findingCount > 0 ? String(tab.findingCount) : ''
}

function stepTabTitle(tab: StepTab): string {
  if (tab.analysisAvailability === 'unavailable')
    return `${tab.step}: analysis unavailable`
  if (tab.analysisAvailability === 'incomplete') return `${tab.step}: analysis incomplete`
  return `${tab.step}: ${tab.findingCount} findings, ${tab.blockingCount} listed as blocking`
}

function workspaceChipTitle(chip: StepWorkspaceChip): string {
  const roles = [chip.isBaseline ? 'baseline' : null, chip.isBest ? 'best' : null]
    .filter(Boolean)
    .join(', ')
  const suffix = roles ? ` (${roles})` : ''
  const findings = `${chip.findingCount} findings, ${chip.blockingCount} listed as blocking`
  return `${chip.workspaceName} · ${chip.statusLabel}${suffix} · ${findings}`
}

function detailSourceLabel(
  sourceFile: string,
  status: 'available' | 'missing' | 'invalid',
): string {
  return status === 'available' ? sourceFile : `QoR metrics: ${status}`
}

function detailSourceTone(status: 'available' | 'missing' | 'invalid'): string {
  if (status === 'invalid') return 'bad'
  if (status === 'missing') return 'warn'
  return 'neutral'
}

/** Keeps the artifact path reachable for the channels that get no evidence card. */
function issueRowTitle(issue: StepIssue): string {
  return [issue.location ?? issue.source, issue.diagnosis].filter(Boolean).join(' · ')
}

/**
 * Some channels use the artifact path as their metric id, or already name the metric in
 * the evidence selector, so printing it again would just repeat the line.
 */
function evidenceMetricId(issue: StepIssue): string | null {
  const source = issue.location ?? issue.source
  return source.includes(issue.metric) ? null : issue.metric
}

function metricRowTitle(row: StepMetricRow): string {
  return [row.label, row.descriptor, row.corner, row.sourceFile]
    .filter(Boolean)
    .join(' · ')
}

function compareCellTitle(row: StepCompareRow, cell: StepCompareCell): string {
  const change = cell.deltaPercent ? `${cell.delta} (${cell.deltaPercent})` : cell.delta
  return [
    `${cell.workspaceName} ${row.label}: ${cell.value}`,
    cell.unavailableReason ? `Not applicable: ${cell.unavailableReason}` : null,
    change ?? cell.deltaNote,
    cell.leads ? `best reported value (${row.descriptor})` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Grows the fill out of the track's centre line, which every cell of a column shares, so
 * a reader compares bar against bar rather than reading each one on its own.
 */
function deltaBarStyle(cell: StepCompareCell): Record<string, string> {
  const ratio = cell.barRatio ?? 0
  const width = `${Math.abs(ratio) * 50}%`
  return ratio < 0 ? { right: '50%', width } : { left: '50%', width }
}
</script>

<style scoped src="./projectStepAnalysisPanel.css"></style>
