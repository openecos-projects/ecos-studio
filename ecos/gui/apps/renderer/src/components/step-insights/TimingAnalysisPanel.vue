<template>
  <div class="timing-analysis-panel">
    <div v-if="!overview || !overview.corners.length" class="timing-empty">
      {{ emptyHint ?? 'Waiting for STA corners…' }}
    </div>
    <template v-else>
      <TimingKpis :overview="displayed" />

      <div
        v-if="cornerTabs.length"
        class="timing-corner-tabs"
        role="tablist"
        aria-label="Critical path corner scope"
      >
        <button
          v-for="tab in cornerTabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="tab.corner === cornerFilter"
          :class="{ 'is-active': tab.corner === cornerFilter }"
          :title="tab.label"
          @click="emit('select-corner', tab.corner)"
        >
          {{ tab.label }}
        </button>
      </div>

      <TimingCornerTable
        :overview="displayed"
        :rows="sortedRows"
        :path-group-options="pathGroupOptions"
        :selected-path-group="selectedPathGroup"
        :negative-first="negativeFirst"
        @update:selected-path-group="selectedPathGroup = $event"
        @update:negative-first="negativeFirst = $event"
      />

      <TimingWnsChart :rows="sortedRows" />

      <div v-if="cornerFilter && detailLoading" class="timing-detail-state">
        <i class="ri-loader-4-line spin" aria-hidden="true" />
        <span>Loading timing paths</span>
      </div>
      <div v-else-if="cornerFilter && detailError" class="timing-detail-state is-error">
        <i class="ri-error-warning-line" aria-hidden="true" />
        <span
          :data-error-code="detailError"
          :title="`Timing detail error: ${detailError}`"
          >{{ timingDetailErrorLabel(detailError) }}</span
        >
      </div>
      <TimingCriticalPaths
        v-else-if="showCriticalPaths"
        :critical-paths="criticalPathsModel"
        :setup-corner="setupCornerTitle"
        :hold-corner="holdCornerTitle"
      />

      <TimingRunInfo :entries="runInfo ?? []" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  selectStaCriticalPaths,
  selectStaPathGroup,
  type StaCriticalPath,
  type StaCriticalPathsModel,
  type StaOverviewModel,
} from '../flow-insights/flowInsightsData'
import TimingCornerTable from './TimingCornerTable.vue'
import TimingCriticalPaths from './TimingCriticalPaths.vue'
import TimingKpis from './TimingKpis.vue'
import TimingRunInfo from './TimingRunInfo.vue'
import TimingWnsChart from './TimingWnsChart.vue'
import { sortStaCornerRows } from './timingFormat'

const props = defineProps<{
  overview: StaOverviewModel | null
  /** Pre-selected worst paths; ignored when pathsByCorner is provided. */
  criticalPaths?: StaCriticalPathsModel | null
  /** Per-corner paths; enables the corner scope tabs in the panel. */
  pathsByCorner?: Array<{ corner: string; paths: StaCriticalPath[] }> | null
  runInfo?: Array<{ id: string; label: string; value: string }>
  selectedCorner?: string | null
  detailLoading?: boolean
  detailError?: string | null
  emptyHint?: string
}>()

const emit = defineEmits<{
  'select-corner': [corner: string | null]
}>()

const negativeFirst = ref(false)
const selectedPathGroup = ref('summary')
const cornerFilter = computed(() => props.selectedCorner ?? null)

const pathGroupOptions = computed(() => props.overview?.pathGroups ?? [])
const lazyCornerDetails = computed(
  () => props.pathsByCorner !== undefined && props.pathsByCorner !== null,
)

watch(pathGroupOptions, (groups) => {
  if (
    selectedPathGroup.value !== 'summary' &&
    !groups.includes(selectedPathGroup.value)
  ) {
    selectedPathGroup.value = 'summary'
  }
})

const cornerTabs = computed(() => {
  if (!lazyCornerDetails.value) return []
  const corners = props.overview?.corners.map((corner) => corner.corner) ?? []
  if (!corners.length) return []
  return [
    { id: 'timing-scope-summary', label: 'Summary', corner: null as string | null },
    ...corners.map((corner) => ({
      id: `timing-scope-${corner}`,
      label: corner,
      corner,
    })),
  ]
})

const displayed = computed(() => {
  if (!props.overview) {
    return selectStaPathGroup(emptyStaOverview(), 'summary')
  }
  return selectStaPathGroup(props.overview, selectedPathGroup.value)
})

const sortedRows = computed(() =>
  sortStaCornerRows(displayed.value.corners, negativeFirst.value),
)

const criticalPathsModel = computed(() => {
  if (!lazyCornerDetails.value) return props.criticalPaths ?? null
  if (!cornerFilter.value) return null
  const groups = props.pathsByCorner
  if (groups && groups.length) {
    return selectStaCriticalPaths(groups, cornerFilter.value)
  }
  return props.criticalPaths ?? null
})
const selectedPathsLoaded = computed(() =>
  (props.pathsByCorner ?? []).some(({ corner }) => corner === cornerFilter.value),
)
const showCriticalPaths = computed(() =>
  lazyCornerDetails.value
    ? Boolean(cornerFilter.value && selectedPathsLoaded.value)
    : criticalPathsModel.value !== null,
)

/** Corner attribution is redundant when the summary covers a single corner. */
const attributesCorner = computed(() => displayed.value.corners.length > 1)

const setupCornerTitle = computed(() =>
  attributesCorner.value
    ? (cornerFilter.value ?? displayed.value.worstSetup?.corner ?? null)
    : null,
)

const holdCornerTitle = computed(() =>
  attributesCorner.value
    ? (cornerFilter.value ?? displayed.value.worstHold?.corner ?? null)
    : null,
)

function emptyStaOverview(): StaOverviewModel {
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

function timingDetailErrorLabel(code: string): string {
  switch (code) {
    case 'TIMING_ARTIFACT_READ_FAILED':
      return 'Timing path data could not be read.'
    case 'TIMING_ARTIFACT_INVALID':
      return 'Timing path data is invalid.'
    case 'TIMING_ARTIFACT_UNAVAILABLE':
      return 'Timing path data is unavailable for this corner.'
    case 'ARTIFACT_TOO_LARGE':
    case 'ENGINEERING_ARTIFACT_TOO_LARGE':
    case 'FINDINGS_ARTIFACT_TOO_LARGE':
      return 'Timing path data is too large to display.'
    case 'ARTIFACT_REVISION_MISMATCH':
      return 'Timing path data changed after the committed snapshot.'
    default:
      return 'Timing path data is unavailable.'
  }
}
</script>

<style scoped>
.timing-analysis-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.timing-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 12px;
  justify-content: center;
  min-height: 160px;
}

.timing-detail-state {
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  display: flex;
  font-size: 11px;
  gap: 6px;
  justify-content: center;
  min-height: 96px;
}

.timing-detail-state.is-error {
  color: var(--danger-color);
}

.timing-corner-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.timing-corner-tabs button {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  max-width: 160px;
  overflow: hidden;
  padding: 2px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-corner-tabs button:hover {
  color: var(--text-primary);
}

.timing-corner-tabs button.is-active {
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-color) 55%, transparent);
  color: var(--text-primary);
}
</style>
