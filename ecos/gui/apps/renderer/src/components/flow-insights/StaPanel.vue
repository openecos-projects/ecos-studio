<template>
  <div class="insight-module">
    <header class="sta-overview-header">
      <div>
        <h3>STA Timing Analysis</h3>
        <p>Current workspace · corner summaries and timing paths · all times in ns</p>
      </div>
      <button
        type="button"
        class="sta-full-list-button"
        :disabled="summaryLoading"
        @click="void refresh()"
      >
        <i class="ri-refresh-line" aria-hidden="true" /> Reload timing
      </button>
    </header>
    <p v-if="summaryLoading" class="sta-load-note" role="status">
      Loading STA corner summaries…
    </p>
    <p v-else-if="failedSummaryCorners.length" class="sta-issues-missing" role="status">
      Incomplete corner data: {{ failedSummaryCorners.join(', ') }}. Reload timing to
      retry.
    </p>
    <TimingAnalysisPanel
      :overview="summaryLoading ? null : displayedOverview"
      :paths-by-corner="pathsByCorner"
      :selected-corner="selectedCorner"
      :detail-loading="selectedPathLoading"
      :detail-error="selectedPathError"
      :critical-path-limit="Number.POSITIVE_INFINITY"
      :run-info="selectedRunInfo"
      corner-selector="select"
      empty-hint="Waiting for STA corners…"
      @select-corner="selectCorner"
      @retry-corner="retryCorner"
    />

    <div v-if="timingIssuesArtifact || criticalPaths" class="sta-full-list-entry">
      <button
        type="button"
        class="sta-full-list-button"
        @click="void openIssues(timingIssuesArtifact ?? null)"
      >
        <i class="ri-file-list-3-line" aria-hidden="true" />
        <span>{{ fullListButtonLabel }}</span>
      </button>
    </div>

    <Dialog
      :visible="issuesVisible"
      modal
      maximizable
      class="sta-issues-dialog"
      header="STA timing issues"
      :style="{ width: 'min(1080px, calc(100vw - 40px))' }"
      :content-style="{ height: 'min(72vh, 680px)', overflow: 'auto' }"
      :draggable="false"
      @update:visible="closeIssues"
    >
      <div v-if="issuesState.status === 'loading'" class="sta-issues-state">
        <i class="ri-loader-4-line spin" aria-hidden="true" />
        <span>Loading the full timing issue list</span>
      </div>
      <div
        v-else-if="issuesState.status === 'unavailable'"
        class="sta-issues-state is-error"
      >
        <i class="ri-error-warning-line" aria-hidden="true" />
        <span>{{ staTimingIssuesLabel(issuesState.code) }}</span>
      </div>
      <template v-else-if="issuesState.status === 'ready'">
        <p v-if="issuesState.missingCorners.length" class="sta-issues-missing">
          <i class="ri-error-warning-line" aria-hidden="true" />
          <span
            >No committed timing paths for
            {{ issuesState.missingCorners.join(', ') }}.</span
          >
        </p>
        <p v-if="!issuesState.issues.length" class="sta-issues-state" role="status">
          <i class="ri-checkbox-circle-line" aria-hidden="true" />
          No timing issues were reported in this STA analysis. Corner timing paths are
          available separately in the main Timing panel.
        </p>
        <TimingCriticalPaths v-else :critical-paths="fullIssuesModel" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import type { WorkspaceArtifactDescriptor } from '@ecos-studio/shared'
import TimingAnalysisPanel from '../step-insights/TimingAnalysisPanel.vue'
import TimingCriticalPaths from '../step-insights/TimingCriticalPaths.vue'
import {
  staTimingIssuesLabel,
  useStaTimingIssues,
} from '@/composables/useStaTimingIssues'
import { useStaCornerDetails } from '@/composables/useStaCornerDetails'
import type { StaCriticalPathsModel, StaOverviewModel } from './flowInsightsData'

const props = defineProps<{
  model: StaOverviewModel | null
  criticalPaths?: StaCriticalPathsModel | null
  timingArtifacts?: WorkspaceArtifactDescriptor[]
  /** Indexed sta_timing_issues artifact enabling the full-issue lazy load. */
  timingIssuesArtifact?: WorkspaceArtifactDescriptor | null
}>()

const {
  close: closeIssues,
  open: openIssues,
  state: issuesState,
  visible: issuesVisible,
} = useStaTimingIssues(computed(() => props.timingIssuesArtifact ?? null))

const {
  overview,
  summaryLoading,
  summaryErrors,
  pathsByCorner,
  pathLimits,
  pathErrors,
  pathLoading,
  selectedCorner,
  selectCorner,
  refresh,
} = useStaCornerDetails(computed(() => props.timingArtifacts ?? []))
const displayedOverview = computed(() => overview.value ?? props.model)
const failedSummaryCorners = computed(() => Object.keys(summaryErrors.value))
const selectedPathLoading = computed(
  () => selectedCorner.value !== null && pathLoading.value.includes(selectedCorner.value),
)
const selectedPathError = computed(() =>
  selectedCorner.value ? (pathErrors.value[selectedCorner.value] ?? null) : null,
)
const selectedRunInfo = computed(() => {
  const corner = selectedCorner.value
  if (!corner || pathLimits.value[corner] === undefined) return []
  const paths = pathsByCorner.value.find((entry) => entry.corner === corner)?.paths ?? []
  return [
    {
      id: 'path-limit',
      label: 'Tool path limit per analysis type',
      value: String(pathLimits.value[corner]),
    },
    {
      id: 'setup-paths',
      label: 'Setup paths available',
      value: String(paths.filter((path) => path.analysisType === 'setup').length),
    },
    {
      id: 'hold-paths',
      label: 'Hold paths available',
      value: String(paths.filter((path) => path.analysisType === 'hold').length),
    },
  ]
})

function retryCorner(): void {
  selectCorner(selectedCorner.value)
}

const fullListButtonLabel = computed(() => {
  const preview = props.criticalPaths
  if (preview?.issuesTruncated && typeof preview.issueCount === 'number') {
    return `View all ${preview.issueCount} timing issues`
  }
  return 'View full timing issues with stages'
})

const fullIssuesModel = computed<StaCriticalPathsModel | null>(() => {
  if (issuesState.value.status !== 'ready') return null
  const issues = issuesState.value.issues
  return {
    setup: issues.filter((issue) => issue.analysisType === 'setup'),
    hold: issues.filter((issue) => issue.analysisType === 'hold'),
  }
})
</script>

<style scoped>
.insight-module {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.sta-overview-header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}

.sta-overview-header h3 {
  color: var(--text-primary);
  font-size: 14px;
  margin: 0;
}

.sta-overview-header p,
.sta-load-note {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 6px 0 0;
}

.sta-full-list-entry {
  display: flex;
  justify-content: flex-end;
}

.sta-full-list-button {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  font-size: 10px;
  gap: 6px;
  padding: 4px 10px;
}

.sta-full-list-button:hover {
  border-color: color-mix(in srgb, var(--accent-color) 55%, transparent);
  color: var(--text-primary);
}

.sta-issues-state {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 11px;
  gap: 6px;
  justify-content: center;
  min-height: 96px;
}

.sta-issues-state.is-error {
  color: var(--danger-color);
}

.sta-issues-missing {
  align-items: center;
  color: var(--warning-color, var(--text-secondary));
  display: flex;
  font-size: 10px;
  gap: 6px;
  margin: 0 0 8px;
}

.sta-issues-state .spin {
  animation: sta-issues-spin 1s linear infinite;
}

@keyframes sta-issues-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<!-- Dialog teleports to body; keep maximize layout rules unscoped. -->
<style>
.sta-issues-dialog.p-dialog-maximized {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  width: 100vw;
}

.sta-issues-dialog.p-dialog-maximized .p-dialog-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: auto !important;
  max-height: none;
  min-height: 0;
  overflow: hidden;
}

.sta-issues-dialog.p-dialog-maximized .p-dialog-content > * {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
