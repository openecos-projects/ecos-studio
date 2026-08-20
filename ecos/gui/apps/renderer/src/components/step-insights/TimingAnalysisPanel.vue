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
          @click="cornerFilter = tab.corner"
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

      <TimingCriticalPaths
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
  initialCorner?: string | null
  emptyHint?: string
}>()

const negativeFirst = ref(false)
const selectedPathGroup = ref('summary')
const cornerFilter = ref<string | null>(null)

const pathGroupOptions = computed(() => props.overview?.pathGroups ?? [])

watch(pathGroupOptions, (groups) => {
  if (
    selectedPathGroup.value !== 'summary' &&
    !groups.includes(selectedPathGroup.value)
  ) {
    selectedPathGroup.value = 'summary'
  }
})

const cornerTabs = computed(() => {
  const groups = props.pathsByCorner ?? []
  if (groups.length < 2) return []
  return [
    { id: 'timing-scope-all', label: 'All corners', corner: null as string | null },
    ...groups.map(({ corner }) => ({
      id: `timing-scope-${corner}`,
      label: corner,
      corner,
    })),
  ]
})

watch(
  () => props.initialCorner,
  (corner) => {
    const known = (props.pathsByCorner ?? []).some(({ corner: name }) => name === corner)
    cornerFilter.value = known ? (corner as string) : null
  },
  { immediate: true },
)

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
  const groups = props.pathsByCorner
  if (groups && groups.length) {
    return selectStaCriticalPaths(groups, cornerFilter.value)
  }
  return props.criticalPaths ?? null
})

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
