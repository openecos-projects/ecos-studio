<template>
  <div class="flow-insights" :data-step-count="steps.length">
    <header class="flow-insights-header">
      <div class="flow-insights-title">
        <i class="ri-grid-line" aria-hidden="true" />
        <h2>Data Snapshot</h2>
      </div>
      <span v-if="loading" class="flow-insights-loading">
        <i class="ri-loader-4-line spin" aria-hidden="true" /> refreshing…
      </span>
    </header>

    <div class="data-snapshot-grid" role="list" aria-label="Data snapshot modules">
      <div
        v-for="(cell, index) in snapshotCells"
        :key="cell?.id ?? `snapshot-empty-${index}`"
        class="data-snapshot-cell"
        :class="{ 'is-empty': !cell }"
      >
        <button
          v-if="cell"
          type="button"
          class="data-snapshot-tile"
          :class="{ 'is-unavailable': !cell.available }"
          :title="cell.hint"
          @click="openModule(cell.id)"
        >
          <i :class="cell.icon" aria-hidden="true" />
          <span class="data-snapshot-tile-title">{{ cell.title }}</span>
        </button>
      </div>
    </div>

    <Dialog
      v-model:visible="dialogVisible"
      v-model:maximized="dialogMaximized"
      class="data-snapshot-dialog"
      modal
      maximizable
      :header="activeModule?.title ?? 'Data Snapshot'"
      :style="{ width: 'min(1080px, calc(100vw - 40px))' }"
      :content-style="{ height: 'min(72vh, 680px)', overflow: 'auto' }"
      :draggable="false"
    >
      <div class="data-snapshot-dialog-body">
        <StepResourcesPanel v-if="activeTab === 'resources'" :model="stepResources" />
        <DbTrendsPanel
          v-else-if="activeTab === 'db-trends'"
          :model="dbTrends"
          :composition="instanceComposition"
        />
        <CongestionPanel
          v-else-if="activeTab === 'congestion'"
          :tiles="congestionTiles"
          :tile-urls="congestionTileUrls"
        />
        <DrcPanel v-else-if="activeTab === 'drc'" :model="drc" :related="drcRelated" />
        <StaPanel
          v-else-if="activeTab === 'timing'"
          :model="sta"
          :critical-paths="staCriticalPaths"
          :convergence="staConvergence"
        />
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import StepResourcesPanel from './StepResourcesPanel.vue'
import DbTrendsPanel from './DbTrendsPanel.vue'
import CongestionPanel from './CongestionPanel.vue'
import DrcPanel from './DrcPanel.vue'
import StaPanel from './StaPanel.vue'
import { resolveFlowInsightModules } from './flowInsightsModule'
import type {
  CongestionMapTileModel,
  DbTrendModel,
  DrcLayerTypeMatrix,
  DrcRelatedMetrics,
  FlowInsightStep,
  InstanceCompositionModel,
  StaConvergenceModel,
  StaCriticalPathsModel,
  StaOverviewModel,
  StepResourcesModel,
} from './flowInsightsData'

const props = defineProps<{
  steps: FlowInsightStep[]
  stepResources: StepResourcesModel | null
  dbTrends: DbTrendModel | null
  instanceComposition?: {
    num: InstanceCompositionModel
    area: InstanceCompositionModel
  } | null
  congestionTiles: CongestionMapTileModel[]
  congestionTileUrls: Map<string, string>
  drc: DrcLayerTypeMatrix | null
  drcRelated?: DrcRelatedMetrics | null
  sta: StaOverviewModel | null
  staCriticalPaths?: StaCriticalPathsModel | null
  staConvergence?: StaConvergenceModel | null
  loading?: boolean
}>()

const DATA_SNAPSHOT_ROWS = 4
const DATA_SNAPSHOT_COLUMNS = 5
const DATA_SNAPSHOT_CELL_COUNT = DATA_SNAPSHOT_ROWS * DATA_SNAPSHOT_COLUMNS

const activeTab = ref<string | null>(null)
const dialogVisible = ref(false)
const dialogMaximized = ref(false)

const modules = computed(() =>
  resolveFlowInsightModules({
    stepResources: props.stepResources,
    dbTrends: props.dbTrends,
    congestionTiles: props.congestionTiles,
    drc: props.drc,
    sta: props.sta,
  }),
)

const snapshotCells = computed(() =>
  Array.from(
    { length: DATA_SNAPSHOT_CELL_COUNT },
    (_, index) => modules.value[index] ?? null,
  ),
)

const activeModule = computed(
  () => modules.value.find((module) => module.id === activeTab.value) ?? null,
)

function openModule(moduleId: string): void {
  activeTab.value = moduleId
  dialogMaximized.value = false
  dialogVisible.value = true
}
</script>

<style scoped>
.flow-insights {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.flow-insights-header {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-height: 20px;
}

.flow-insights-title {
  align-items: center;
  color: var(--text-primary);
  display: flex;
  font-size: 12px;
  gap: 6px;
}

.flow-insights-title i {
  color: var(--accent-color);
}

.flow-insights-title h2 {
  font-size: 12px;
  font-weight: 720;
  margin: 0;
}

.flow-insights-loading {
  align-items: center;
  color: var(--text-secondary);
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
}

.data-snapshot-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  min-height: 0;
  padding: 2px 0 0;
}

.data-snapshot-cell {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  min-height: 0;
  min-width: 0;
}

.data-snapshot-cell:nth-child(5n) {
  border-right: 0;
}

.data-snapshot-cell:nth-child(n + 16) {
  border-bottom: 0;
}

.data-snapshot-tile {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  padding: 6px 4px;
  text-align: center;
  width: 100%;
}

.data-snapshot-tile i {
  color: var(--accent-color);
  font-size: 18px;
  line-height: 1;
}

.data-snapshot-tile-title {
  font-size: 10px;
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-snapshot-tile:hover,
.data-snapshot-tile:focus-visible {
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  outline: none;
}

.data-snapshot-tile.is-unavailable {
  opacity: 0.58;
}

.data-snapshot-dialog-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.data-snapshot-dialog-body > * {
  flex: 1;
  min-height: 0;
}

@keyframes flow-insights-spin {
  to {
    transform: rotate(360deg);
  }
}

.flow-insights-loading .spin {
  animation: flow-insights-spin 1s linear infinite;
}
</style>

<!-- Dialog teleports to body; keep maximize layout rules unscoped. -->
<style>
.data-snapshot-dialog.p-dialog-maximized {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  width: 100vw;
}

.data-snapshot-dialog.p-dialog-maximized .p-dialog-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: auto !important;
  max-height: none !important;
  min-height: 0;
  overflow: hidden;
}

.data-snapshot-dialog.p-dialog-maximized .data-snapshot-dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
