<template>
  <div class="insight-module">
    <TimingAnalysisPanel
      :overview="model"
      :critical-paths="criticalPaths"
      empty-hint="Waiting for STA corners…"
    />

    <div v-if="criticalPaths" class="sta-full-list-entry">
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
        <TimingCriticalPaths :critical-paths="fullIssuesModel" />
      </template>
    </Dialog>

    <section v-if="hasCorners && convergence" class="sta-card">
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import type { WorkspaceArtifactDescriptor } from '@ecos-studio/shared'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import TimingAnalysisPanel from '../step-insights/TimingAnalysisPanel.vue'
import TimingCriticalPaths from '../step-insights/TimingCriticalPaths.vue'
import {
  staTimingIssuesLabel,
  useStaTimingIssues,
} from '@/composables/useStaTimingIssues'
import type {
  StaConvergenceModel,
  StaCriticalPathsModel,
  StaOverviewModel,
} from './flowInsightsData'

const props = defineProps<{
  model: StaOverviewModel | null
  criticalPaths?: StaCriticalPathsModel | null
  convergence?: StaConvergenceModel | null
  /** Indexed sta_timing_issues artifact enabling the full-issue lazy load. */
  timingIssuesArtifact?: WorkspaceArtifactDescriptor | null
}>()

const {
  close: closeIssues,
  open: openIssues,
  state: issuesState,
  visible: issuesVisible,
} = useStaTimingIssues()

const hasCorners = computed(() => Boolean(props.model?.corners.length))

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
</script>

<style scoped>
.insight-module {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
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
