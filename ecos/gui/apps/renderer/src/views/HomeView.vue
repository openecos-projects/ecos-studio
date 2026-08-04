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

          <section class="dashboard-section layout-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-layout-masonry-line" aria-hidden="true" />
                <h2>Layout</h2>
              </div>
              <span class="dashboard-muted">Latest output</span>
            </header>
            <button
              v-if="layoutBlobUrl"
              type="button"
              class="layout-preview"
              title="Open layout preview"
              @click="preview = { label: 'Layout preview', url: layoutBlobUrl }"
            >
              <img :src="layoutBlobUrl" alt="Latest layout preview" />
            </button>
            <div v-else class="dashboard-empty">
              <i class="ri-image-2-line" /><span>Waiting for layout data</span>
            </div>
          </section>
        </div>

        <div class="home-dashboard-row home-dashboard-middle">
          <section class="dashboard-section status-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-task-line" aria-hidden="true" />
                <h2>Checklist</h2>
              </div>
              <button
                type="button"
                class="dashboard-icon-button"
                title="View checklist details"
                aria-label="View checklist details"
                @click="showChecklist = true"
              >
                <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </header>
            <div class="status-card-content">
              <StatusPieChart
                label="Checklist status distribution"
                :slices="checklistSlices"
              />
              <ul class="status-legend">
                <li
                  v-for="slice in checklistSlices"
                  :key="slice.id"
                  :class="`is-${slice.tone}`"
                >
                  <span>{{ slice.label }}</span
                  ><strong>{{ slice.value }}</strong>
                </li>
                <li v-if="!checklistSlices.length" class="is-neutral">
                  <span>No checklist data</span>
                </li>
              </ul>
            </div>
          </section>

          <section class="dashboard-section status-card qor-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-pie-chart-2-line" aria-hidden="true" />
                <h2>QoR</h2>
              </div>
              <button
                type="button"
                class="dashboard-icon-button"
                title="View QoR details"
                aria-label="View QoR details"
                @click="showQor = true"
              >
                <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </header>
            <div class="qor-overview">
              <div class="qor-pie-wrap">
                <StatusPieChart label="QoR status distribution" :slices="qorSlices" />
              </div>
              <div class="qor-step-list">
                <div v-for="step in qorSteps" :key="step.id" class="qor-step-row">
                  <span
                    class="qor-step-status"
                    :class="`is-${step.status}`"
                    aria-hidden="true"
                  />
                  <strong>{{ step.label }}</strong>
                  <span>{{ step.status }}</span>
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

          <section class="dashboard-section snapshot-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-gallery-line" aria-hidden="true" />
                <h2>Data Snapshot</h2>
              </div>
              <span class="dashboard-muted">{{ analysisCharts.length }} images</span>
            </header>
            <div v-if="analysisCharts.length" class="snapshot-grid">
              <button
                v-for="chart in analysisCharts"
                :key="chart.label"
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
            <div v-else class="dashboard-empty">
              <i class="ri-gallery-line" /><span>No analysis snapshots</span>
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
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import FlowLogPanel from '@/components/workbench/FlowLogPanel.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import { flowNodeStatus, type FlowStatusNode } from '@/components/workbench/flowStatus'
import StatusPieChart from '@/components/home/StatusPieChart.vue'
import {
  checklistPieSlices,
  formatDashboardMetric,
  qorPieSlices,
} from '@/components/home/dashboardData'
import { useDashboardOverview } from '@/composables/useDashboardOverview'
import { useFlowStages } from '@/composables/useFlowStages'
import { useHomeData } from '@/composables/useHomeData'
import { useParameters } from '@/composables/useParameters'

const { config } = useParameters()
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
const { keyMetrics, mpcConstraints, qorSteps } = useDashboardOverview()

const showPorts = ref(false)
const showChecklist = ref(false)
const showQor = ref(false)
const preview = ref<{ label: string; url: string } | null>(null)
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
const checklistSlices = computed(() => checklistPieSlices(checklistItems.value))
const qorSlices = computed(() => qorPieSlices(qorSteps.value))
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
</script>

<style scoped>
.home-dashboard {
  box-sizing: border-box;
  display: grid;
  gap: 8px;
  grid-template-rows: minmax(180px, 2fr) minmax(138px, 1fr) minmax(180px, 2fr);
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

.home-dashboard-middle,
.home-dashboard-bottom {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
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
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 6px;
}
.status-card-content > :first-child {
  flex: 0 0 48%;
  min-width: 0;
}
.status-legend {
  display: grid;
  gap: 4px;
  list-style: none;
  margin: auto 0;
  min-width: 0;
  padding: 0 6px;
  width: 100%;
}
.status-legend li {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 9px;
  gap: 5px;
  justify-content: space-between;
  min-width: 0;
}
.status-legend li::before,
.qor-step-status {
  background: var(--text-secondary);
  border-radius: 50%;
  content: '';
  flex: 0 0 auto;
  height: 6px;
  width: 6px;
}
.status-legend .is-good::before,
.qor-step-status.is-pass {
  background: var(--success-color);
}
.status-legend .is-warn::before,
.qor-step-status.is-incomplete {
  background: var(--warn-color);
}
.status-legend .is-bad::before,
.qor-step-status.is-blocked {
  background: var(--danger-color);
}

.qor-pie-wrap {
  flex: 0 0 31%;
  min-width: 0;
}
.qor-step-list {
  display: grid;
  flex: 1;
  gap: 1px;
  min-width: 0;
  overflow: auto;
  padding-left: 6px;
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
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-step-row span:not(.qor-step-status) {
  color: var(--text-secondary);
  font-size: 8px;
  white-space: nowrap;
}

.snapshot-grid {
  display: grid;
  flex: 1;
  gap: 6px;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  min-height: 0;
  overflow: auto;
  padding: 7px;
}
.snapshot-grid button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 82px;
  min-width: 0;
  overflow: hidden;
  padding: 0;
}
.snapshot-grid button:hover {
  border-color: var(--accent-color);
}
.snapshot-grid img {
  height: 100%;
  min-height: 0;
  object-fit: cover;
  width: 100%;
}
.snapshot-grid i {
  align-self: center;
  font-size: 18px;
}
.snapshot-grid span {
  border-top: 1px solid var(--border-color);
  font-size: 8px;
  overflow: hidden;
  padding: 3px;
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
</style>
