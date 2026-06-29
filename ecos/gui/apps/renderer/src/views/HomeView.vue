<template>
  <div :class="['home-view', {
    'layout-fullscreen-active': isLayoutFullscreen,
    'flow-log-fullscreen-active': isFlowLogFullscreen,
  }]">
    <!-- 背景装饰 -->
    <div class="bg-grid"></div>

    <!-- ===== Dashboard Splitter ===== -->
    <Splitter
      class="dashboard-splitter"
      layout="vertical"
      :gutterSize="6"
      @resizeend="onDashboardSplitterResizeEnd"
    >
      <!-- ================= Row 1: Chip Info | Runtime Monitoring ================= -->
      <SplitterPanel :size="26" :minSize="10" class="dashboard-row">
        <Splitter
          class="dashboard-row-splitter"
          :gutterSize="6"
          @resizeend="onDashboardSplitterResizeEnd"
        >
          <SplitterPanel :size="45" :minSize="15" class="dashboard-cell">
      <section class="section-card chip-info-area">
        <div class="section-header">
          <div class="header-icon"><i class="ri-cpu-line"></i></div>
          <h2>Chip Basic Info</h2>
          <span class="header-badge" v-if="config.pdk">{{ config.pdk }}</span>
        </div>
        <div class="chip-info-content">
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Design</span>
              <span class="info-value highlight">{{ config.design || '--' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Top Module</span>
              <span class="info-value mono">{{ config.topModule || '--' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Die Size</span>
              <span class="info-value mono">{{ config.die?.Size.join(' x ') || '--' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Core Size</span>
              <span class="info-value mono">{{ config.core?.Size.join(' x ') || '--' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Target Frequency</span>
              <span class="info-value">{{ config.frequencyMax || '--' }} <small>MHz</small></span>
            </div>
            <div class="info-item">
              <span class="info-label">Utilization</span>
              <span class="info-value">{{ ((config.core?.utilization || 0) * 100).toFixed(0) }}%</span>
            </div>
            <div class="info-item">
              <span class="info-label">Clock</span>
              <span class="info-value">{{ config.clock || '--' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Layers</span>
              <span class="info-value">{{ config.bottomLayer }} - {{ config.topLayer }}</span>
            </div>
          </div>
        </div>
      </section>

          </SplitterPanel>

          <SplitterPanel :size="55" :minSize="15" class="dashboard-cell">
      <!-- ========== Row 1 Right: 运行时监控 ========== -->
      <section class="section-card monitor-area">
        <div class="section-header">
          <div class="header-icon monitor"><i class="ri-pulse-line"></i></div>
          <h2>Runtime Monitoring</h2>
        </div>
        <div class="monitor-content" v-if="monitorData">
          <div v-for="cfg in chartConfigs" :key="cfg.key" class="monitor-row">
            <span class="monitor-label">{{ cfg.label }}</span>
            <div class="monitor-chart-wrap">
              <div :ref="setChartRef(cfg.key)" class="monitor-chart"></div>
            </div>
            <span class="monitor-value">{{ getMetricMax(cfg.key) }}</span>
          </div>
        </div>
        <div v-else class="monitor-content">
          <div class="monitor-placeholder">
            <i class="ri-pulse-line"></i>
            <p>No monitor data</p>
            <span>After running the flow, the monitoring data will be displayed.</span>
          </div>
        </div>
      </section>

          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <!-- ================= Row 2: Layout | Indicator Analysis ================= -->
      <SplitterPanel :size="44" :minSize="15" class="dashboard-row">
        <Splitter
          class="dashboard-row-splitter"
          :gutterSize="6"
          @resizeend="onDashboardSplitterResizeEnd"
        >
          <SplitterPanel :size="45" :minSize="15" class="dashboard-cell">
      <!-- ========== Row 2 Left+Center: Layout Preview ========== -->
      <section class="section-card layout-area">
        <div class="section-header">
          <div class="header-icon layout"><i class="ri-layout-masonry-line"></i></div>
          <h2>Layout</h2>
          <span class="header-hint">Displays the final step of the layout after the run is completed.</span>
          <div class="header-actions">
            <button class="action-btn" @click="toggleLayoutFullscreen"
              :title="isLayoutFullscreen ? 'Exit full screen' : 'full screen'">
              <i :class="isLayoutFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"></i>
            </button>
          </div>
        </div>
        <div class="layout-content">
          <img v-if="layoutBlobUrl" :src="layoutBlobUrl" alt="Layout Preview" class="layout-image" draggable="false" />
          <!-- 科技感扫描线 -->
          <!-- <div v-if="layoutBlobUrl && !isLayoutFullscreen" class="scanner-line"></div> -->
          <div v-else-if="!layoutBlobUrl" class="layout-placeholder">
            <i class="ri-image-2-line"></i>
            <p>Layout Preview</p>
            <span>Waiting for layout data...</span>
          </div>
        </div>
      </section>

          </SplitterPanel>

          <SplitterPanel :size="55" :minSize="15" class="dashboard-cell">
      <!-- ========== Row 2 Right: 指标分析 ========== -->
      <section class="section-card analysis-area">
        <div class="section-header">
          <div class="header-icon analysis"><i class="ri-pie-chart-line"></i></div>
          <h2>Indicator Analysis</h2>
        </div>
        <div class="analysis-content">
          <div class="charts-grid" v-if="analysisCharts.length > 0">
            <div class="chart-card" v-for="chart in analysisCharts" :key="chart.label"
              :title="chart.label"
              role="button"
              tabindex="0"
              @click="onAnalysisChartClick(chart)"
              @keydown.enter.prevent="onAnalysisChartClick(chart)"
              @keydown.space.prevent="onAnalysisChartClick(chart)">
              <div class="chart-visual">
                <img v-if="chart.imageBlobUrl" :src="chart.imageBlobUrl" :alt="chart.label" class="chart-image"
                  draggable="false" />
                <i v-else class="ri-image-2-line"></i>
              </div>
              <span class="chart-label">{{ chart.label }}</span>
            </div>
          </div>
          <div v-else class="analysis-placeholder">
            <i class="ri-pie-chart-line"></i>
            <p>No metrics data</p>
            <span>After running the flow, the indicator analysis will be displayed.</span>
          </div>
        </div>
      </section>

          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <!-- ================= Row 3: Flow Log | Checklist ================= -->
      <SplitterPanel :size="30" :minSize="10" class="dashboard-row">
        <Splitter
          class="dashboard-row-splitter"
          :gutterSize="6"
          @resizeend="onDashboardSplitterResizeEnd"
        >
          <SplitterPanel :size="45" :minSize="15" class="dashboard-cell">
      <!-- ========== Row 3 Left: Flow step log ========== -->
      <section class="section-card gds-area">
        <div class="section-header">
          <div class="header-icon gds"><i class="ri-terminal-line"></i></div>
          <h2>Flow Step Log</h2>
          <span v-if="flowLogStepName" class="header-badge">{{ flowLogStepName }}</span>
          <div class="header-actions">
            <button
              type="button"
              class="action-btn flow-log-fullscreen-toggle"
              :title="isFlowLogFullscreen ? 'Exit full screen' : 'Full screen'"
              :aria-label="isFlowLogFullscreen ? 'Exit flow step log full screen' : 'View flow step log full screen'"
              @click="toggleFlowLogFullscreen"
            >
              <i :class="isFlowLogFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"></i>
            </button>
          </div>
        </div>
        <div class="flow-log-content">
          <div v-if="flowLogError" class="flow-log-error">{{ flowLogError }}</div>
          <div v-else-if="flowLogListItems.length" class="flow-log-layout">
            <div class="flow-log-viewer-panel">
              <div class="flow-log-viewer-header">
                <div class="flow-log-viewer-header-main">
                  <div v-if="selectedFlowLogSegment" class="flow-log-viewer-summary-row">
                    <span class="flow-log-viewer-title">{{ selectedFlowLogSegment.stepName }}</span>
                    <span class="flow-log-viewer-tool">{{ selectedFlowLogSegment.tool }}</span>
                    <span
                      class="flow-log-viewer-state"
                      :class="{ failed: selectedFlowLogSegment.failed, live: selectedFlowLogSegment.live }"
                    >
                      {{ selectedFlowLogSegment.state }}
                    </span>
                    <span v-if="selectedFlowLogSegment.totalSize" class="flow-log-viewer-size">
                      {{ formatKb(selectedFlowLogSegment.totalSize) }}
                    </span>
                    <span
                      v-if="flowLogLoading || loadingSelectedFlowLogKey === selectedFlowLogKey"
                      class="flow-log-viewer-loading"
                    >
                      <i class="ri-loader-4-line spin"></i>
                      {{ flowLogLoading ? 'Updating…' : 'Loading log…' }}
                    </span>
                  </div>
                  <div v-else class="flow-log-viewer-summary-row empty">
                    <span class="flow-log-viewer-title">Current step</span>
                    <span class="flow-log-viewer-tool">Select a step to inspect its output.</span>
                  </div>
                </div>

                <div class="flow-log-viewer-actions">
                  <button
                    ref="flowLogStepChooserTriggerRef"
                    type="button"
                    class="flow-log-steps-trigger"
                    aria-controls="flow-log-step-chooser-dialog"
                    :aria-expanded="isFlowLogStepChooserOpen ? 'true' : 'false'"
                    aria-haspopup="dialog"
                    :aria-label="isFlowLogStepChooserOpen ? 'Hide flow step chooser' : 'Show flow step chooser'"
                    @click="toggleFlowLogStepChooserFromTrigger"
                  >
                    <i class="ri-list-check"></i>
                    <span>Steps</span>
                  </button>
                  <button
                    v-if="liveFlowLogKey && liveFlowLogKey !== selectedFlowLogKey"
                    type="button"
                    class="flow-log-jump-live-btn"
                    @click="jumpToLiveStep"
                  >
                    <i class="ri-skip-right-line"></i>
                    <span>Jump to live</span>
                  </button>
                  <button
                    v-if="selectedFlowLogSegment?.truncated"
                    type="button"
                    class="flow-log-expand-btn"
                    :disabled="expandingFlowLogKeys[selectedFlowLogKey || '']"
                    :title="`Load full log (${formatKb(selectedFlowLogSegment.totalSize)})`"
                    @click="onExpandFullLog(selectedFlowLogSegment)"
                  >
                    <i
                      :class="[
                        expandingFlowLogKeys[selectedFlowLogKey || '']
                          ? 'ri-loader-4-line flow-log-expand-btn-spinner'
                          : 'ri-expand-up-down-line',
                      ]"
                    ></i>
                    <span v-if="expandingFlowLogKeys[selectedFlowLogKey || '']">Loading full log…</span>
                    <span v-else>Show full log</span>
                  </button>
                </div>
              </div>

              <div class="flow-log-viewer-shell">
                <FlowLogCodeViewer
                  v-if="selectedFlowLogSegment"
                  :key="selectedFlowLogKey ?? 'no-selection'"
                  :content="selectedFlowLogContent"
                  :live="Boolean(selectedFlowLogSegment.live)"
                  :missing="selectedFlowLogSegment.missing"
                  :loading="loadingSelectedFlowLogKey === selectedFlowLogKey"
                />
                <div v-else class="flow-log-placeholder">
                  <i class="ri-terminal-line"></i>
                  <p>No step selected</p>
                  <span>Open Steps to inspect a log once a flow step is available.</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="flowLogLoading" class="flow-log-loading">
            <i class="ri-loader-4-line flow-log-loading-icon"></i>
            <p>Loading flow step logs…</p>
            <span>Reading flow.json and log files from the workspace. Steps will appear as they load.</span>
          </div>
          <div v-else class="flow-log-placeholder">
            <i class="ri-terminal-line"></i>
            <p>No flow step log yet</p>
            <span>Unstarted steps are hidden. Logs show up here once a step begins or finishes.</span>
          </div>
        </div>
      </section>

          </SplitterPanel>

          <SplitterPanel :size="55" :minSize="15" class="dashboard-cell">
      <!-- ========== Row 3 Right: Checklist Table ========== -->
      <section class="section-card checklist-area">
        <div class="section-header">
          <div class="header-icon checklist"><i class="ri-checkbox-multiple-line"></i></div>
          <h2>Checklist Table</h2>
          <span class="header-count">{{ checklistCompletedCount }}/{{ checklistItems.length }}</span>
        </div>
        <div class="checklist-content">
          <ChecklistTable
            :items="checklistItems"
            :show-summary="false"
            empty-hint="After running the flow, the checklist will be displayed."
          />
        </div>
      </section>
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>

    <Teleport to="body">
      <Transition name="flow-log-chooser">
        <div
          v-if="isFlowLogStepChooserOpen"
          class="flow-log-chooser-overlay"
          @click="closeFlowLogStepChooser"
        >
          <div
            id="flow-log-step-chooser-dialog"
            ref="flowLogChooserDialogRef"
            class="flow-log-chooser-anchor"
            :style="flowLogChooserAnchorStyle"
            role="dialog"
            aria-modal="true"
            aria-label="Flow step chooser"
            tabindex="-1"
            @click.stop
            @keydown="onFlowLogChooserKeydown"
          >
            <FlowLogStepChooser
              :items="flowLogListItems"
              :selected-key="selectedFlowLogKey"
              :live-key="liveFlowLogKey"
              @close="closeFlowLogStepChooser"
              @jump-live="jumpToLiveStep"
              @select="onSelectFlowLogStep"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== Flow Step Log Fullscreen Overlay ===== -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div
          v-if="isFlowLogFullscreen"
          class="flow-log-fullscreen-overlay"
          @click="closeFlowLogFullscreen"
        >
          <section class="section-card flow-log-fullscreen-card" @click.stop>
            <div class="section-header">
              <div class="header-icon gds"><i class="ri-terminal-line"></i></div>
              <h2>Flow Step Log</h2>
              <span v-if="flowLogStepName" class="header-badge">{{ flowLogStepName }}</span>
              <div class="header-actions">
                <button
                  type="button"
                  class="action-btn flow-log-fullscreen-toggle"
                  title="Exit full screen"
                  aria-label="Exit flow step log full screen"
                  @click="closeFlowLogFullscreen"
                >
                  <i class="ri-fullscreen-exit-line"></i>
                </button>
              </div>
            </div>
            <div class="flow-log-content flow-log-fullscreen-content">
              <div v-if="flowLogError" class="flow-log-error">{{ flowLogError }}</div>
              <div v-else-if="flowLogListItems.length" class="flow-log-layout flow-log-fullscreen-layout">
                <div class="flow-log-viewer-panel">
                  <div class="flow-log-viewer-header">
                    <div class="flow-log-viewer-header-main">
                      <div v-if="selectedFlowLogSegment" class="flow-log-viewer-summary-row">
                        <span class="flow-log-viewer-title">{{ selectedFlowLogSegment.stepName }}</span>
                        <span class="flow-log-viewer-tool">{{ selectedFlowLogSegment.tool }}</span>
                        <span
                          class="flow-log-viewer-state"
                          :class="{ failed: selectedFlowLogSegment.failed, live: selectedFlowLogSegment.live }"
                        >
                          {{ selectedFlowLogSegment.state }}
                        </span>
                        <span v-if="selectedFlowLogSegment.totalSize" class="flow-log-viewer-size">
                          {{ formatKb(selectedFlowLogSegment.totalSize) }}
                        </span>
                        <span
                          v-if="flowLogLoading || loadingSelectedFlowLogKey === selectedFlowLogKey"
                          class="flow-log-viewer-loading"
                        >
                          <i class="ri-loader-4-line spin"></i>
                          {{ flowLogLoading ? 'Updating…' : 'Loading log…' }}
                        </span>
                      </div>
                      <div v-else class="flow-log-viewer-summary-row empty">
                        <span class="flow-log-viewer-title">Current step</span>
                        <span class="flow-log-viewer-tool">Select a step to inspect its output.</span>
                      </div>
                    </div>

                    <div class="flow-log-viewer-actions">
                      <button
                        type="button"
                        class="flow-log-steps-trigger"
                        aria-controls="flow-log-step-chooser-dialog"
                        :aria-expanded="isFlowLogStepChooserOpen ? 'true' : 'false'"
                        aria-haspopup="dialog"
                        :aria-label="isFlowLogStepChooserOpen ? 'Hide flow step chooser' : 'Show flow step chooser'"
                        @click="toggleFlowLogStepChooserFromTrigger"
                      >
                        <i class="ri-list-check"></i>
                        <span>Steps</span>
                      </button>
                      <button
                        v-if="liveFlowLogKey && liveFlowLogKey !== selectedFlowLogKey"
                        type="button"
                        class="flow-log-jump-live-btn"
                        @click="jumpToLiveStep"
                      >
                        <i class="ri-skip-right-line"></i>
                        <span>Jump to live</span>
                      </button>
                      <button
                        v-if="selectedFlowLogSegment?.truncated"
                        type="button"
                        class="flow-log-expand-btn"
                        :disabled="expandingFlowLogKeys[selectedFlowLogKey || '']"
                        :title="`Load full log (${formatKb(selectedFlowLogSegment.totalSize)})`"
                        @click="onExpandFullLog(selectedFlowLogSegment)"
                      >
                        <i
                          :class="[
                            expandingFlowLogKeys[selectedFlowLogKey || '']
                              ? 'ri-loader-4-line flow-log-expand-btn-spinner'
                              : 'ri-expand-up-down-line',
                          ]"
                        ></i>
                        <span v-if="expandingFlowLogKeys[selectedFlowLogKey || '']">Loading full log…</span>
                        <span v-else>Show full log</span>
                      </button>
                    </div>
                  </div>

                  <div class="flow-log-viewer-shell">
                    <FlowLogCodeViewer
                      v-if="selectedFlowLogSegment"
                      :key="`fullscreen-${selectedFlowLogKey ?? 'no-selection'}`"
                      :content="selectedFlowLogContent"
                      :live="Boolean(selectedFlowLogSegment.live)"
                      :missing="selectedFlowLogSegment.missing"
                      :loading="loadingSelectedFlowLogKey === selectedFlowLogKey"
                    />
                    <div v-else class="flow-log-placeholder">
                      <i class="ri-terminal-line"></i>
                      <p>No step selected</p>
                      <span>Open Steps to inspect a log once a flow step is available.</span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else-if="flowLogLoading" class="flow-log-loading">
                <i class="ri-loader-4-line flow-log-loading-icon"></i>
                <p>Loading flow step logs…</p>
                <span>Reading flow.json and log files from the workspace. Steps will appear as they load.</span>
              </div>
              <div v-else class="flow-log-placeholder">
                <i class="ri-terminal-line"></i>
                <p>No flow step log yet</p>
                <span>Unstarted steps are hidden. Logs show up here once a step begins or finishes.</span>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== Layout Fullscreen Overlay ===== -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div v-if="isLayoutFullscreen" class="layout-fullscreen-overlay" @click="closeLayoutFullscreen">
          <section class="section-card layout-fullscreen-card" @click.stop>
            <div class="section-header">
              <div class="header-icon layout"><i class="ri-layout-masonry-line"></i></div>
              <h2>Layout</h2>
              <span class="header-hint">Displays the final step of the layout after the run is completed.</span>
              <div class="header-actions">
                <button class="action-btn" @click="closeLayoutFullscreen" title="Exit full screen">
                  <i class="ri-fullscreen-exit-line"></i>
                </button>
              </div>
            </div>
            <div
              ref="layoutContentRef"
              class="layout-content layout-fullscreen-content"
              @wheel.prevent="onLayoutWheel"
              @mousedown="onLayoutMouseDown"
              @mousemove="onLayoutMouseMove"
              @mouseup="onLayoutMouseUp"
              @mouseleave="onLayoutMouseUp"
            >
              <img
                v-if="layoutBlobUrl"
                :src="layoutBlobUrl"
                alt="Layout Preview"
                class="layout-image layout-fullscreen-image"
                :style="layoutImageTransform"
                draggable="false"
              />
              <div v-else class="layout-placeholder">
                <i class="ri-image-2-line"></i>
                <p>Layout Preview</p>
                <span>Waiting for layout data...</span>
              </div>
              <div v-if="layoutBlobUrl" class="zoom-indicator">
                {{ Math.round(layoutScale * 100) }}%
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== 图表预览 Lightbox ===== -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div v-if="chartPreview.visible" class="chart-lightbox-overlay" @click="closeChartPreview">
          <div class="chart-lightbox-content" @click.stop>
            <div class="chart-lightbox-header">
              <span class="chart-lightbox-title">{{ chartPreview.label }}</span>
              <button class="chart-lightbox-close" @click="closeChartPreview">
                <i class="ri-close-line"></i>
              </button>
            </div>
            <div class="chart-lightbox-body">
              <img :src="chartPreview.url" :alt="chartPreview.label" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script lang="ts">
export interface FlowLogChooserEscapeEvent {
  key: string
  preventDefault?: () => void
}

export interface FlowLogChooserController {
  selectedFlowLogKey: string | null
  isFlowLogStepChooserOpen: boolean
  toggleFlowLogStepChooser: () => void
  closeFlowLogStepChooser: () => void
  onSelectFlowLogStep: (key: string) => void
  jumpToLiveStep: (liveKey: string | null) => void
  onFlowLogChooserEscape: (event: FlowLogChooserEscapeEvent) => void
}

export function createFlowLogChooserController(initialSelectedKey: string | null = null): FlowLogChooserController {
  const controller: FlowLogChooserController = {
    selectedFlowLogKey: initialSelectedKey,
    isFlowLogStepChooserOpen: false,
    toggleFlowLogStepChooser(this: FlowLogChooserController) {
      this.isFlowLogStepChooserOpen = !this.isFlowLogStepChooserOpen
    },
    closeFlowLogStepChooser(this: FlowLogChooserController) {
      this.isFlowLogStepChooserOpen = false
    },
    onSelectFlowLogStep(this: FlowLogChooserController, key: string) {
      this.selectedFlowLogKey = key
      this.closeFlowLogStepChooser()
    },
    jumpToLiveStep(this: FlowLogChooserController, liveKey: string | null) {
      if (!liveKey) return
      this.selectedFlowLogKey = liveKey
      this.closeFlowLogStepChooser()
    },
    onFlowLogChooserEscape(this: FlowLogChooserController, event: FlowLogChooserEscapeEvent) {
      if (event.key !== 'Escape' || !this.isFlowLogStepChooserOpen) return
      if (typeof event.preventDefault === 'function') {
        event.preventDefault()
      }
      this.closeFlowLogStepChooser()
    },
  }

  return controller
}

export interface FlowLogChooserRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface FlowLogChooserViewport {
  width: number
  height: number
}

export interface FlowLogChooserSize {
  width: number
  height: number
}

export interface FlowLogChooserAnchorStyle {
  left: string
  top: string
  transformOrigin: string
}

const FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX = 20
const FLOW_LOG_CHOOSER_GAP_PX = 8
const FLOW_LOG_CHOOSER_FALLBACK_WIDTH_PX = 320
const FLOW_LOG_CHOOSER_FALLBACK_HEIGHT_PX = 320

export function computeFlowLogChooserAnchorStyle(
  triggerRect: FlowLogChooserRect,
  viewport: FlowLogChooserViewport,
  chooserSize: FlowLogChooserSize,
): FlowLogChooserAnchorStyle {
  const width = chooserSize.width || FLOW_LOG_CHOOSER_FALLBACK_WIDTH_PX
  const height = chooserSize.height || FLOW_LOG_CHOOSER_FALLBACK_HEIGHT_PX
  const maxLeft = Math.max(FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX, viewport.width - width - FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX)
  const preferredLeft = triggerRect.right - width
  const left = Math.min(Math.max(FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX, preferredLeft), maxLeft)

  const spaceBelow = viewport.height - triggerRect.bottom - FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX
  const spaceAbove = triggerRect.top - FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX
  const placeBelow = spaceBelow >= height || spaceBelow >= spaceAbove
  const preferredTop = placeBelow
    ? triggerRect.bottom + FLOW_LOG_CHOOSER_GAP_PX
    : triggerRect.top - height - FLOW_LOG_CHOOSER_GAP_PX
  const maxTop = Math.max(FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX, viewport.height - height - FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX)
  const top = Math.min(Math.max(FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX, preferredTop), maxTop)

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    transformOrigin: placeBelow ? 'top right' : 'bottom right',
  }
}
</script>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick, toRef } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import FlowLogCodeViewer from '@/components/FlowLogCodeViewer.vue'
import FlowLogStepChooser from '@/components/FlowLogStepChooser.vue'
import ChecklistTable from '@/components/ChecklistTable.vue'
import { useParameters } from '@/composables/useParameters'
import { useHomeData, type AnalysisChartItem, type FlowLogSegment } from '@/composables/useHomeData'
import { isChecklistPassed } from '@/utils/checklistState'
import { isWindowResizing } from '@/composables/useWindowResizeState'
import {
  flowLogStepKey,
  getDefaultSelectedFlowLogKey,
  reconcileSelectedFlowLogKey,
  toFlowLogListItems,
} from './homeViewFlowLogSelection'
import { ensureMonitorChartInstance } from './homeMonitorCharts'

// 注册 ECharts 组件（按需引入）
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const { config } = useParameters()
const {
  monitorData,
  checklistItems,
  layoutBlobUrl,
  analysisCharts,
  flowLogSegments,
  flowLogContentByKey,
  flowLogStepName,
  flowLogError,
  flowLogLoading,
  currentWorkspaceFlowExecutionActive,
  ensureFlowLogSegmentContentLoaded,
  expandFlowLogSegment,
} = useHomeData()

/** 正在展开完整日志的 step key 集合，避免同一步连点多次以及按钮 loading 状态 */
const expandingFlowLogKeys = reactive<Record<string, boolean>>({})

function formatKb(totalChars: number | undefined): string {
  if (!totalChars || totalChars <= 0) return '?'
  const kb = totalChars / 1024
  if (kb < 1) return `${totalChars} B`
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

async function onExpandFullLog(seg: FlowLogSegment): Promise<void> {
  const key = flowLogStepKey(seg)
  if (expandingFlowLogKeys[key]) return
  expandingFlowLogKeys[key] = true
  try {
    await expandFlowLogSegment(seg)
  } finally {
    expandingFlowLogKeys[key] = false
  }
}

const flowLogListItems = computed(() => toFlowLogListItems(flowLogSegments.value))
const flowLogChooser = reactive(createFlowLogChooserController(getDefaultSelectedFlowLogKey(flowLogSegments.value)))
const selectedFlowLogKey = toRef(flowLogChooser, 'selectedFlowLogKey')
const isFlowLogStepChooserOpen = toRef(flowLogChooser, 'isFlowLogStepChooserOpen')
const flowLogChooserDialogRef = ref<HTMLElement | null>(null)
const flowLogStepChooserTriggerRef = ref<HTMLButtonElement | null>(null)
const flowLogChooserAnchorStyle = ref<FlowLogChooserAnchorStyle>({
  left: `${FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX}px`,
  top: `${FLOW_LOG_CHOOSER_VIEWPORT_PADDING_PX}px`,
  transformOrigin: 'top right',
})
const loadingSelectedFlowLogKey = ref<string | null>(null)
const liveFlowLogKey = computed(() => {
  const liveSegment = flowLogSegments.value.find((segment) => segment.live)
  return liveSegment ? flowLogStepKey(liveSegment) : null
})
const selectedFlowLogSegment = computed(() => {
  if (!selectedFlowLogKey.value) return null
  return flowLogSegments.value.find((segment) => flowLogStepKey(segment) === selectedFlowLogKey.value) ?? null
})
const selectedFlowLogContent = computed(() => {
  if (!selectedFlowLogKey.value) return ''
  return flowLogContentByKey.value[selectedFlowLogKey.value] ?? ''
})
const flowLogSelectionSignature = computed(() =>
  flowLogSegments.value
    .map((segment) => [
      flowLogStepKey(segment),
      segment.state,
      segment.live ? '1' : '0',
    ].join(':'))
    .join('\u001e'),
)

function toggleFlowLogStepChooser(): void {
  flowLogChooser.toggleFlowLogStepChooser()
}

function toggleFlowLogStepChooserFromTrigger(event: MouseEvent): void {
  if (event.currentTarget instanceof HTMLButtonElement) {
    flowLogStepChooserTriggerRef.value = event.currentTarget
  }
  toggleFlowLogStepChooser()
}

function closeFlowLogStepChooser(): void {
  flowLogChooser.closeFlowLogStepChooser()
}

function onFlowLogChooserKeydown(event: KeyboardEvent): void {
  flowLogChooser.onFlowLogChooserEscape(event)
}

function onSelectFlowLogStep(key: string): void {
  flowLogChooser.onSelectFlowLogStep(key)
}

function jumpToLiveStep(): void {
  flowLogChooser.jumpToLiveStep(liveFlowLogKey.value)
}

function updateFlowLogChooserAnchorPosition(): void {
  const trigger = flowLogStepChooserTriggerRef.value
  const dialog = flowLogChooserDialogRef.value
  if (!trigger || !dialog || typeof window === 'undefined') return

  const triggerRect = trigger.getBoundingClientRect()
  const dialogRect = dialog.getBoundingClientRect()
  flowLogChooserAnchorStyle.value = computeFlowLogChooserAnchorStyle(
    triggerRect,
    {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    {
      width: dialogRect.width,
      height: dialogRect.height,
    },
  )
}

watch(
  [flowLogSelectionSignature, currentWorkspaceFlowExecutionActive],
  ([, isFlowRunning]) => {
    selectedFlowLogKey.value = reconcileSelectedFlowLogKey(
      flowLogSegments.value,
      selectedFlowLogKey.value,
      { preferLive: isFlowRunning },
    )
  },
  { immediate: true },
)

watch(
  isFlowLogStepChooserOpen,
  async (isOpen, wasOpen) => {
    await nextTick()
    if (isOpen) {
      requestAnimationFrame(() => {
        updateFlowLogChooserAnchorPosition()
        flowLogChooserDialogRef.value?.focus()
      })
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', updateFlowLogChooserAnchorPosition)
      }
      return
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', updateFlowLogChooserAnchorPosition)
    }
    if (wasOpen) {
      flowLogStepChooserTriggerRef.value?.focus()
    }
  },
)

watch(
  selectedFlowLogSegment,
  async (segment) => {
    if (!segment) {
      loadingSelectedFlowLogKey.value = null
      return
    }
    if (segment.live && !selectedFlowLogContent.value) {
      if (loadingSelectedFlowLogKey.value === flowLogStepKey(segment)) {
        loadingSelectedFlowLogKey.value = null
      }
      return
    }
    if (selectedFlowLogContent.value || segment.missing) {
      if (loadingSelectedFlowLogKey.value === flowLogStepKey(segment)) {
        loadingSelectedFlowLogKey.value = null
      }
      return
    }

    const key = flowLogStepKey(segment)
    loadingSelectedFlowLogKey.value = key
    try {
      await ensureFlowLogSegmentContentLoaded(segment)
    } finally {
      if (loadingSelectedFlowLogKey.value === key) {
        loadingSelectedFlowLogKey.value = null
      }
    }
  },
  { immediate: true },
)

// checklist 完成计数
const checklistCompletedCount = computed(() =>
  checklistItems.value.filter(item => isChecklistPassed(item.state)).length
)

// ============ Layout 全屏 & 缩放平移 ============
const layoutContentRef = ref<HTMLElement>()
const isLayoutFullscreen = ref(false)
const isFlowLogFullscreen = ref(false)

// 缩放 & 平移状态
const layoutScale = ref(1)
const layoutTranslateX = ref(0)
const layoutTranslateY = ref(0)
// isDragging 必须是 ref，否则 layoutImageTransform 的 computed 不会在拖动时重算，
// cursor 会卡在 'grab' 上。
const isDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragStartTX = 0
let dragStartTY = 0

const layoutImageTransform = computed(() => {
  if (!isLayoutFullscreen.value) return {}
  return {
    transform: `translate(${layoutTranslateX.value}px, ${layoutTranslateY.value}px) scale(${layoutScale.value})`,
    transformOrigin: 'center center',
    cursor: isDragging.value ? 'grabbing' : (layoutScale.value > 1 ? 'grab' : 'default'),
    // 拖动时关闭 transition：每帧 mousemove 都会设置新 transform，
    // 留着 transition 反而让手感"延迟一帧"
    transition: isDragging.value ? 'none' : undefined,
    willChange: 'transform',
  }
})

function resetLayoutTransform() {
  layoutScale.value = 1
  layoutTranslateX.value = 0
  layoutTranslateY.value = 0
}

function toggleLayoutFullscreen() {
  isLayoutFullscreen.value = !isLayoutFullscreen.value
  if (!isLayoutFullscreen.value) {
    resetLayoutTransform()
  }
}

function closeLayoutFullscreen() {
  if (!isLayoutFullscreen.value) return
  isLayoutFullscreen.value = false
  resetLayoutTransform()
}

function toggleFlowLogFullscreen() {
  isFlowLogFullscreen.value = !isFlowLogFullscreen.value
}

function closeFlowLogFullscreen() {
  isFlowLogFullscreen.value = false
}

function onFullscreenKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  flowLogChooser.onFlowLogChooserEscape(e)
  if (e.defaultPrevented) return
  if (chartPreview.value.visible) {
    closeChartPreview()
    e.preventDefault()
    return
  }
  if (isLayoutFullscreen.value) {
    closeLayoutFullscreen()
    e.preventDefault()
    return
  }
  if (isFlowLogFullscreen.value) {
    closeFlowLogFullscreen()
    e.preventDefault()
  }
}

function onLayoutWheel(e: WheelEvent) {
  if (!isLayoutFullscreen.value) return

  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const newScale = Math.min(Math.max(layoutScale.value + delta, 0.1), 20)

  // 以鼠标位置为中心缩放
  const container = layoutContentRef.value
  if (container) {
    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left - rect.width / 2
    const mouseY = e.clientY - rect.top - rect.height / 2

    const scaleFactor = newScale / layoutScale.value
    layoutTranslateX.value = mouseX - scaleFactor * (mouseX - layoutTranslateX.value)
    layoutTranslateY.value = mouseY - scaleFactor * (mouseY - layoutTranslateY.value)
  }

  layoutScale.value = newScale
}

function onLayoutMouseDown(e: MouseEvent) {
  if (!isLayoutFullscreen.value || layoutScale.value <= 1) return
  isDragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartTX = layoutTranslateX.value
  dragStartTY = layoutTranslateY.value
}

function onLayoutMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  layoutTranslateX.value = dragStartTX + (e.clientX - dragStartX)
  layoutTranslateY.value = dragStartTY + (e.clientY - dragStartY)
}

function onLayoutMouseUp() {
  isDragging.value = false
}

// ============ ECharts 折线图 ============

// 动态图表 ref & 实例管理
const chartRefs = new Map<string, HTMLDivElement>()
const chartInstances = new Map<string, echarts.ECharts>()
/** 已经完成首次 setOption 的实例集合；之后的更新走增量路径 */
const chartInitialized = new WeakSet<echarts.ECharts>()

// ResizeObserver
let resizeObserver: ResizeObserver | null = null
/** ResizeObserver 合并多个 entry 到单次 rAF，避免同一帧里反复 init + resize */
let pendingResizeRaf: number | null = null
let pendingDashboardSettleRaf: number | null = null

/** 预置配色盘 —— 按 key 出现顺序循环取色 */
const COLOR_PALETTE = [
  '#ef4444', '#3b82f6', '#10b981', '#a855f7',
  '#f59e0b', '#06b6d4', '#ec4899', '#84cc16',
]

/** 从 monitorData 动态提取除 step 以外的所有指标 key */
const monitorKeys = computed<string[]>(() => {
  if (!monitorData.value) return []
  return Object.keys(monitorData.value).filter(k => k !== 'step')
})

/** 动态生成图表配置列表 */
const chartConfigs = computed(() => {
  return monitorKeys.value.map((key, idx) => ({
    key,
    label: key,
    color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
  }))
})

/** 设置图表 DOM ref 的回调（用于 v-for 中的 :ref） */
function setChartRef(key: string) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (el instanceof HTMLDivElement) {
      chartRefs.set(key, el)
    } else {
      chartRefs.delete(key)
    }
  }
}

/** 将 "h:m:s" 格式的时间字符串转换为秒数 */
function parseTimeToSeconds(val: string): number {
  const parts = val.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(val) || 0
}

/** 判断一个值数组是否全部为 "h:m:s" 格式的时间字符串 */
function isTimeFormatArray(arr: any[]): boolean {
  return arr.length > 0 && arr.every(v => typeof v === 'string' && /^\d+:\d+:\d+$/.test(v))
}

/** 获取某个维度的数值数组（自动检测字符串/数字） */
function getMetricValues(key: string): number[] {
  if (!monitorData.value) return []
  const raw = (monitorData.value as Record<string, any>)[key]
  if (!raw || !Array.isArray(raw)) return []

  // 时间格式 "h:m:s" → 秒数
  if (isTimeFormatArray(raw)) {
    return raw.map(parseTimeToSeconds)
  }
  // 字符串数字 → Number
  return raw.map((v: any) => Number(v) || 0)
}

/** 获取某个维度的最大值显示 */
function getMetricMax(key: string): string {
  const values = getMetricValues(key)
  if (values.length === 0) return '--'
  const max = Math.max(...values)
  // 整数显示为整数，小数保留 1 位
  return Number.isInteger(max) ? `${max}` : `${max.toFixed(1)}`
}

/** 获取某个维度的原始显示值 */
function getMetricDisplay(key: string, idx: number): string {
  if (!monitorData.value) return '--'
  const raw = (monitorData.value as Record<string, any>)[key]
  if (!raw || !Array.isArray(raw) || raw[idx] == null) return '--'
  const v = raw[idx]
  // 如果原始值是字符串（如 "h:m:s"），直接展示
  if (typeof v === 'string') return v
  // 数字：整数原样，小数保留 1 位
  return Number.isInteger(v) ? `${v}` : `${Number(v).toFixed(1)}`
}

/** 构建所有图表共享的 tooltip formatter（动态根据 monitorKeys 生成） */
function buildSharedTooltipFormatter(params: any): string {
  const idx = params[0]?.dataIndex ?? 0
  const steps = monitorData.value?.step || []
  const stepName = steps[idx] || `Step #${idx}`

  const configs = chartConfigs.value
  const rows = configs.map(cfg => {
    const value = getMetricDisplay(cfg.key, idx)
    return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
       <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${cfg.color}"></span>
       <span style="flex:1;color:#aaa">${cfg.label}</span>
       <span style="font-weight:600;color:#e5e5e5;font-family:'JetBrains Mono',monospace">${value}</span>
     </div>`
  }).join('')

  return `<div style="font-size:11px;font-weight:700;margin-bottom:4px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px">${stepName}</div>
          <div style="font-size:10px">${rows}</div>`
}

/** 构建单个折线图的 option */
function buildChartOption(key: string, color: string): echarts.EChartsCoreOption {
  const values = getMetricValues(key)
  const steps = monitorData.value?.step || []

  return {
    grid: {
      left: 4,
      right: 4,
      top: 6,
      bottom: 6,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      backgroundColor: 'rgba(20, 20, 24, 0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderRadius: 6,
      padding: [8, 10],
      extraCssText: 'pointer-events: none;',
      textStyle: {
        color: '#e5e5e5',
        fontSize: 10,
      },
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: 'rgba(255,255,255,0.15)',
          type: 'dashed',
        },
      },
      formatter: buildSharedTooltipFormatter,
    },
    xAxis: {
      type: 'category',
      show: false,
      data: steps,
      boundaryGap: false,
      axisPointer: {
        show: true,
      },
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: true,
        showAllSymbol: true,
        itemStyle: {
          color,
          borderColor: '#fff',
          borderWidth: 1.5,
        },
        emphasis: {
          itemStyle: {
            color,
            borderColor: '#fff',
            borderWidth: 2,
            shadowColor: color + '80',
            shadowBlur: 8,
          },
          scale: 1.8,
        },
        lineStyle: {
          color,
          width: 2,
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + '30' },
            { offset: 1, color: color + '05' },
          ]),
        },
      },
    ],
    animation: true,
    animationDuration: 600,
  }
}

/** 获取所有已初始化的图表实例 */
function getAllChartInstances(): echarts.ECharts[] {
  return Array.from(chartInstances.values())
}

/** 图表联动分组 ID —— 同组图表的 axisPointer 自动同步 */
const CHART_GROUP = 'monitor-linked'

/** 当前鼠标所在的图表实例，用于控制仅在悬浮图表上显示 tooltip 内容 */
let activeChartInstance: echarts.ECharts | null = null

/**
 * 为图表绑定联动事件。
 * 使用 echarts.connect 实现轴指针自动同步（数据索引精确对齐），
 * 并通过动态切换 showContent 控制仅在悬浮图表上显示 tooltip。
 */
function bindChartLinkEvents(instance: echarts.ECharts) {
  // 加入联动分组，轴指针 & 高亮自动同步到同组所有图表
  instance.group = CHART_GROUP

  // 鼠标进入此图表时：仅此图表显示 tooltip 内容，其余图表隐藏内容
  instance.getZr().on('mousemove', () => {
    if (activeChartInstance === instance) return
    activeChartInstance = instance
    for (const chart of getAllChartInstances()) {
      chart.setOption(
        { tooltip: { showContent: chart === instance } },
        { lazyUpdate: true },
      )
    }
  })

  // 鼠标离开此图表
  instance.getZr().on('globalout', () => {
    if (activeChartInstance === instance) {
      activeChartInstance = null
    }
  })
}

/**
 * 构建仅包含 series data 的最小化 option patch，用于增量更新。
 * 相比 buildChartOption 全量替换，能省掉 grid/tooltip/axis 等配置的 diff。
 */
function buildChartDataPatch(key: string): echarts.EChartsCoreOption {
  const values = getMetricValues(key)
  const steps = monitorData.value?.step || []
  return {
    xAxis: { data: steps },
    series: [{ data: values }],
  }
}

/** 初始化或更新所有图表 */
function initOrUpdateCharts() {
  let newInstanceCreated = false

  for (const cfg of chartConfigs.value) {
    const el = chartRefs.get(cfg.key)
    if (!el) continue

    // 跳过尺寸为 0 的元素，等待 ResizeObserver 回调再初始化
    if (!el.clientWidth || !el.clientHeight) continue

    const { instance, created } = ensureMonitorChartInstance(
      cfg.key,
      el,
      chartInstances,
      (target) => echarts.init(target, undefined, { renderer: 'canvas' }),
      bindChartLinkEvents,
    )
    if (created) {
      newInstanceCreated = true
    }

    if (!chartInitialized.has(instance)) {
      // 首次：全量 option + 触发入场动画
      instance.setOption(buildChartOption(cfg.key, cfg.color), true)
      chartInitialized.add(instance)
    } else {
      // 之后：只更新数据，保留轴/tooltip/样式配置，跳过入场动画避免抖动
      instance.setOption(buildChartDataPatch(cfg.key), {
        notMerge: false,
        lazyUpdate: true,
      })
    }
  }

  // 有新图表加入分组时，重新注册 connect 以确保联动生效
  if (newInstanceCreated) {
    echarts.connect(CHART_GROUP)
  }
}

/** 销毁所有图表 */
function disposeCharts() {
  for (const instance of chartInstances.values()) {
    instance.dispose()
  }
  chartInstances.clear()
}

/** 所有图表 resize */
function resizeAllCharts() {
  for (const instance of chartInstances.values()) {
    instance.resize()
  }
}

function onDashboardSplitterResizeEnd() {
  if (pendingDashboardSettleRaf !== null) {
    cancelAnimationFrame(pendingDashboardSettleRaf)
  }

  pendingDashboardSettleRaf = requestAnimationFrame(() => {
    pendingDashboardSettleRaf = requestAnimationFrame(() => {
      pendingDashboardSettleRaf = null
      if (monitorData.value) initOrUpdateCharts()
      resizeAllCharts()
    })
  })
}

/**
 * 监听图表容器尺寸变化，处理首次初始化和 resize。
 *
 * 合并策略：
 *  - 多个 entry 同帧触发时合并为一次 rAF 回调
 *  - 窗口缩放期间（isWindowResizing=true）**完全跳过** canvas 重绘：
 *    ECharts 的 canvas 会被 CSS 自然拉伸展示，拖动手感最滑。
 *    缩放结束时由下方 `watch(isWindowResizing)` 再做一次清晰重绘。
 */
function setupResizeObserver() {
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => {
    if (pendingResizeRaf !== null) return
    pendingResizeRaf = requestAnimationFrame(() => {
      pendingResizeRaf = null
      // 窗口正在缩放：完全跳过图表工作。canvas 由 CSS 自然拉伸，
      // 之前还跑 initOrUpdateCharts 是为了 cover 首次 init，但那个
      // 新容器也完全可以推迟到 resize 结束后的 watcher 里统一 init，
      // 省下每帧的 setOption diff（长序列下这个 diff 不便宜）。
      if (isWindowResizing.value) return
      if (monitorData.value) initOrUpdateCharts()
      resizeAllCharts()
    })
  })

  for (const el of chartRefs.values()) {
    if (el) resizeObserver.observe(el)
  }
}

// 窗口缩放结束的瞬间把所有 canvas 按当前容器尺寸一次性清晰重绘；
// 拖拽过程中累计的尺寸变化都在这里"补上"，顺带 init 在 resize
// 期间才第一次拿到尺寸的新图表容器。
watch(isWindowResizing, (resizing) => {
  if (resizing) return
  if (pendingResizeRaf !== null) {
    cancelAnimationFrame(pendingResizeRaf)
    pendingResizeRaf = null
  }
  // 使用 rAF 而非同步调用，确保此时布局已稳定
  requestAnimationFrame(() => {
    if (monitorData.value) initOrUpdateCharts()
    resizeAllCharts()
  })
})

/**
 * 监听 monitorData 变化更新图表。
 * useHomeData 每次都会给 monitorData.value 赋值新对象，浅层 watch 即可触发；
 * 避免原先 deep: true 对 MonitorData 里的每个数组递归 traverse —— 数据量大时
 * 这一步会明显消耗主线程。
 */
watch(monitorData, async () => {
  await nextTick()
  setupResizeObserver()
  initOrUpdateCharts()
})

onMounted(async () => {
  await nextTick()
  setupResizeObserver()
  if (monitorData.value) {
    initOrUpdateCharts()
  }
  document.addEventListener('keydown', onFullscreenKeydown)
})

onUnmounted(() => {
  disposeCharts()
  resizeObserver?.disconnect()
  resizeObserver = null
  if (pendingResizeRaf !== null) {
    cancelAnimationFrame(pendingResizeRaf)
    pendingResizeRaf = null
  }
  if (pendingDashboardSettleRaf !== null) {
    cancelAnimationFrame(pendingDashboardSettleRaf)
    pendingDashboardSettleRaf = null
  }
  document.removeEventListener('keydown', onFullscreenKeydown)
})

// ============ 指标分析 ============
// analysisCharts 数据从 useHomeData() 动态获取（基于 home.json 的 metrics 字段）

// 图表预览 Lightbox
const chartPreview = ref<{ visible: boolean; url: string; label: string }>({
  visible: false,
  url: '',
  label: '',
})

function openChartPreview(url: string, label: string) {
  chartPreview.value = { visible: true, url, label }
}

function onAnalysisChartClick(chart: AnalysisChartItem) {
  if (!chart.imageBlobUrl) return
  openChartPreview(chart.imageBlobUrl, chart.label)
}

function closeChartPreview() {
  chartPreview.value.visible = false
}

</script>

<style scoped>
/* ==================== 基础布局 ==================== */
.home-view {
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--bg-primary);
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(var(--accent-rgb, 59, 130, 246), 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.03) 1px, transparent 1px);
  background-size: 32px 32px;
  pointer-events: none;
}

/* ==================== Dashboard Splitter ==================== */
.dashboard-splitter {
  position: relative;
  z-index: 1;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  background: transparent;
  border: none;
  border-radius: 0;
  box-sizing: border-box;
}

/*
 * 行/列面板需要提供一个确定的 block，内部的 section-card 才能 height:100%。
 * PrimeVue 的 SplitterPanel 默认是 flex 容器，这里显式交代 min 尺寸避免
 * 内容强行撑开破坏拖拽比例。
 */
.dashboard-splitter :deep(.p-splitterpanel.dashboard-row),
.dashboard-splitter :deep(.p-splitterpanel.dashboard-cell) {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.dashboard-row-splitter {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

/* SplitterPanel 只放一个 section-card，让 card 100% 填满面板 */
.dashboard-splitter :deep(.p-splitterpanel.dashboard-cell) > .section-card {
  flex: 1;
  width: 100%;
  height: 100%;
}

/* Splitter 拖拽条：窄、低调，hover 时变为主题色 */
.dashboard-splitter :deep(.p-splitter-gutter) {
  background: transparent;
  position: relative;
  transition: background 0.15s ease;
}

.dashboard-splitter :deep(.p-splitter-gutter::after) {
  content: '';
  position: absolute;
  background: var(--border-color);
  border-radius: 2px;
  transition: background 0.15s ease;
}

/* 垂直布局的 gutter 水平条 */
.dashboard-splitter > :deep(.p-splitter-gutter) {
  height: 6px;
}
.dashboard-splitter > :deep(.p-splitter-gutter::after) {
  left: 50%;
  top: 50%;
  width: 48px;
  height: 2px;
  transform: translate(-50%, -50%);
}

/* 横向行内的 gutter 竖直条 */
.dashboard-row-splitter > :deep(.p-splitter-gutter) {
  width: 6px;
}
.dashboard-row-splitter > :deep(.p-splitter-gutter::after) {
  top: 50%;
  left: 50%;
  width: 2px;
  height: 48px;
  transform: translate(-50%, -50%);
}

.dashboard-splitter :deep(.p-splitter-gutter:hover),
.dashboard-splitter :deep(.p-splitter-gutter[data-p-gutter-resizing="true"]) {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.dashboard-splitter :deep(.p-splitter-gutter:hover::after),
.dashboard-splitter :deep(.p-splitter-gutter[data-p-gutter-resizing="true"]::after) {
  background: var(--accent-color);
  box-shadow: 0 0 8px rgba(var(--accent-rgb, 59, 130, 246), 0.45);
}

.dashboard-splitter :deep(.p-splitter-gutter-handle) {
  display: none;
}

.layout-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 19990;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: 12px;
  background: rgba(0, 0, 0, 0.78);
  box-sizing: border-box;
}

.flow-log-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 19995;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: 12px;
  background: rgba(0, 0, 0, 0.78);
  box-sizing: border-box;
}

.layout-fullscreen-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-radius: 0;
  background: var(--bg-primary);
}

.flow-log-fullscreen-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-radius: 0;
  background: var(--bg-primary);
}

.layout-fullscreen-content {
  margin: 0;
  border: none;
  border-radius: 0;
  overflow: hidden;
  position: relative;
  background-image: none;
}

.layout-fullscreen-image {
  object-fit: contain;
  /*
   * 仅在滚轮缩放时给 50ms 缓动，拖动时由 inline style 设为 'none'，
   * 避免 transition 打断每帧 mousemove 造成视觉拖尾。
   */
  transition: transform 0.05s ease-out;
  user-select: none;
  will-change: transform;
}

/* 缩放百分比指示器 */
.zoom-indicator {
  position: absolute;
  bottom: 12px;
  right: 12px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.6);
  color: #e5e5e5;
  font-size: 11px;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  border-radius: 4px;
  pointer-events: none;
  z-index: 10;
}

.analysis-area {
  position: relative;
  z-index: 2;
}

/* ==================== Section Card 通用样式 ==================== */
.section-card {
  background: var(--bg-secondary);
  border: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.2);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  position: relative;
  box-shadow: inset 0 0 20px rgba(var(--accent-rgb, 59, 130, 246), 0.02);
  /*
   * 告诉浏览器：卡片内部的布局 / 绘制 / 样式变化都不会影响外部。
   * 这样 dashboard-grid 的尺寸改变时，浏览器只需对变化的卡片内部重排，
   * 不用把重排向上传播到整个页面，对 grid 布局场景尤其显著。
   */
  contain: layout paint style;
}

/* HUD 瞄准框角标 */
.section-card::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to right, var(--accent-color) 2px, transparent 2px) 0 0,
    linear-gradient(to bottom, var(--accent-color) 2px, transparent 2px) 0 0,
    linear-gradient(to left, var(--accent-color) 2px, transparent 2px) 100% 0,
    linear-gradient(to bottom, var(--accent-color) 2px, transparent 2px) 100% 0,
    linear-gradient(to right, var(--accent-color) 2px, transparent 2px) 0 100%,
    linear-gradient(to top, var(--accent-color) 2px, transparent 2px) 0 100%,
    linear-gradient(to left, var(--accent-color) 2px, transparent 2px) 100% 100%,
    linear-gradient(to top, var(--accent-color) 2px, transparent 2px) 100% 100%;
  background-repeat: no-repeat;
  background-size: 8px 8px;
  opacity: 0.6;
  z-index: 10;
}

/* Section Header */
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: transparent;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 16px;
  flex-shrink: 0;
}

.section-header h2 {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-badge {
  padding: 2px 8px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  flex-shrink: 0;
}

.header-hint {
  font-size: 9px;
  color: var(--text-secondary);
  opacity: 0.7;
  white-space: nowrap;
}

.header-count {
  padding: 2px 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.action-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
  font-size: 11px;
}

.action-btn:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

/* ==================== Chip Basic Info ==================== */
.chip-info-content {
  flex: 1;
  padding: 10px;
  overflow: auto;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  height: 100%;
}

.info-item {
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  transition: border-color 0.15s ease;
}

.info-item:hover {
  border-color: var(--accent-color);
}

.info-label {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
}

.info-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

html.dark .info-value {
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.15);
}

.info-value.highlight {
  color: var(--accent-color);
  text-shadow: 0 0 10px rgba(var(--accent-rgb, 59, 130, 246), 0.4);
}

html.dark .info-value.highlight {
  text-shadow: 0 0 12px rgba(var(--accent-rgb, 59, 130, 246), 0.8);
}

.info-value.mono {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.info-value small {
  font-size: 9px;
  font-weight: 500;
  opacity: 0.7;
}

/* ==================== 运行时监控 ==================== */
.monitor-content {
  flex: 1;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
}

.monitor-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  min-height: 0;
}

.monitor-label {
  width: 100px;
  font-size: 9px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.monitor-chart-wrap {
  flex: 1;
  height: 100%;
  min-height: 24px;
  min-width: 0;
  /*
   * 图表容器内只有一个 canvas，隔离它的布局/绘制不影响外部。
   * 不使用 `contain: size`，避免 flex 计算时容器被当成 0 尺寸。
   */
  contain: layout paint style;
}

.monitor-chart {
  width: 100%;
  height: 100%;
  min-height: 24px;
}

.monitor-value {
  min-width: 80px;
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
}

html.dark .monitor-value {
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.15);
}

.monitor-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.monitor-placeholder i {
  font-size: 28px;
  color: var(--text-secondary);
  opacity: 0.3;
}

.monitor-placeholder p {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.monitor-placeholder span {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
}

/* ==================== Layout Preview ==================== */
.layout-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-primary);
  background-image:
    linear-gradient(rgba(var(--accent-rgb, 59, 130, 246), 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.08) 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: center center;
  margin: 8px;
  border-radius: 4px;
  border: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.15);
  overflow: hidden;
  position: relative;
}

.scanner-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-color);
  box-shadow: 0 0 15px 3px rgba(var(--accent-rgb, 59, 130, 246), 0.4), 0 0 30px 6px rgba(var(--accent-rgb, 59, 130, 246), 0.2);
  opacity: 0.8;
  animation: scan-animation 3.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  will-change: transform, opacity;
  pointer-events: none;
  z-index: 5;
}

@keyframes scan-animation {
  0% { transform: translateY(-10px); opacity: 0; }
  10% { opacity: 0.8; }
  90% { opacity: 0.8; }
  100% { transform: translateY(100vh); opacity: 0; }
}

.layout-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.02) 1px, transparent 1px),
    linear-gradient(rgba(var(--accent-rgb, 59, 130, 246), 0.02) 1px, transparent 1px);
  background-size: 16px 16px;
}

.layout-placeholder i {
  font-size: 36px;
  color: var(--text-secondary);
  opacity: 0.3;
}

.layout-placeholder p {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.layout-placeholder span {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
}

.layout-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  /* 让浏览器尽量为这张图建立独立合成层，resize 时不会反复重采样 */
  will-change: transform;
}

/* ==================== 指标分析 ==================== */
.analysis-content {
  flex: 1;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}

/*
 * 关键点：
 * 1) 用 minmax(0, 1fr) 代替裸 1fr。裸 1fr 等价于 minmax(auto, 1fr)，
 *    会把 track 的下限抬到子元素的最小内容尺寸 —— 指标图片的固有大小
 *    会反向把某一行顶大、另一行挤成细条。
 * 2) grid-auto-rows 也用 minmax(0, 1fr) 兜底：万一卡片数量 × 列数组合
 *    意外创建了第 3 行（例如 7 个卡片 + 3 列），这一行默认 auto 又会被
 *    图片固有尺寸撑开，引发和 (1) 同类的错位。
 */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: 6px;
  height: 100%;
}

/*
 * 仅当恰好有 7 个卡片（且 7 是最后一个）时，让第 7 个跨占 4 列布局下
 * 第二行剩下的两列。其它数量（5/6/7 在 3 列下等）让其走自动排布，
 * 否则 grid-column: 1 会和第 4 个卡片的默认位置冲突，把第 5 个挤到新行。
 */
.chart-card:nth-child(7):last-child {
  grid-column: 3 / 5;
}

.chart-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  min-width: 0;
  min-height: 0;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  cursor: pointer;
  overflow: hidden;
  /* 指标图表卡片内容不影响外部，resize 时也不会牵连兄弟卡片重排 */
  contain: layout paint style;
}

.chart-card:hover {
  border-color: var(--accent-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

html.dark .chart-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.chart-visual {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: 0;
  font-size: 28px;
  color: var(--text-secondary);
  background-color: #ffffff;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  padding: 4px;
  overflow: hidden;
}

.chart-visual i {
  opacity: 0.25;
}

.chart-visual img.chart-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.chart-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  text-align: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.analysis-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.analysis-placeholder i {
  font-size: 28px;
  color: var(--text-secondary);
  opacity: 0.3;
}

.analysis-placeholder p {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.analysis-placeholder span {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
}

/* 指标图表预览 Lightbox（Teleport 到 body，样式仍属本组件 scoped） */
.chart-lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
  box-sizing: border-box;
}

.chart-lightbox-content {
  max-width: min(96vw, 1200px);
  max-height: min(90vh, 900px);
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}

.chart-lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.chart-lightbox-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-lightbox-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chart-lightbox-close:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.chart-lightbox-body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #ffffff;
}

.chart-lightbox-body img {
  max-width: 100%;
  max-height: min(80vh, 820px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
}

.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.2s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.lightbox-enter-active .chart-lightbox-content,
.lightbox-leave-active .chart-lightbox-content {
  transition: transform 0.2s ease;
}

.lightbox-enter-from .chart-lightbox-content,
.lightbox-leave-to .chart-lightbox-content {
  transform: scale(0.96);
}

/* ==================== Flow step log ==================== */
.flow-log-content {
  flex: 1;
  min-height: 0;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.flow-log-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.flow-log-viewer-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.flow-log-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.flow-log-viewer-header-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.flow-log-viewer-summary-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.flow-log-viewer-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-log-viewer-tool {
  font-size: 9px;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}

.flow-log-viewer-state {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  font-size: 9px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.flow-log-viewer-state.failed {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.08);
}

.flow-log-viewer-state.live {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.35);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.flow-log-viewer-size,
.flow-log-viewer-loading {
  font-size: 9px;
  color: var(--text-secondary);
}

.flow-log-viewer-loading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.flow-log-viewer-summary-row.empty .flow-log-viewer-title {
  font-weight: 500;
  color: var(--text-secondary);
}

.flow-log-viewer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.flow-log-viewer-shell {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.flow-log-fullscreen-content {
  padding: 10px;
}

.flow-log-fullscreen-layout {
  border-radius: 4px;
}

.flow-log-steps-trigger,
.flow-log-jump-live-btn,
.flow-log-expand-btn,
.flow-log-icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  line-height: 1.3;
}

.flow-log-steps-trigger:hover:not(:disabled),
.flow-log-jump-live-btn:hover:not(:disabled),
.flow-log-expand-btn:hover:not(:disabled),
.flow-log-icon-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.45);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.flow-log-expand-btn:disabled {
  opacity: 0.7;
  cursor: progress;
}

.flow-log-steps-trigger i,
.flow-log-jump-live-btn i,
.flow-log-expand-btn i,
.flow-log-icon-btn i {
  font-size: 12px;
  line-height: 1;
}

.flow-log-icon-btn {
  width: 24px;
  height: 24px;
  justify-content: center;
  padding: 0;
}

.flow-log-expand-btn-spinner {
  animation: flow-log-expand-spin 900ms linear infinite;
}

@keyframes flow-log-expand-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.flow-log-error {
  flex: 1;
  min-height: 80px;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.08);
  color: #f87171;
  font-size: 11px;
  line-height: 1.4;
  overflow: auto;
}

.flow-log-placeholder {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.flow-log-placeholder i {
  font-size: 28px;
  color: var(--text-secondary);
  opacity: 0.35;
}

.flow-log-placeholder p {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.flow-log-placeholder span {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.65;
  text-align: center;
  max-width: 260px;
}

.flow-log-loading {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.flow-log-loading-icon {
  font-size: 28px;
  color: var(--text-secondary);
  opacity: 0.75;
  animation: flow-log-spin 0.85s linear infinite;
}

.flow-log-loading p {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.flow-log-loading span {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.7;
  text-align: center;
  max-width: 280px;
  line-height: 1.45;
}

.flow-log-chooser-overlay {
  position: fixed;
  inset: 0;
  z-index: 20010;
  background: rgba(17, 24, 39, 0.12);
}

.flow-log-chooser-anchor {
  position: absolute;
  width: min(calc(100vw - 40px), 20rem);
  max-width: 20rem;
}

.flow-log-chooser-enter-active,
.flow-log-chooser-leave-active {
  transition: opacity 140ms ease;
}

.flow-log-chooser-enter-active .flow-log-chooser-anchor,
.flow-log-chooser-leave-active .flow-log-chooser-anchor {
  transition: transform 140ms ease, opacity 140ms ease;
}

.flow-log-chooser-enter-from,
.flow-log-chooser-leave-to {
  opacity: 0;
}

.flow-log-chooser-enter-from .flow-log-chooser-anchor,
.flow-log-chooser-leave-to .flow-log-chooser-anchor {
  opacity: 0;
  transform: translateY(-8px);
}

@keyframes flow-log-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ==================== Checklist Table ==================== */
.checklist-content {
  flex: 1;
  padding: 8px;
  overflow: auto;
  contain: content;
}

/* ==================== 通用动画 ==================== */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.spin {
  animation: spin 1s linear infinite;
}

/* ==================== 响应式 ==================== */
@media (max-width: 1200px) {
  .info-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .charts-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  /* 3 列布局下不需要 4 列模式的 span，让第 7 个卡片走自动排布 */
  .chart-card:nth-child(7):last-child {
    grid-column: auto;
  }
}

@media (max-width: 900px) {
  .charts-grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    grid-template-rows: none;
    grid-auto-rows: minmax(120px, 1fr);
    align-content: start;
  }

  .chart-card:nth-child(7):last-child {
    grid-column: auto;
  }
}
</style>
