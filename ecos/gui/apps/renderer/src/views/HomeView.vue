<template>
  <WorkspaceWorkbench flow-title="Flow status" :loading="flowLoading" :nodes="flowNodes">
    <template #left>
      <main class="home-dashboard" aria-label="Workspace dashboard">
        <div
          class="home-dashboard-row home-dashboard-top"
          :class="{ 'without-mpc': !mpcConstraints }"
        >
          <section class="dashboard-section chip-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-cpu-line" aria-hidden="true" />
                <h2>Chip Basic Info</h2>
              </div>
              <span v-if="config.pdk" class="dashboard-badge">{{ config.pdk }}</span>
            </header>
            <dl class="chip-info-grid">
              <div>
                <dt>Design</dt>
                <dd>{{ config.design || '--' }}</dd>
              </div>
              <div>
                <dt>Top module</dt>
                <dd>{{ config.topModule || '--' }}</dd>
              </div>
              <div>
                <dt>Die</dt>
                <dd>{{ dimension(config.die.Size) }}</dd>
              </div>
              <div>
                <dt>Core</dt>
                <dd>{{ dimension(config.core.Size) }}</dd>
              </div>
              <div>
                <dt>Frequency</dt>
                <dd>{{ config.frequencyMax || '--' }} MHz</dd>
              </div>
              <div>
                <dt>Clock</dt>
                <dd>{{ config.clock || '--' }}</dd>
              </div>
              <div>
                <dt>Utilization</dt>
                <dd>{{ utilization }}</dd>
              </div>
              <div>
                <dt>Layers</dt>
                <dd>{{ config.bottomLayer }} - {{ config.topLayer }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="mpcConstraints" class="dashboard-section constraint-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-ruler-2-line" aria-hidden="true" />
                <h2>Constraints</h2>
              </div>
              <button
                type="button"
                class="dashboard-icon-button"
                title="View port definition"
                aria-label="View port definition"
                @click="showPorts = true"
              >
                <i class="ri-external-link-line" aria-hidden="true" />
              </button>
            </header>
            <dl class="constraint-list">
              <div>
                <dt>Minimum area</dt>
                <dd>{{ valueOrDash(mpcConstraints.minimumArea) }}</dd>
              </div>
              <div>
                <dt>Maximum area</dt>
                <dd>{{ valueOrDash(mpcConstraints.maximumArea) }}</dd>
              </div>
              <div :class="{ 'is-warning': cellLimitExceeded }">
                <dt>Maximum cell count</dt>
                <dd>{{ valueOrDash(mpcConstraints.maximumCellCount) }}</dd>
                <small>{{ cellLimitLabel }}</small>
              </div>
            </dl>
            <button type="button" class="port-definition-link" @click="showPorts = true">
              Port Definition <i class="ri-arrow-right-up-line" aria-hidden="true" />
            </button>
          </section>

          <section class="dashboard-section key-metrics-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-speed-up-line" aria-hidden="true" />
                <h2>Key Metrics</h2>
              </div>
            </header>
            <dl class="key-metrics-grid">
              <div v-for="metric in keyMetrics" :key="metric.id">
                <dt>{{ metric.label }}</dt>
                <dd>{{ formatDashboardMetric(metric) }}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div class="home-dashboard-row home-dashboard-middle">
          <section class="dashboard-section status-card">
            <header class="dashboard-section-header">
              <div><h2>Checklist</h2></div>
            </header>
            <div class="status-card-content">
              <StatusPieChart
                label="Checklist status distribution"
                :slices="checklistSlices"
                :center-primary="checklistCenterPrimary"
                :center-secondary="checklistCenterSecondary"
              />
              <div class="status-summary-content" :class="`is-${checklistStatusTone}`">
                <div>
                  <strong class="status-summary-title">{{ checklistTitle }}</strong>
                  <p>{{ checklistSummaryLabel }}</p>
                </div>
                <dl class="status-count-list">
                  <div v-if="checklistSummary.total" class="is-blocked">
                    <dt>Blocked</dt>
                    <dd>{{ checklistSummary.blocked }}/{{ checklistSummary.total }}</dd>
                  </div>
                  <div v-if="checklistSummary.total" class="is-warning">
                    <dt>Warning</dt>
                    <dd>{{ checklistSummary.warning }}/{{ checklistSummary.total }}</dd>
                  </div>
                  <div v-if="checklistSummary.unavailable" class="is-unavailable">
                    <dt>Unavailable</dt>
                    <dd>
                      {{ checklistSummary.unavailable }}/{{ checklistSummary.total }}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  class="status-detail-link"
                  title="View checklist details"
                  @click="showChecklist = true"
                >
                  Sign-off details <i class="ri-arrow-right-up-line" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <section class="dashboard-section status-card qor-card">
            <header class="dashboard-section-header">
              <div><h2>Quality of Results</h2></div>
            </header>
            <div class="qor-overview">
              <div class="qor-pie-wrap">
                <StatusPieChart
                  label="QoR status distribution"
                  :slices="qorSlices"
                  :center-primary="qorCenterPrimary"
                  :center-secondary="qorCenterSecondary"
                />
              </div>
              <div class="qor-summary-content" :class="`is-${qorStatusTone}`">
                <div>
                  <strong class="status-summary-title">{{ qorTitle }}</strong>
                  <p>{{ qorSummaryLabel }}</p>
                </div>
                <dl class="status-count-list">
                  <div v-if="qorSummary.total" class="is-blocked">
                    <dt>Blocked</dt>
                    <dd>{{ qorSummary.blocked }}/{{ qorSummary.total }}</dd>
                  </div>
                  <div v-if="qorSummary.total" class="is-warning">
                    <dt>Warning</dt>
                    <dd>{{ qorSummary.warning }}/{{ qorSummary.total }}</dd>
                  </div>
                  <div v-if="qorSummary.unavailable" class="is-unavailable">
                    <dt>Unavailable</dt>
                    <dd>{{ qorSummary.unavailable }}/{{ qorSummary.total }}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  class="status-detail-link"
                  title="View QoR details"
                  @click="showQor = true"
                >
                  QoR details <i class="ri-arrow-right-up-line" aria-hidden="true" />
                </button>
              </div>
              <div class="qor-step-list">
                <div v-for="step in qorSteps" :key="step.id" class="qor-step-row">
                  <span
                    class="qor-step-status"
                    :class="`is-${step.status}`"
                    aria-hidden="true"
                  />
                  <strong>{{ step.label }}</strong>
                  <span :class="`is-${step.status}`">{{ step.status }}</span>
                  <span>{{ step.reportCount }} reports</span>
                </div>
                <div v-if="!qorSteps.length" class="dashboard-empty compact">
                  No QoR analysis yet
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="home-dashboard-row home-dashboard-bottom">
          <section class="dashboard-section snapshot-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-gallery-line" aria-hidden="true" />
                <h2>Data Snapshot</h2>
              </div>
              <span class="dashboard-muted">{{ analysisCharts.length }} images</span>
            </header>
            <div v-if="analysisCharts.length" class="snapshot-grid" aria-label="Analysis snapshots">
              <div
                v-for="(chart, index) in dataSnapshotCells"
                :key="chart?.label ?? `snapshot-empty-${index}`"
                class="snapshot-grid-cell"
                :class="{ 'is-empty': !chart }"
              >
                <button
                  v-if="chart"
                  type="button"
                  :title="chart.label"
                  @click="preview = { label: chart.label, url: chart.imageBlobUrl }"
                >
                  <img
                    v-if="chart.imageBlobUrl"
                    :src="chart.imageBlobUrl"
                    :alt="chart.label"
                  />
                  <i v-else class="ri-image-2-line" aria-hidden="true" />
                  <span>{{ chart.label }}</span>
                </button>
              </div>
            </div>
            <div v-else class="dashboard-empty">
              <i class="ri-gallery-line" /><span>No analysis snapshots</span>
            </div>
          </section>

          <section class="dashboard-section layout-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-layout-masonry-line" aria-hidden="true" />
                <h2>{{ layoutTitle }}</h2>
              </div>
              <button
                type="button"
                class="dashboard-icon-button"
                :disabled="!canOpenLayoutChipViewer"
                title="Open ChipView"
                aria-label="Open ChipView"
                @click="openLayoutChipViewer"
              >
                <i
                  class="ri-cpu-line"
                  :class="{ 'animate-pulse': layoutChipViewerBusy }"
                  aria-hidden="true"
                />
              </button>
            </header>
            <button
              v-if="layoutPreviewUrl"
              type="button"
              class="layout-preview"
              title="Open layout preview"
              @click="preview = { label: 'Layout preview', url: layoutPreviewUrl }"
            >
              <img :src="layoutPreviewUrl" alt="Latest layout preview" />
            </button>
            <div v-else class="dashboard-empty">
              <i class="ri-image-2-line" /><span>Waiting for layout data</span>
            </div>
          </section>
        </div>
      </main>
    </template>

    <template #right-log="{ selectedNode }">
      <FlowLogPanel
        :content-by-key="flowLogContentByKey"
        :ensure-content="ensureFlowLogSegmentContentLoaded"
        :error="flowLogError"
        :execution-active="currentWorkspaceFlowExecutionActive"
        :loading="flowLogLoading"
        :selected-node="selectedNode"
        :segments="flowLogSegments"
      />
    </template>
  </WorkspaceWorkbench>

  <Dialog
    v-model:visible="showPorts"
    modal
    header="Port Definition"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <table class="dashboard-detail-table">
      <thead>
        <tr>
          <th>Port</th>
          <th>Direction</th>
          <th>Type</th>
          <th>Width</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="port in mpcConstraints?.ports" :key="port.name">
          <td>{{ port.name }}</td>
          <td>{{ port.direction }}</td>
          <td>{{ port.dataType }}</td>
          <td>{{ port.width ?? '--' }}</td>
          <td>{{ port.info || '--' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!mpcConstraints?.ports.length" class="dialog-empty">
      No ports are declared by this MPC template.
    </p>
  </Dialog>

  <Dialog
    v-model:visible="showChecklist"
    modal
    header="Checklist Details"
    :style="{ width: 'min(920px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="checklistItems.length" class="checklist-detail-list">
      <section v-for="item in checklistItems" :key="item.id" :class="`is-${item.state}`">
        <div>
          <strong>{{ item.title }}</strong
          ><span>{{ item.step }}</span>
        </div>
        <p>{{ item.summary }}</p>
        <code>{{ sourcePath(item.source) }}</code>
      </section>
    </div>
    <p v-else class="dialog-empty">No checklist detail is available.</p>
  </Dialog>

  <Dialog
    v-model:visible="showQor"
    modal
    maximizable
    header="QoR by Flow Step"
    :style="{ width: 'min(1000px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="qorSteps.length" class="qor-waterfall">
      <section
        v-for="(step, index) in qorSteps"
        :key="step.id"
        :class="`is-${step.status}`"
      >
        <span class="qor-waterfall-index">{{ index + 1 }}</span>
        <div>
          <strong>{{ step.label }}</strong
          ><span>{{ step.runtime || '--' }}</span>
        </div>
        <span>{{ step.status }}</span
        ><span>{{ step.reportCount }} reports</span>
        <p v-if="step.missing.length">Missing: {{ step.missing.join(', ') }}</p>
      </section>
    </div>
    <p v-else class="dialog-empty">No per-step QoR analysis is available.</p>
  </Dialog>

  <Dialog
    v-model:visible="previewVisible"
    modal
    maximizable
    :header="preview?.label ?? 'Preview'"
    :style="{ width: 'min(1100px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <img
      v-if="preview"
      class="dashboard-image-preview"
      :src="preview.url"
      :alt="preview.label"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import FlowLogPanel from '@/components/workbench/FlowLogPanel.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import { flowNodeStatus, type FlowStatusNode } from '@/components/workbench/flowStatus'
import StatusPieChart from '@/components/home/StatusPieChart.vue'
import {
  checklistPieSlices,
  checklistStatusSummary,
  formatDashboardMetric,
  qorPieSlices,
  qorStatusSummary,
} from '@/components/home/dashboardData'
import { useDashboardOverview } from '@/composables/useDashboardOverview'
import { useFlowStages } from '@/composables/useFlowStages'
import { useHomeData } from '@/composables/useHomeData'
import { useParameters } from '@/composables/useParameters'
import { isDesktopRuntime } from '@/composables/useDesktopRuntime'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  buildChipViewerOpenRequest,
  canOpenChipViewer,
} from '@/components/drawingAreaChipViewer'

const { config } = useParameters()
const { currentProject } = useWorkspace()
const { flowStages, isLoading: flowLoading } = useFlowStages()
const {
  analysisCharts,
  checklistItems,
  currentWorkspaceFlowExecutionActive,
  ensureFlowLogSegmentContentLoaded,
  flowLogContentByKey,
  flowLogError,
  flowLogLoading,
  flowLogSegments,
  layoutBlobUrl,
} = useHomeData()
const {
  index: dashboardResourceIndex,
  keyMetrics,
  mpcConstraints,
  qorSteps,
} = useDashboardOverview()

const showPorts = ref(false)
const showChecklist = ref(false)
const showQor = ref(false)
const preview = ref<{ label: string; url: string } | null>(null)
const layoutChipViewerBusy = ref(false)
const layoutPreviewBlobUrl = ref('')
const DATA_SNAPSHOT_ROWS = 4
const DATA_SNAPSHOT_COLUMNS = 6
let layoutPreviewLoadToken = 0
let loadedLayoutPreviewSignature = ''
const dataSnapshotCells = computed(() =>
  Array.from(
    { length: DATA_SNAPSHOT_ROWS * DATA_SNAPSHOT_COLUMNS },
    (_, index) => analysisCharts.value[index] ?? null,
  ),
)
const previewVisible = computed({
  get: () => preview.value !== null,
  set: (visible: boolean) => {
    if (!visible) preview.value = null
  },
})

const flowNodes = computed<FlowStatusNode[]>(() =>
  flowStages.value
    .filter((stage) => stage.group === 'run')
    .map((stage) => ({
      id: `${stage.path}:${stage.label}`,
      label: stage.label,
      status: flowNodeStatus(stage.state),
      runtime: stage.runtime,
      peakMemoryMb: Number.isFinite(stage['peak memory (mb)'])
        ? stage['peak memory (mb)']
        : null,
    })),
)
const layoutOutputStage = computed(() => {
  return (
    [...flowStages.value]
      .reverse()
      .find((stage) => stage.group === 'run' && flowNodeStatus(stage.state) === 'succeeded') ??
    null
  )
})
const layoutRenderStage = computed(() => {
  const outputStage = layoutOutputStage.value
  if (!outputStage || outputStage.label.trim().toLowerCase() !== 'harden') {
    return outputStage
  }

  return (
    [...flowStages.value]
      .reverse()
      .find(
        (stage) =>
          stage.group === 'run' &&
          stage.path.trim().toLowerCase() === 'sta' &&
          flowNodeStatus(stage.state) === 'succeeded',
      ) ?? null
  )
})
const layoutPreviewImage = computed(() => {
  const projectPath = currentProject.value?.path
  const outputStage = layoutOutputStage.value
  const resourceIndex = dashboardResourceIndex.value
  if (!projectPath || resourceIndex?.root !== projectPath || !outputStage) return null

  const stageKeys = new Set(
    [outputStage.path, outputStage.label].map((value) => value.trim().toLowerCase()),
  )
  const image = resourceIndex.flow.steps.find((step) =>
    stageKeys.has(step.name.trim().toLowerCase()),
  )?.resources.output.image
  return image?.exists ? image : null
})
const layoutPreviewUrl = computed(() =>
  layoutPreviewImage.value ? layoutPreviewBlobUrl.value : layoutBlobUrl.value,
)
const layoutTitle = computed(() => {
  const stage = layoutOutputStage.value
  return `ChipView - ${stage?.label ?? '--'} - ${stage?.tool || '--'}`
})
const canOpenLayoutChipViewer = computed(() => {
  const stage = layoutRenderStage.value
  if (!stage || !layoutPreviewUrl.value) return false
  return canOpenChipViewer({
    chipViewerBusy: layoutChipViewerBusy.value,
    chipViewerEditBusy: false,
    isDesktopRuntime: isDesktopRuntime(),
    projectPath: currentProject.value?.path,
    step: stage.path,
  })
})

function clearLayoutPreviewBlobUrl(): void {
  const previousUrl = layoutPreviewBlobUrl.value
  layoutPreviewBlobUrl.value = ''
  loadedLayoutPreviewSignature = ''
  if (previousUrl.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
}

async function loadLayoutPreviewImage(
  image: { path: string; mtimeMs?: number; sizeBytes?: number } | null,
): Promise<void> {
  const projectPath = currentProject.value?.path
  const token = ++layoutPreviewLoadToken
  if (!image || !projectPath) {
    clearLayoutPreviewBlobUrl()
    return
  }

  const signature = `${image.path}:${image.mtimeMs ?? 0}:${image.sizeBytes ?? 0}`
  if (signature === loadedLayoutPreviewSignature && layoutPreviewBlobUrl.value) return

  try {
    const authorizedPath = await resolveProjectPathAccess(image.path)
    if (!authorizedPath) throw new Error(`Cannot access layout preview: ${image.path}`)
    const nextBlobUrl = await readProjectBlobUrl(authorizedPath, { mimeType: 'image/png' })
    if (token !== layoutPreviewLoadToken) {
      if (nextBlobUrl.startsWith('blob:')) URL.revokeObjectURL(nextBlobUrl)
      return
    }

    const previousUrl = layoutPreviewBlobUrl.value
    layoutPreviewBlobUrl.value = nextBlobUrl
    loadedLayoutPreviewSignature = signature
    if (previousUrl.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
  } catch (error) {
    if (token !== layoutPreviewLoadToken) return
    console.error('Failed to load the selected layout preview:', error)
    clearLayoutPreviewBlobUrl()
  }
}

watch(
  () => layoutPreviewImage.value,
  (image) => {
    void loadLayoutPreviewImage(image)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  layoutPreviewLoadToken += 1
  clearLayoutPreviewBlobUrl()
})
const checklistSlices = computed(() => checklistPieSlices(checklistItems.value))
const qorSlices = computed(() => qorPieSlices(qorSteps.value))
const checklistSummary = computed(() => checklistStatusSummary(checklistItems.value))
const qorSummary = computed(() => qorStatusSummary(qorSteps.value))
const checklistStatusTone = computed(() => statusTone(checklistSummary.value))
const qorStatusTone = computed(() => statusTone(qorSummary.value))
const checklistCenterPrimary = computed(() =>
  checklistSummary.value.passingPercent === null
    ? '--'
    : `${checklistSummary.value.passingPercent}%`,
)
const checklistCenterSecondary = computed(() =>
  checklistSummary.value.total ? 'passing' : 'no data',
)
const qorCenterPrimary = computed(() =>
  qorSummary.value.total ? `${qorSummary.value.passed}/${qorSummary.value.total}` : '--',
)
const qorCenterSecondary = computed(() => (qorSummary.value.total ? 'gates' : 'no data'))
const checklistTitle = computed(() => {
  if (!checklistSummary.value.total) return 'Checklist pending'
  if (checklistSummary.value.blocked) return 'Sign-off blocked'
  if (checklistSummary.value.warning) return 'Sign-off attention'
  if (checklistSummary.value.unavailable) return 'Sign-off unavailable'
  return 'Sign-off ready'
})
const qorTitle = computed(() => {
  if (!qorSummary.value.total) return 'QoR pending'
  if (qorSummary.value.blocked) return 'Gate blocked'
  if (qorSummary.value.warning) return 'Gate attention'
  if (qorSummary.value.unavailable) return 'Gate unavailable'
  return 'Gate pass'
})
const checklistSummaryLabel = computed(() => {
  if (!checklistSummary.value.total) return 'Run a flow step to populate checks'
  if (checklistSummary.value.blocked) return 'Blocking checklist items need review'
  if (checklistSummary.value.warning) return 'Checklist has warning items'
  if (checklistSummary.value.unavailable) return 'Some checklist items are unavailable'
  return 'All checklist items passed'
})
const qorSummaryLabel = computed(() => {
  if (!qorSummary.value.total) return 'Run a flow step to populate gates'
  if (qorSummary.value.blocked) return 'Blocking QoR gates need review'
  if (qorSummary.value.warning) return 'QoR gates need attention'
  if (qorSummary.value.unavailable) return 'Some QoR gates are unavailable'
  return `All ${qorSummary.value.passed} gates passed`
})
const utilization = computed(() => `${(config.core.utilization * 100).toFixed(1)}%`)
const currentCellCount = computed(
  () => keyMetrics.value.find((metric) => metric.id === 'instances')?.value ?? null,
)
const cellLimitExceeded = computed(() => {
  const constraints = mpcConstraints.value
  return (
    constraints?.maximumCellCount !== null &&
    constraints?.maximumCellCount !== undefined &&
    currentCellCount.value !== null &&
    currentCellCount.value > constraints.maximumCellCount
  )
})
const cellLimitLabel = computed(() => {
  if (currentCellCount.value === null) return 'Current count unavailable'
  return cellLimitExceeded.value
    ? 'Warning: current count exceeds this limit'
    : 'Current count is within limit'
})

function dimension(values: number[]): string {
  return values.length ? values.join(' x ') : '--'
}

function valueOrDash(value: number | null): string {
  return value === null ? '--' : String(value)
}

function sourcePath(value: Record<string, unknown>): string {
  return typeof value.path === 'string' ? value.path : '--'
}

function statusTone(summary: {
  total: number
  blocked: number
  warning: number
  unavailable: number
}): 'pass' | 'warning' | 'blocked' | 'unavailable' {
  if (!summary.total) return 'unavailable'
  if (summary.blocked) return 'blocked'
  if (summary.warning) return 'warning'
  if (summary.unavailable) return 'unavailable'
  return 'pass'
}

async function openLayoutChipViewer(): Promise<void> {
  const stage = layoutRenderStage.value
  const projectPath = currentProject.value?.path
  if (!stage || !projectPath || !canOpenLayoutChipViewer.value) return

  layoutChipViewerBusy.value = true
  try {
    const desktopApi = getDesktopApi()
    await desktopApi.chipViewer.open(
      buildChipViewerOpenRequest(projectPath, stage.path, 'view'),
    )
  } catch (error) {
    console.error('Failed to open ChipView from Home:', error)
  } finally {
    layoutChipViewerBusy.value = false
  }
}
</script>

<style scoped>
.home-dashboard {
  box-sizing: border-box;
  display: grid;
  gap: 8px;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 8px;
}

.home-dashboard-row {
  display: grid;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.home-dashboard-top {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr);
}

.home-dashboard-top.without-mpc {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
}

.home-dashboard-middle {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
}

.home-dashboard-bottom {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}

.dashboard-section {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.dashboard-section::before {
  background:
    linear-gradient(
        90deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top left / 23px 2px no-repeat,
    linear-gradient(
        180deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top left / 2px 23px no-repeat,
    linear-gradient(
        270deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top right / 23px 2px no-repeat,
    linear-gradient(
        180deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top right / 2px 23px no-repeat,
    linear-gradient(
        90deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom left / 23px 2px no-repeat,
    linear-gradient(
        0deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom left / 2px 23px no-repeat,
    linear-gradient(
        270deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom right / 23px 2px no-repeat,
    linear-gradient(
        0deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom right / 2px 23px no-repeat;
  content: '';
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--success-color) 48%, transparent));
  inset: -1px;
  pointer-events: none;
  position: absolute;
  z-index: 2;
}

.dashboard-section-header {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  justify-content: space-between;
  min-height: 33px;
  padding: 6px 9px;
}

.dashboard-section-header > div {
  align-items: center;
  color: var(--text-primary);
  display: flex;
  gap: 6px;
  min-width: 0;
}

.dashboard-section-header h2 {
  font-size: 11px;
  font-weight: 700;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-section-header i {
  color: var(--accent-color);
  font-size: 14px;
}

.dashboard-badge,
.dashboard-muted {
  color: var(--text-secondary);
  font-size: 9px;
  white-space: nowrap;
}

.dashboard-badge {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 5px;
}

.dashboard-icon-button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 24px;
  justify-content: center;
  padding: 0;
  width: 24px;
}

.dashboard-icon-button:hover {
  color: var(--accent-color);
}
.dashboard-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.dashboard-icon-button i {
  color: inherit;
}

.chip-info-grid,
.key-metrics-grid {
  display: grid;
  gap: 7px 10px;
  margin: 0;
  min-height: 0;
  padding: 9px;
}

.chip-info-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.key-metrics-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: auto;
}

.chip-info-grid div,
.key-metrics-grid div {
  min-width: 0;
}

.chip-info-grid dt,
.key-metrics-grid dt,
.constraint-list dt {
  color: var(--text-secondary);
  font-size: 9px;
  margin: 0 0 2px;
}

.chip-info-grid dd,
.key-metrics-grid dd,
.constraint-list dd {
  color: var(--text-primary);
  font-size: 10px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.constraint-list {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 10px;
}
.constraint-list > div {
  min-width: 0;
}
.constraint-list small {
  color: var(--success-color);
  display: block;
  font-size: 9px;
  line-height: 1.25;
  margin-top: 3px;
}
.constraint-list .is-warning small {
  color: var(--warn-color);
}

.port-definition-link {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
  margin: auto 10px 9px;
  padding: 0;
  width: fit-content;
}

.layout-preview {
  background: var(--bg-secondary);
  border: 0;
  cursor: zoom-in;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.layout-preview img {
  display: block;
  height: 100%;
  object-fit: contain;
  width: 100%;
}

.dashboard-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 10px;
  gap: 6px;
  justify-content: center;
  min-height: 0;
  padding: 8px;
  text-align: center;
}
.dashboard-empty i {
  font-size: 20px;
  opacity: 0.6;
}
.dashboard-empty.compact {
  min-height: 40px;
}

.status-card-content,
.qor-overview {
  display: grid;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
}

.status-card-content {
  grid-template-columns: minmax(104px, 0.45fr) minmax(0, 1fr);
}

.status-card-content > .status-pie,
.qor-pie-wrap {
  align-self: stretch;
  border-right: 1px solid var(--border-color);
  height: 100%;
  min-height: 108px;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
}

.status-summary-content,
.qor-summary-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  min-width: 0;
  padding: 9px 11px;
}

.status-summary-title {
  color: var(--text-primary);
  display: block;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}

.status-summary-content p,
.qor-summary-content p {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
  margin: 4px 0 0;
}

.status-count-list {
  display: grid;
  gap: 3px;
  margin: 0;
  min-width: 0;
}

.status-count-list > div {
  color: var(--text-secondary);
  display: flex;
  font-size: 11px;
  justify-content: space-between;
  min-width: 0;
}

.status-count-list dt,
.status-count-list dd {
  margin: 0;
}

.status-count-list dd {
  color: var(--text-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.status-summary-content.is-pass .status-summary-title,
.qor-summary-content.is-pass .status-summary-title {
  color: var(--success-color);
}
.status-summary-content.is-warning .status-summary-title,
.qor-summary-content.is-warning .status-summary-title {
  color: var(--warn-color);
}
.status-summary-content.is-blocked .status-summary-title,
.qor-summary-content.is-blocked .status-summary-title {
  color: var(--danger-color);
}
.status-count-list > .is-blocked dt,
.status-count-list > .is-blocked dd {
  color: var(--danger-color);
}
.status-count-list > .is-warning dt,
.status-count-list > .is-warning dd {
  color: var(--warn-color);
}
.status-count-list > .is-unavailable dt,
.status-count-list > .is-unavailable dd {
  color: var(--text-secondary);
}

.status-detail-link {
  align-items: center;
  align-self: flex-end;
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  display: inline-flex;
  font-size: 10px;
  gap: 3px;
  margin-top: auto;
  padding: 0;
}

.status-detail-link:hover {
  color: var(--text-primary);
}

.qor-step-status {
  background: var(--text-secondary);
  border-radius: 50%;
  content: '';
  flex: 0 0 auto;
  height: 6px;
  width: 6px;
}
.qor-step-status.is-pass {
  background: var(--success-color);
}
.qor-step-status.is-incomplete {
  background: var(--warn-color);
}
.qor-step-status.is-blocked {
  background: var(--danger-color);
}

.qor-overview {
  grid-template-columns: minmax(104px, 0.34fr) minmax(132px, 0.55fr) minmax(0, 1fr);
}

.qor-summary-content {
  border-right: 1px solid var(--border-color);
}

.qor-step-list {
  display: grid;
  flex: 1;
  gap: 1px;
  min-width: 0;
  overflow: auto;
  padding: 7px 10px;
}
.qor-step-row {
  align-items: center;
  display: grid;
  gap: 5px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  min-width: 0;
  padding: 1px 0;
}
.qor-step-row strong {
  color: var(--text-primary);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-step-row span:not(.qor-step-status) {
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
}
.qor-step-row span.is-pass {
  color: var(--success-color);
}
.qor-step-row span.is-incomplete {
  color: var(--warn-color);
}
.qor-step-row span.is-blocked {
  color: var(--danger-color);
}

.status-card .dashboard-section-header h2 {
  font-size: 13px;
}

.snapshot-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  min-height: 0;
  padding: 7px;
}

.snapshot-grid-cell {
  border-bottom: 1px dashed color-mix(in srgb, var(--text-secondary) 45%, transparent);
  border-right: 1px dashed color-mix(in srgb, var(--text-secondary) 45%, transparent);
  min-height: 0;
  min-width: 0;
}

.snapshot-grid-cell:nth-child(6n) {
  border-right: 0;
}

.snapshot-grid-cell:nth-child(n + 19) {
  border-bottom: 0;
}

.snapshot-grid-cell button {
  align-items: stretch;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 6% 7% 4%;
  width: 100%;
}

.snapshot-grid-cell button:hover,
.snapshot-grid-cell button:focus-visible {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
  outline: none;
}

.snapshot-grid-cell img {
  align-self: stretch;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  display: block;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  width: 100%;
}

.snapshot-grid-cell i {
  align-self: center;
  font-size: 18px;
}

.snapshot-grid-cell span {
  align-self: end;
  font-size: 8px;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  padding-top: 4%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-detail-table {
  border-collapse: collapse;
  font-size: 11px;
  min-width: 100%;
  width: 100%;
}
.dashboard-detail-table th,
.dashboard-detail-table td {
  border-bottom: 1px solid var(--border-color);
  padding: 8px;
  text-align: left;
  vertical-align: top;
}
.dashboard-detail-table th {
  color: var(--text-secondary);
  font-weight: 600;
}
.dialog-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 20px 0;
  text-align: center;
}

.checklist-detail-list,
.qor-waterfall {
  display: grid;
  gap: 8px;
}
.checklist-detail-list section {
  border-left: 3px solid var(--text-secondary);
  padding: 8px 10px;
}
.checklist-detail-list section.is-pass {
  border-left-color: var(--success-color);
}
.checklist-detail-list section.is-warning {
  border-left-color: var(--warn-color);
}
.checklist-detail-list section.is-failed {
  border-left-color: var(--danger-color);
}
.checklist-detail-list div {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}
.checklist-detail-list strong {
  color: var(--text-primary);
  font-size: 12px;
}
.checklist-detail-list span,
.checklist-detail-list p,
.checklist-detail-list code {
  color: var(--text-secondary);
  font-size: 10px;
}
.checklist-detail-list p {
  margin: 4px 0;
}
.checklist-detail-list code {
  overflow-wrap: anywhere;
}

.qor-waterfall section {
  align-items: center;
  border-left: 3px solid var(--text-secondary);
  display: grid;
  gap: 8px;
  grid-template-columns: 24px minmax(0, 1fr) auto auto;
  min-width: 0;
  padding: 9px;
}
.qor-waterfall section.is-pass {
  border-left-color: var(--success-color);
}
.qor-waterfall section.is-incomplete {
  border-left-color: var(--warn-color);
}
.qor-waterfall section.is-blocked {
  border-left-color: var(--danger-color);
}
.qor-waterfall-index {
  color: var(--text-secondary);
  font-size: 11px;
}
.qor-waterfall strong {
  color: var(--text-primary);
  display: block;
  font-size: 12px;
}
.qor-waterfall div span,
.qor-waterfall > span,
.qor-waterfall section > span {
  color: var(--text-secondary);
  font-size: 10px;
}
.qor-waterfall p {
  color: var(--warn-color);
  font-size: 10px;
  grid-column: 2 / -1;
  margin: 0;
}
.dashboard-image-preview {
  display: block;
  height: auto;
  max-height: min(75vh, 820px);
  object-fit: contain;
  width: 100%;
}

@media (max-width: 1180px) {
  .home-dashboard {
    grid-template-rows: auto auto auto;
  }
  .home-dashboard-top,
  .home-dashboard-top.without-mpc,
  .home-dashboard-middle,
  .home-dashboard-bottom {
    grid-template-columns: 1fr;
  }
  .dashboard-section {
    min-height: 180px;
  }
}

@media (max-width: 720px) {
  .qor-overview {
    grid-template-columns: minmax(78px, 0.32fr) minmax(112px, 0.55fr) minmax(0, 1fr);
  }
  .status-summary-content,
  .qor-summary-content,
  .qor-step-list {
    padding-left: 8px;
    padding-right: 8px;
  }
  .qor-step-row {
    gap: 3px;
  }
  .qor-step-row span:not(.qor-step-status) {
    font-size: 7px;
  }
}
</style>
