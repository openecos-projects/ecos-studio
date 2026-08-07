<template>
  <main class="step-dashboard" aria-label="Step dashboard" :aria-busy="loading">
    <div v-if="loading && !data" class="step-dashboard-state">
      <i class="ri-loader-4-line spin" aria-hidden="true" />
      <span>Loading step results</span>
    </div>
    <div v-else-if="error && !data" class="step-dashboard-state is-error">
      <i class="ri-error-warning-line" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="step-dashboard-retry" @click="void refresh()">
        Retry
      </button>
    </div>
    <div v-else-if="!data" class="step-dashboard-state">
      <i class="ri-inbox-archive-line" aria-hidden="true" />
      <span>No step results available</span>
    </div>

    <template v-else>
      <div class="step-dashboard-row step-dashboard-top">
        <section class="step-dashboard-card step-summary-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-radar-line" aria-hidden="true" />
              <h2>Overview</h2>
            </div>
          </header>
          <div class="step-summary-body">
            <section class="overview-subcard basic-info-card">
              <header class="overview-subcard-header">
                <i class="ri-information-line" aria-hidden="true" />
                <h3>Basic Info</h3>
              </header>
              <dl class="basic-info-list">
                <div v-for="item in basicInfo" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>
            </section>

            <section class="overview-subcard config-summary-card">
              <header class="overview-subcard-header">
                <i class="ri-file-settings-line" aria-hidden="true" />
                <h3>Configuration</h3>
                <span v-if="configFileName" :title="configPathLabel">{{
                  configFileName
                }}</span>
              </header>
              <div class="config-summary-body">
                <div v-if="configLoading" class="config-summary-state">
                  <i class="ri-loader-4-line spin" aria-hidden="true" />
                  <span>Loading configuration</span>
                </div>
                <dl v-else-if="configPreviewEntries.length" class="config-preview-grid">
                  <div v-for="entry in configPreviewEntries" :key="entry.id">
                    <dt :title="entry.label">{{ entry.label }}</dt>
                    <dd :title="entry.value">{{ entry.value }}</dd>
                  </div>
                </dl>
                <div v-else class="config-summary-state">
                  <i class="ri-file-search-line" aria-hidden="true" />
                  <span>N/A</span>
                </div>
              </div>
              <button
                type="button"
                class="status-detail-link config-details-link"
                title="View and edit step configuration"
                @click="showStepConfiguration = true"
              >
                Details <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </section>
          </div>
        </section>

        <section class="step-dashboard-card checklist-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-list-check-3" aria-hidden="true" />
              <h2>Checklist</h2>
            </div>
            <span class="dashboard-muted">checklist.json</span>
          </header>
          <div v-if="!data.checklist.total" class="checklist-empty-state">
            <i class="ri-checkbox-circle-line" aria-hidden="true" />
            <strong>No Checklist Data</strong>
            <span>Check Passed</span>
          </div>
          <div v-else class="step-status-card-content">
            <StatusPieChart
              label="Step checklist status distribution"
              :slices="data.checklist.slices"
              :center-primary="checklistCenterPrimary(data.checklist)"
              :center-secondary="checklistCenterSecondary(data.checklist)"
            />
            <div
              class="step-status-summary"
              :class="`is-${checklistTone(data.checklist)}`"
            >
              <div>
                <strong class="status-summary-title">{{
                  checklistTitle(data.checklist)
                }}</strong>
                <p>{{ checklistSummaryLabel(data.checklist) }}</p>
              </div>
              <dl class="status-count-list">
                <div v-if="data.checklist.total" class="is-pass">
                  <dt>Passing</dt>
                  <dd>{{ data.checklist.passed }}/{{ data.checklist.total }}</dd>
                </div>
                <div v-if="data.checklist.total" class="is-blocked">
                  <dt>Blocked</dt>
                  <dd>{{ data.checklist.blocked }}/{{ data.checklist.total }}</dd>
                </div>
                <div v-if="data.checklist.total" class="is-warning">
                  <dt>Warning</dt>
                  <dd>{{ data.checklist.warning }}/{{ data.checklist.total }}</dd>
                </div>
                <div v-if="data.checklist.unavailable" class="is-unavailable">
                  <dt>Unavailable</dt>
                  <dd>{{ data.checklist.unavailable }}/{{ data.checklist.total }}</dd>
                </div>
              </dl>
              <button
                type="button"
                class="status-detail-link"
                title="View checklist details"
                @click="showChecklistDetails = true"
              >
                Checklist details <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      </div>

      <div class="step-dashboard-row step-dashboard-middle">
        <section class="step-dashboard-card qor-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-award-line" aria-hidden="true" />
              <h2>Quality of Results</h2>
            </div>
            <span class="step-status" :class="`is-${statusTone(data.qor.status)}`">
              {{ statusLabel(data.qor.status) }}
            </span>
          </header>
          <div class="step-qor-overview">
            <div class="qor-visual-column">
              <StatusPieChart
                label="Step QoR gate status distribution"
                :slices="data.qor.slices"
                :center-primary="qorCenterPrimary(data.qor)"
                :center-secondary="qorCenterSecondary(data.qor)"
              />
            </div>
            <div
              class="step-status-summary qor-summary-content"
              :class="`is-${qorTone(data.qor)}`"
            >
              <div>
                <strong class="status-summary-title">{{ qorTitle(data.qor) }}</strong>
                <p>{{ qorSummaryLabel(data.qor) }}</p>
              </div>
              <dl class="status-count-list">
                <div class="is-pass">
                  <dt>Passing</dt>
                  <dd>{{ data.qor.passed }}/{{ data.qor.total }}</dd>
                </div>
                <div class="is-blocked">
                  <dt>Blocked</dt>
                  <dd>{{ data.qor.blocked }}/{{ data.qor.total }}</dd>
                </div>
                <div class="is-warning">
                  <dt>Attention</dt>
                  <dd>{{ data.qor.warning }}/{{ data.qor.total }}</dd>
                </div>
                <div>
                  <dt>Metrics</dt>
                  <dd>{{ data.qor.metrics.length }}</dd>
                </div>
              </dl>
              <button
                type="button"
                class="status-detail-link"
                title="View QoR details"
                @click="showQorDetails = true"
              >
                QoR details <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </div>
            <div v-if="visibleQorMetrics.length" class="qor-step-list">
              <section
                v-for="metric in visibleQorMetrics"
                :key="metric.id"
                class="qor-step-row"
              >
                <div class="qor-step-link">
                  <span
                    class="qor-step-status"
                    :class="`is-${qorMetricTone(metric)}`"
                    aria-hidden="true"
                  />
                  <strong :title="metric.label">{{ metric.label }}</strong>
                </div>
                <div class="qor-step-trend" :aria-label="qorMetricAriaLabel(metric)">
                  <div class="qor-metric-comparison">
                    <div class="qor-step-trend-bar" aria-hidden="true">
                      <span
                        v-if="metric.baselineValue !== null"
                        class="qor-metric-baseline"
                        :style="{
                          width: `${qorMetricSegmentPercent(metric.baselineValue, metric)}%`,
                        }"
                      />
                      <span
                        class="qor-metric-current"
                        :class="`is-${qorMetricComparisonState(metric)}`"
                        :style="{
                          width: `${qorMetricSegmentPercent(metric.currentValue, metric)}%`,
                        }"
                      />
                    </div>
                    <div class="qor-metric-values">
                      <span>{{ qorMetricBaselineValue(metric) }}</span>
                      <span>{{
                        formatDashboardValue(metric.currentValue, metric.unit)
                      }}</span>
                    </div>
                  </div>
                  <strong
                    class="qor-step-total"
                    :class="`is-${metric.comparisonState}`"
                    >{{ qorMetricDeltaValue(metric) }}</strong
                  >
                </div>
              </section>
            </div>
            <div v-else class="card-empty compact">
              <i class="ri-line-chart-line" aria-hidden="true" />
              <span>No QoR metrics available</span>
            </div>
          </div>
        </section>

        <section class="step-dashboard-card layout-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-layout-masonry-line" aria-hidden="true" />
              <h2>Layout</h2>
            </div>
            <div class="header-actions">
              <span v-if="data.hasGeometry" class="dashboard-muted">Geometry ready</span>
              <button
                type="button"
                class="dashboard-icon-button"
                :disabled="!chipViewerAvailable || chipViewerBusy"
                title="Open Chip Viewer"
                aria-label="Open Chip Viewer"
                @click="void openChipViewer()"
              >
                <i
                  :class="chipViewerBusy ? 'ri-loader-4-line spin' : 'ri-cpu-line'"
                  aria-hidden="true"
                />
              </button>
            </div>
          </header>
          <button
            v-if="data.layoutUrl"
            type="button"
            class="layout-preview"
            title="Open layout preview"
            @click="openImagePreview('Layout preview', data.layoutUrl)"
          >
            <img :src="data.layoutUrl" alt="Current step layout preview" />
          </button>
          <div v-else class="card-empty">
            <i class="ri-image-2-line" aria-hidden="true" />
            <span>No layout information</span>
          </div>
        </section>
      </div>

      <div class="step-dashboard-row step-dashboard-bottom">
        <section class="step-dashboard-card data-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-bar-chart-box-line" aria-hidden="true" />
              <h2>Data Insights</h2>
            </div>
            <button
              v-if="data.mapUrl"
              type="button"
              class="dashboard-icon-button"
              title="Open map snapshot"
              aria-label="Open map snapshot"
              @click="openImagePreview('Analysis map', data.mapUrl)"
            >
              <i class="ri-map-2-line" aria-hidden="true" />
            </button>
          </header>
          <div v-if="data.synthesisInsights" class="data-body synthesis-data-body">
            <section class="synthesis-insight-column">
              <header class="synthesis-insight-header">
                <div>
                  <i class="ri-stack-line" aria-hidden="true" />
                  <h3>Metrics</h3>
                </div>
                <span>{{ data.synthesisInsights.metrics.length }} values</span>
              </header>
              <dl
                v-if="data.synthesisInsights.metrics.length"
                class="synthesis-value-grid"
              >
                <div v-for="metric in data.synthesisInsights.metrics" :key="metric.id">
                  <dt>{{ metric.label }}</dt>
                  <dd :title="metric.value">{{ metric.value }}</dd>
                </div>
              </dl>
              <div v-else class="synthesis-empty-state">
                <i class="ri-bar-chart-grouped-line" aria-hidden="true" />
                <span>No synthesis statistics</span>
              </div>
            </section>

            <section class="synthesis-insight-column synthesis-timing-column">
              <header class="synthesis-insight-header">
                <div>
                  <i class="ri-timer-line" aria-hidden="true" />
                  <h3>Timing Analysis</h3>
                </div>
                <span>{{ data.synthesisInsights.timingModules.length }} modules</span>
              </header>
              <div
                v-if="data.synthesisInsights.timingModules.length"
                class="synthesis-timing-content"
              >
                <div
                  class="synthesis-timing-tabs"
                  role="tablist"
                  aria-label="Synthesis timing analysis modules"
                >
                  <button
                    v-for="(module, index) in data.synthesisInsights.timingModules"
                    :id="`synthesis-timing-tab-${module.id}`"
                    :key="module.id"
                    type="button"
                    role="tab"
                    :aria-selected="index === synthesisTimingTabIndex"
                    :class="{ 'is-active': index === synthesisTimingTabIndex }"
                    @click="synthesisTimingTabIndex = index"
                  >
                    {{ module.label }}
                  </button>
                </div>
                <dl
                  v-if="selectedSynthesisTimingModule"
                  class="synthesis-value-grid synthesis-timing-parameter-grid"
                  role="tabpanel"
                  :aria-labelledby="`synthesis-timing-tab-${selectedSynthesisTimingModule.id}`"
                >
                  <div
                    v-for="value in selectedSynthesisTimingModule.values"
                    :key="value.id"
                  >
                    <dt>{{ value.label }}</dt>
                    <dd :title="value.value">{{ value.value }}</dd>
                  </div>
                </dl>
              </div>
              <div v-else class="synthesis-empty-state">
                <i class="ri-timer-line" aria-hidden="true" />
                <span>No post-synthesis timing summary</span>
              </div>
              <button
                type="button"
                class="status-detail-link synthesis-timing-path-link"
                title="View all post-synthesis timing paths"
                @click="showSynthesisTimingPaths = true"
              >
                Timing paths
                <span>{{ data.synthesisInsights.timingPaths.length }}</span>
                <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </section>
          </div>
          <div v-else-if="data.rcxInsights" class="data-body rcx-data-body">
            <section class="rcx-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-flashlight-line" aria-hidden="true" />
                  <h3>Electrical Summary</h3>
                </div>
                <span>{{ data.rcxInsights.electricalCorners.length }} corners</span>
              </header>
              <dl class="synthesis-value-grid rcx-summary-grid">
                <div
                  v-for="metric in data.rcxInsights.electricalMetrics"
                  :key="metric.id"
                >
                  <dt>{{ metric.label }}</dt>
                  <dd :title="metric.value">{{ metric.value }}</dd>
                </div>
              </dl>
              <div class="insight-table-wrap rcx-corner-table">
                <table>
                  <thead>
                    <tr>
                      <th>Corner</th>
                      <th>Nets</th>
                      <th>Ground Cap</th>
                      <th>Coupling Cap</th>
                      <th>Total Cap</th>
                      <th>Resistance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="corner in data.rcxInsights.electricalCorners"
                      :key="corner.corner"
                    >
                      <th :title="corner.corner">{{ corner.corner }}</th>
                      <td>{{ insightTableValue(corner.netCount) }}</td>
                      <td>{{ insightTableValue(corner.groundCapacitanceFf) }}</td>
                      <td>{{ insightTableValue(corner.couplingCapacitanceFf) }}</td>
                      <td>{{ insightTableValue(corner.totalCapacitanceFf) }}</td>
                      <td>{{ insightTableValue(corner.totalResistanceOhm) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="rcx-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-shield-check-line" aria-hidden="true" />
                  <h3>Signoff Metrics</h3>
                </div>
                <span>{{ data.rcxInsights.signoffCorners.length }} RC corners</span>
              </header>
              <dl class="synthesis-value-grid rcx-summary-grid">
                <div v-for="metric in data.rcxInsights.signoffMetrics" :key="metric.id">
                  <dt>{{ metric.label }}</dt>
                  <dd :title="metric.value">{{ metric.value }}</dd>
                </div>
              </dl>
              <div class="insight-table-wrap rcx-corner-table">
                <table>
                  <thead>
                    <tr>
                      <th>RC Corner</th>
                      <th>Status</th>
                      <th>Total Cap</th>
                      <th>Coupling Cap</th>
                      <th>Resistance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="corner in data.rcxInsights.signoffCorners"
                      :key="corner.corner"
                    >
                      <th :title="corner.corner">{{ corner.corner }}</th>
                      <td>{{ corner.availability }}</td>
                      <td>{{ insightTableValue(corner.totalCapacitanceFf) }}</td>
                      <td>{{ insightTableValue(corner.couplingCapacitanceFf) }}</td>
                      <td>{{ insightTableValue(corner.totalResistanceOhm) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <div v-else-if="data.drcInsights" class="data-body drc-data-body">
            <section class="floorplan-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-table-line" aria-hidden="true" />
                  <h3>Metrics</h3>
                </div>
                <span>{{ data.drcInsights.table.rows.length }} rows</span>
              </header>
              <div class="insight-table-wrap drc-statistics-table">
                <table>
                  <thead>
                    <tr>
                      <th v-for="header in data.drcInsights.table.headers" :key="header">
                        {{ header }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in data.drcInsights.table.rows" :key="row.id">
                      <td v-for="(cell, index) in row.values" :key="`${row.id}-${index}`">
                        {{ cell }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="floorplan-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-pie-chart-2-line" aria-hidden="true" />
                  <h3>Snapshot</h3>
                </div>
                <span>{{ data.drcInsights.snapshots.length }} charts</span>
              </header>
              <div class="floorplan-snapshot-grid">
                <button
                  v-for="snapshot in data.drcInsights.snapshots"
                  :key="snapshot.id"
                  type="button"
                  class="floorplan-snapshot-card"
                  :title="`View ${snapshot.label} distribution`"
                  @click="openFloorplanSnapshot(snapshot)"
                >
                  <StatusPieChart
                    class="floorplan-snapshot-pie"
                    :label="`${snapshot.label} distribution`"
                    :slices="snapshot.slices"
                    :center-primary="formatDashboardValue(snapshot.total, snapshot.unit)"
                    center-secondary="total"
                  />
                  <span class="floorplan-snapshot-copy">
                    <strong>{{ snapshot.label }}</strong>
                    <span>{{ formatDashboardValue(snapshot.total, snapshot.unit) }}</span>
                  </span>
                </button>
              </div>
            </section>
          </div>
          <div v-else-if="data.staInsights" class="data-body sta-data-body">
            <div class="sta-corner-tabs" role="tablist" aria-label="STA corners">
              <button
                v-for="(corner, index) in data.staInsights.corners"
                :id="`sta-corner-tab-${index}`"
                :key="corner.id"
                type="button"
                role="tab"
                :aria-selected="index === staCornerTabIndex"
                :class="{ 'is-active': index === staCornerTabIndex }"
                :title="corner.staCorner"
                @click="selectStaCorner(index)"
              >
                {{ corner.staCorner }}
              </button>
            </div>

            <section class="sta-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-stack-line" aria-hidden="true" />
                  <h3>Metrics</h3>
                </div>
                <span>{{ selectedStaCorner?.metrics.length ?? 0 }} values</span>
              </header>
              <dl v-if="selectedStaCorner" class="synthesis-value-grid sta-metrics-grid">
                <div v-for="metric in selectedStaCorner.metrics" :key="metric.id">
                  <dt>{{ metric.label }}</dt>
                  <dd :title="metric.value">{{ metric.value }}</dd>
                </div>
              </dl>
              <div v-else class="synthesis-empty-state">
                <i class="ri-timer-line" aria-hidden="true" />
                <span>No STA corner data</span>
              </div>
            </section>

            <section class="sta-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-timer-line" aria-hidden="true" />
                  <h3>Timing Analysis</h3>
                </div>
                <span>{{ selectedStaCorner?.timingModules.length ?? 0 }} modules</span>
              </header>
              <div
                v-if="selectedStaCorner?.timingModules.length"
                class="synthesis-timing-content"
              >
                <div
                  class="synthesis-timing-tabs sta-timing-tabs"
                  role="tablist"
                  aria-label="STA timing analysis modules"
                >
                  <button
                    v-for="(module, index) in selectedStaCorner.timingModules"
                    :id="`sta-timing-tab-${module.id}`"
                    :key="module.id"
                    type="button"
                    role="tab"
                    :aria-selected="index === staTimingTabIndex"
                    :class="{ 'is-active': index === staTimingTabIndex }"
                    @click="staTimingTabIndex = index"
                  >
                    {{ module.label }}
                  </button>
                </div>
                <dl
                  v-if="selectedStaTimingModule"
                  class="synthesis-value-grid synthesis-timing-parameter-grid"
                  role="tabpanel"
                  :aria-labelledby="`sta-timing-tab-${selectedStaTimingModule.id}`"
                >
                  <div v-for="value in selectedStaTimingModule.values" :key="value.id">
                    <dt>{{ value.label }}</dt>
                    <dd :title="value.value">{{ value.value }}</dd>
                  </div>
                </dl>
              </div>
              <div v-else class="synthesis-empty-state">
                <i class="ri-timer-line" aria-hidden="true" />
                <span>No corner timing summary</span>
              </div>
            </section>
          </div>
          <div v-else-if="data.hardenInsights" class="data-body harden-data-body">
            <section class="harden-output-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-folder-open-line" aria-hidden="true" />
                  <h3>Output</h3>
                </div>
                <span>{{ data.hardenInsights.artifacts.length }} artifacts</span>
              </header>
              <div class="insight-table-wrap harden-output-table">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Path</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="artifact in data.hardenInsights.artifacts"
                      :key="artifact.type"
                      :class="{
                        'is-available': artifact.exists,
                        'is-missing': !artifact.exists,
                      }"
                    >
                      <td>{{ artifact.type }}</td>
                      <td :title="artifact.path">{{ artifact.path }}</td>
                      <td>
                        <span class="harden-output-state">
                          <i
                            :class="
                              artifact.exists
                                ? 'ri-checkbox-circle-fill'
                                : 'ri-close-circle-fill'
                            "
                            aria-hidden="true"
                          />
                          <span>{{ artifact.exists ? 'Available' : 'Missing' }}</span>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <div v-else-if="insightData" class="data-body floorplan-data-body">
            <section class="floorplan-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-stack-line" aria-hidden="true" />
                  <h3>Metrics</h3>
                </div>
                <span>{{ insightData.metrics.length }} values</span>
              </header>
              <dl
                v-if="insightData.metrics.length"
                class="synthesis-value-grid floorplan-metrics-grid"
              >
                <div v-for="metric in insightData.metrics" :key="metric.id">
                  <dt class="floorplan-metric-label">{{ metric.label }}</dt>
                  <dd :title="metric.value">{{ metric.value }}</dd>
                </div>
              </dl>
              <div v-else class="synthesis-empty-state">
                <i class="ri-bar-chart-grouped-line" aria-hidden="true" />
                <span>No floorplan metrics</span>
              </div>
            </section>

            <section class="floorplan-insight-column">
              <header class="floorplan-insight-header">
                <div>
                  <i class="ri-pie-chart-2-line" aria-hidden="true" />
                  <h3>Snapshot</h3>
                </div>
                <span>{{ insightData.snapshots.length }} charts</span>
              </header>
              <div class="floorplan-snapshot-grid">
                <button
                  v-if="data.placeDensityMapUrl"
                  type="button"
                  class="floorplan-snapshot-card floorplan-snapshot-image-card"
                  title="View all cell density map"
                  @click="openImagePreview('All Cell Density', data.placeDensityMapUrl)"
                >
                  <img :src="data.placeDensityMapUrl" alt="Place all-cell density map" />
                  <span class="floorplan-snapshot-copy">
                    <strong>All Cell Density</strong>
                    <span>Density map</span>
                  </span>
                </button>
                <button
                  v-for="snapshot in insightData.snapshots"
                  :key="snapshot.id"
                  type="button"
                  class="floorplan-snapshot-card"
                  :title="`View ${snapshot.label} distribution`"
                  @click="openFloorplanSnapshot(snapshot)"
                >
                  <StatusPieChart
                    class="floorplan-snapshot-pie"
                    :label="`${snapshot.label} distribution`"
                    :slices="snapshot.slices"
                    :center-primary="formatDashboardValue(snapshot.total, snapshot.unit)"
                    center-secondary="total"
                  />
                  <span class="floorplan-snapshot-copy">
                    <strong>{{ snapshot.label }}</strong>
                    <span>{{ formatDashboardValue(snapshot.total, snapshot.unit) }}</span>
                  </span>
                </button>
              </div>
            </section>
          </div>
          <div v-else class="data-body">
            <figure v-if="selectedDataChart" class="distribution-chart">
              <figcaption>{{ selectedDataChart.title }}</figcaption>
              <div
                v-if="data.dataCharts.length > 1"
                class="distribution-tabs"
                role="tablist"
                aria-label="Data distribution metric"
              >
                <button
                  v-for="(chart, index) in data.dataCharts"
                  :key="chart.title"
                  type="button"
                  role="tab"
                  :aria-selected="index === dataChartIndex"
                  :class="{ 'is-active': index === dataChartIndex }"
                  @click="dataChartIndex = index"
                >
                  {{ chartTabLabel(chart.title) }}
                </button>
              </div>
              <div class="distribution-bars" :aria-label="selectedDataChart.title">
                <div
                  v-for="bar in selectedDataChart.bars"
                  :key="bar.id"
                  class="distribution-row"
                >
                  <span>{{ bar.label }}</span>
                  <i><b :style="{ width: `${dataBarWidth(bar.value)}%` }" /></i>
                  <strong>{{
                    formatDashboardValue(bar.value, selectedDataChart.unit)
                  }}</strong>
                </div>
              </div>
            </figure>
            <div v-else class="data-chart-empty">
              <i class="ri-bar-chart-grouped-line" aria-hidden="true" />
              <span>No distribution data</span>
            </div>
            <dl v-if="data.dataHighlights.length" class="data-highlights">
              <div
                v-for="metric in data.dataHighlights"
                :key="metric.id"
                :class="metricTone(metric)"
              >
                <dt>{{ metric.label }}</dt>
                <dd>{{ formatDashboardValue(metric.value, metric.unit) }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section
          class="step-dashboard-card reports-card"
          :class="{ 'is-sta-report-card': data.step.trim().toLowerCase() === 'sta' }"
        >
          <header class="step-dashboard-header">
            <div>
              <i class="ri-file-chart-line" aria-hidden="true" />
              <h2>Data Reports</h2>
            </div>
            <span class="dashboard-muted">{{ data.reports.length }} files</span>
          </header>
          <ul v-if="data.reports.length" class="report-list">
            <li v-for="report in data.reports" :key="report.id">
              <span class="report-file-icon"
                ><i class="ri-file-text-line" aria-hidden="true"
              /></span>
              <span class="report-copy">
                <strong :title="report.label">{{ report.label }}</strong>
                <small :title="report.relativePath">
                  <template v-if="report.directory">
                    <i class="ri-folder-2-line" aria-hidden="true" />
                    {{ report.directory }}
                    <span v-if="reportMeta(report)"> · </span>
                  </template>
                  {{ reportMeta(report) }}
                </small>
              </span>
              <button
                type="button"
                class="dashboard-icon-button"
                :title="`Open ${report.label}`"
                :aria-label="`Open ${report.label}`"
                @click="void openReport(report)"
              >
                <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <div v-else class="card-empty">
            <i class="ri-file-search-line" aria-hidden="true" />
            <span>No reports generated</span>
          </div>
        </section>
      </div>
    </template>
  </main>

  <Dialog
    v-model:visible="imagePreview.visible"
    modal
    :header="imagePreview.label"
    :style="{ width: 'min(920px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <img
      v-if="imagePreview.url"
      class="dialog-image-preview"
      :src="imagePreview.url"
      :alt="imagePreview.label"
    />
  </Dialog>

  <Dialog
    v-model:visible="showChecklistDetails"
    modal
    header="Checklist Details"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="data?.checklist.items.length" class="checklist-detail-list">
      <section
        v-for="item in data.checklist.items"
        :key="item.id"
        :class="`is-${item.state}`"
      >
        <div>
          <span>{{
            [item.category, item.owner, item.policy].filter(Boolean).join(' · ')
          }}</span>
          <strong>{{ item.title }}</strong>
        </div>
        <p v-if="item.summary">{{ item.summary }}</p>
        <code v-if="item.sourcePath">{{ item.sourcePath }}</code>
        <small v-if="item.evidenceCount">{{ item.evidenceCount }} evidence items</small>
      </section>
    </div>
    <p v-else class="dialog-empty">No checklist detail is available for this step.</p>
  </Dialog>

  <Dialog
    v-model:visible="showQorDetails"
    modal
    header="QoR Metrics"
    :style="{ width: 'min(880px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="data" class="qor-detail-content">
      <div v-if="data.qor.gates.length" class="qor-gate-list">
        <section
          v-for="gate in data.qor.gates"
          :key="gate.id"
          :class="`is-${gate.state}`"
        >
          <span>{{ gate.blocking ? 'Blocking gate' : 'Quality gate' }}</span>
          <strong>{{ gate.title }}</strong>
          <small>{{ gate.metricCount }} linked metrics</small>
        </section>
      </div>
      <div v-if="visibleQorMetrics.length" class="qor-detail-metric-list">
        <section v-for="metric in visibleQorMetrics" :key="metric.id">
          <div>
            <span
              class="qor-step-status"
              :class="`is-${qorMetricTone(metric)}`"
              aria-hidden="true"
            />
            <strong>{{ metric.label }}</strong>
          </div>
          <div class="qor-step-trend" :aria-label="qorMetricAriaLabel(metric)">
            <div class="qor-metric-comparison">
              <div class="qor-step-trend-bar" aria-hidden="true">
                <span
                  v-if="metric.baselineValue !== null"
                  class="qor-metric-baseline"
                  :style="{
                    width: `${qorMetricSegmentPercent(metric.baselineValue, metric)}%`,
                  }"
                />
                <span
                  class="qor-metric-current"
                  :class="`is-${qorMetricComparisonState(metric)}`"
                  :style="{
                    width: `${qorMetricSegmentPercent(metric.currentValue, metric)}%`,
                  }"
                />
              </div>
              <div class="qor-metric-values">
                <span>{{ qorMetricBaselineValue(metric) }}</span>
                <span>{{ formatDashboardValue(metric.currentValue, metric.unit) }}</span>
              </div>
            </div>
            <strong class="qor-step-total" :class="`is-${metric.comparisonState}`">{{
              qorMetricDeltaValue(metric)
            }}</strong>
          </div>
        </section>
      </div>
      <p v-else class="dialog-empty">No QoR metrics are available for this step.</p>
    </div>
  </Dialog>

  <Dialog
    v-model:visible="showStepConfiguration"
    modal
    :header="configDialogTitle"
    :style="{ width: 'min(1120px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div class="step-config-dialog">
      <StepConfigPanel />
    </div>
  </Dialog>

  <Dialog
    v-model:visible="showSynthesisTimingPaths"
    modal
    header="Post-Synthesis Timing Paths"
    :style="{ width: 'min(1180px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="data?.synthesisInsights" class="timing-paths-dialog">
      <section
        v-if="data.synthesisInsights.timingPathSummary.length"
        class="timing-path-summary"
      >
        <header>
          <div>
            <i class="ri-information-line" aria-hidden="true" />
            <h3>Run Information</h3>
          </div>
        </header>
        <dl class="timing-path-summary-grid">
          <div v-for="value in data.synthesisInsights.timingPathSummary" :key="value.id">
            <dt>{{ value.label }}</dt>
            <dd :title="value.value">{{ value.value }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="data.synthesisInsights.timingPaths.length" class="timing-path-list">
        <header class="timing-path-list-header">
          <div>
            <i class="ri-git-branch-line" aria-hidden="true" />
            <h3>Timing Paths</h3>
          </div>
          <span>{{ data.synthesisInsights.timingPaths.length }} paths</span>
        </header>
        <div class="timing-path-waterfall">
          <article v-for="path in data.synthesisInsights.timingPaths" :key="path.id">
            <header>
              <span>{{ path.label }}</span>
              <small>{{ path.stages.length }} stages</small>
            </header>
            <dl class="timing-path-values">
              <div v-for="value in path.values" :key="value.id">
                <dt>{{ value.label }}</dt>
                <dd :title="value.value">{{ value.value }}</dd>
              </div>
            </dl>
            <section v-if="path.stages.length" class="timing-path-stages">
              <h4>Stage List</h4>
              <ol>
                <li v-for="(stage, index) in path.stages" :key="`${path.id}-${index}`">
                  <span>{{ index + 1 }}</span>
                  <dl>
                    <div v-for="value in stage" :key="value.id">
                      <dt>{{ value.label }}</dt>
                      <dd :title="value.value">{{ value.value }}</dd>
                    </div>
                  </dl>
                </li>
              </ol>
            </section>
          </article>
        </div>
      </section>
      <p v-else class="dialog-empty">No post-synthesis timing paths are available.</p>
    </div>
    <p v-else class="dialog-empty">No post-synthesis timing paths are available.</p>
  </Dialog>

  <Dialog
    v-model:visible="showFloorplanSnapshot"
    modal
    :header="
      selectedFloorplanSnapshot
        ? `${selectedFloorplanSnapshot.label} Distribution`
        : 'Floorplan Snapshot'
    "
    :style="{ width: 'min(980px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="selectedFloorplanSnapshot" class="floorplan-snapshot-dialog">
      <section class="floorplan-snapshot-large-chart">
        <StatusPieChart
          class="floorplan-snapshot-large-pie"
          :label="`${selectedFloorplanSnapshot.label} distribution`"
          :slices="selectedFloorplanSnapshot.slices"
          :center-primary="
            formatDashboardValue(
              selectedFloorplanSnapshot.total,
              selectedFloorplanSnapshot.unit,
            )
          "
          center-secondary="total"
          :show-labels="selectedFloorplanSnapshot.slices.length <= 3"
        />
      </section>

      <section class="floorplan-snapshot-detail-list">
        <header>
          <div>
            <i class="ri-list-check-2" aria-hidden="true" />
            <h3>Distribution</h3>
          </div>
          <span>{{ selectedFloorplanSnapshot.slices.length }} bins</span>
        </header>
        <ul>
          <li v-for="slice in selectedFloorplanSnapshot.slices" :key="slice.label">
            <span
              class="floorplan-snapshot-swatch"
              :class="`is-${slice.tone}`"
              :style="slice.color ? { backgroundColor: slice.color } : undefined"
              aria-hidden="true"
            />
            <strong :title="slice.label">{{ slice.label }}</strong>
            <span>{{
              formatDashboardValue(slice.value, selectedFloorplanSnapshot.unit)
            }}</span>
            <small>{{
              floorplanSnapshotPercent(slice.value, selectedFloorplanSnapshot.total)
            }}</small>
          </li>
        </ul>
      </section>
    </div>
    <p v-else class="dialog-empty">No Floorplan snapshot is available.</p>
  </Dialog>

  <Dialog
    v-model:visible="reportDialog.visible"
    modal
    :header="reportDialog.label"
    :style="{ width: 'min(960px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="reportDialog.loading" class="dialog-loading">
      <i class="ri-loader-4-line spin" aria-hidden="true" />
      <span>Loading report</span>
    </div>
    <p v-else-if="reportDialog.error" class="dialog-error">{{ reportDialog.error }}</p>
    <pre v-else class="report-code">{{ reportDialog.content }}</pre>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { StepEnum } from '@/api/type'
import {
  useStepDashboardData,
  type StepDashboardReport,
} from '@/composables/useStepDashboardData'
import { useStepConfigInfo } from '@/composables/useStepConfigInfo'
import { useFlowStages } from '@/composables/useFlowStages'
import { useHomeQorComparison } from '@/composables/useHomeQorComparison'
import { useWorkspace } from '@/composables/useWorkspace'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { getDesktopApi } from '@/platform/desktop'
import { isDesktopRuntime } from '@/composables/useDesktopRuntime'
import { buildChipViewerOpenRequest, canOpenChipViewer } from './drawingAreaChipViewer'
import StatusPieChart from './home/StatusPieChart.vue'
import { homeQorFlowStepForLabel } from './home/qorComparisonData'
import StepConfigPanel from './StepConfigPanel.vue'
import {
  formatDashboardValue,
  formatRuntime,
  prioritizeQorMetricComparisons,
  statusLabel,
  statusTone,
  type StepDashboardChecklist,
  type StepDashboardFloorplanSnapshot,
  type StepDashboardMetric,
  type StepDashboardQor,
  type StepDashboardQorMetricComparison,
} from './step-dashboard/stepDashboardData'

const { currentStep, data, error, loading, refresh } = useStepDashboardData()
const { currentProject } = useWorkspace()
const { flowStages } = useFlowStages()
const { state: qorComparisonState } = useHomeQorComparison()
const {
  loading: configLoading,
  stepConfigParsed,
  stepConfigPathResolved,
} = useStepConfigInfo()
const chipViewerBusy = ref(false)
const dataChartIndex = ref(0)
const synthesisTimingTabIndex = ref(0)
const staCornerTabIndex = ref(0)
const staTimingTabIndex = ref(0)
const showChecklistDetails = ref(false)
const showQorDetails = ref(false)
const showSynthesisTimingPaths = ref(false)
const showFloorplanSnapshot = ref(false)
const showStepConfiguration = ref(false)
const selectedFloorplanSnapshot = ref<StepDashboardFloorplanSnapshot | null>(null)
const imagePreview = ref({ label: '', url: '', visible: false })
const reportDialog = ref({
  label: '',
  content: '',
  error: '',
  loading: false,
  visible: false,
})

const chipViewerStep = computed(() =>
  Object.values(StepEnum).find(
    (step) => step.trim().toLowerCase() === currentStep.value.trim().toLowerCase(),
  ),
)
const chipViewerAvailable = computed(() =>
  canOpenChipViewer({
    chipViewerBusy: chipViewerBusy.value,
    chipViewerEditBusy: false,
    isDesktopRuntime: isDesktopRuntime(),
    projectPath: currentProject.value?.path,
    step: chipViewerStep.value,
  }),
)
const currentFlowStage = computed(() => {
  const step = (data.value?.step ?? currentStep.value).trim().toLowerCase()
  return flowStages.value.find(
    (stage) =>
      stage.path.trim().toLowerCase() === step ||
      stage.label.trim().toLowerCase() === step,
  )
})
const basicInfo = computed(() => {
  const step = data.value
  const flowStage = currentFlowStage.value
  const peakMemory = flowStage?.['peak memory (mb)']
  return [
    { label: 'Step', value: step?.step ?? '--' },
    { label: 'Tool', value: flowStage?.tool || step?.tool || '--' },
    {
      label: 'Runtime',
      value: flowStage?.runtime || formatRuntime(step?.run.runtimeSeconds ?? null),
    },
    {
      label: 'Peak Memory',
      value:
        typeof peakMemory === 'number' && Number.isFinite(peakMemory)
          ? `${peakMemory.toFixed(1)} MB`
          : step?.run.peakMemoryMb === null || step?.run.peakMemoryMb === undefined
            ? '--'
            : `${step.run.peakMemoryMb.toFixed(1)} MB`,
    },
    { label: 'State', value: flowStage?.state || step?.run.state || '--' },
  ]
})
const configPreviewEntries = computed(() => stepConfigPreview(stepConfigParsed.value))
const configPathLabel = computed(() => stepConfigPathResolved.value ?? '')
const configFileName = computed(() => fileName(configPathLabel.value))
const configDialogTitle = computed(
  () => `${data.value?.step ?? currentStep.value} Configuration`,
)
const visibleQorMetrics = computed(() =>
  prioritizeQorMetricComparisons(
    data.value?.qor.metrics ?? [],
    homeQorFlowStepForLabel(data.value?.step ?? ''),
    qorComparisonState.value.comparison?.metrics ?? [],
  ),
)
const selectedDataChart = computed(() => {
  const charts = data.value?.dataCharts ?? []
  return charts[dataChartIndex.value] ?? charts[0] ?? null
})
const selectedSynthesisTimingModule = computed(() => {
  const modules = data.value?.synthesisInsights?.timingModules ?? []
  return modules[synthesisTimingTabIndex.value] ?? modules[0] ?? null
})
const selectedStaCorner = computed(() => {
  const corners = data.value?.staInsights?.corners ?? []
  return corners[staCornerTabIndex.value] ?? corners[0] ?? null
})
const selectedStaTimingModule = computed(() => {
  const modules = selectedStaCorner.value?.timingModules ?? []
  return modules[staTimingTabIndex.value] ?? modules[0] ?? null
})
const insightData = computed(
  () => data.value?.floorplanInsights ?? data.value?.stepInsights ?? null,
)
const largestBar = computed(() =>
  Math.max(1, ...(selectedDataChart.value?.bars.map((bar) => bar.value) ?? [1])),
)

function barWidth(value: number, maximum: number): number {
  if (value <= 0) return 0
  return Math.max(4, Math.round((value / maximum) * 100))
}

function dataBarWidth(value: number): number {
  return barWidth(value, largestBar.value)
}

function insightTableValue(value: number | null): string {
  return value === null ? '--' : formatDashboardValue(value, '')
}

function selectStaCorner(index: number): void {
  staCornerTabIndex.value = index
  staTimingTabIndex.value = 0
}

function metricTone(metric: StepDashboardMetric): string {
  return metric.tone ? `is-${metric.tone}` : ''
}

function checklistTone(checklist: StepDashboardChecklist): string {
  if (!checklist.total || checklist.unavailable) return 'unavailable'
  if (checklist.blocked) return 'blocked'
  if (checklist.warning) return 'warning'
  return 'pass'
}

function checklistTitle(checklist: StepDashboardChecklist): string {
  if (!checklist.total) return 'Checklist pending'
  if (checklist.blocked) return 'Sign-off blocked'
  if (checklist.warning) return 'Sign-off attention'
  if (checklist.unavailable) return 'Sign-off unavailable'
  return 'Sign-off ready'
}

function checklistSummaryLabel(checklist: StepDashboardChecklist): string {
  if (!checklist.total) return 'Run this step to populate checks'
  if (checklist.blocked) return 'Blocking checklist items need review'
  if (checklist.warning) return 'Checklist has warning items'
  if (checklist.unavailable) return 'Some checklist items are unavailable'
  return 'All checklist items passed'
}

function checklistCenterPrimary(checklist: StepDashboardChecklist): string {
  return checklist.passingPercent === null ? '--' : `${checklist.passingPercent}%`
}

function checklistCenterSecondary(checklist: StepDashboardChecklist): string {
  return checklist.total ? 'passing' : 'no data'
}

function qorTone(qor: StepDashboardQor): string {
  if (qor.status === 'pass') return 'pass'
  if (qor.status === 'blocked') return 'blocked'
  if (qor.status === 'incomplete') return 'warning'
  return 'unavailable'
}

function qorTitle(qor: StepDashboardQor): string {
  if (!qor.metrics.length) return 'QoR pending'
  if (qor.status === 'blocked') return 'QoR blocked'
  if (qor.status === 'incomplete') return 'QoR attention'
  if (qor.status === 'unavailable') return 'QoR unavailable'
  return 'QoR ready'
}

function qorSummaryLabel(qor: StepDashboardQor): string {
  if (!qor.metrics.length) return 'This step has not emitted QoR metrics'
  if (!qor.gateCount) return 'No explicit gates; current QoR result is shown'
  if (qor.blocked) return 'Blocking quality gates need review'
  if (qor.warning) return 'Quality gates need attention'
  if (qor.unavailable) return 'Some quality gates are unavailable'
  return 'All reported quality gates passed'
}

function qorCenterPrimary(qor: StepDashboardQor): string {
  return qor.gateCount ? `${qor.passed}/${qor.total}` : statusLabel(qor.status)
}

function qorCenterSecondary(qor: StepDashboardQor): string {
  return qor.gateCount ? 'gates' : 'overall'
}

function qorMetricTone(metric: StepDashboardQorMetricComparison): string {
  if (!metric.isComparisonAvailable) return 'unavailable'
  if (metric.comparisonState === 'improvement') return 'good'
  if (metric.comparisonState === 'regression') return 'bad'
  return 'neutral'
}

function qorMetricComparisonState(metric: StepDashboardQorMetricComparison): string {
  if (!metric.isComparisonAvailable) return 'unavailable'
  if (metric.comparisonState === 'improvement') return 'improved'
  if (metric.comparisonState === 'regression') return 'regressed'
  return 'neutral'
}

function qorMetricSegmentPercent(
  value: number | null,
  metric: StepDashboardQorMetricComparison,
): number {
  if (value === null) return 0
  const total = Math.abs(metric.baselineValue ?? 0) + Math.abs(metric.currentValue)
  if (total > 0) return Number(((Math.abs(value) / total) * 100).toFixed(2))
  return metric.baselineValue === null ? 100 : 50
}

function qorMetricBaselineValue(metric: StepDashboardQorMetricComparison): string {
  return metric.baselineValue === null
    ? '--'
    : formatDashboardValue(metric.baselineValue, metric.unit)
}

function qorMetricDeltaValue(metric: StepDashboardQorMetricComparison): string {
  if (!metric.isComparisonAvailable || metric.absoluteDelta === null) return '--'
  return formatDashboardValue(Math.abs(metric.absoluteDelta), metric.unit)
}

function qorMetricAriaLabel(metric: StepDashboardQorMetricComparison): string {
  return `${metric.label}: baseline ${qorMetricBaselineValue(metric)}; current ${formatDashboardValue(metric.currentValue, metric.unit)}; change ${qorMetricDeltaValue(metric)}; ${qorMetricComparisonState(metric)}`
}

function chartTabLabel(title: string): string {
  if (title.startsWith('Instance')) return 'Count'
  if (title.startsWith('Cell area')) return 'Area'
  if (title.startsWith('Pin')) return 'Pins'
  return title
}

watch(
  () => data.value?.step,
  () => {
    dataChartIndex.value = 0
    synthesisTimingTabIndex.value = 0
    staCornerTabIndex.value = 0
    staTimingTabIndex.value = 0
  },
)

function openImagePreview(label: string, url: string): void {
  imagePreview.value = { label, url, visible: true }
}

function openFloorplanSnapshot(snapshot: StepDashboardFloorplanSnapshot): void {
  selectedFloorplanSnapshot.value = snapshot
  showFloorplanSnapshot.value = true
}

function floorplanSnapshotPercent(value: number, total: number): string {
  if (total <= 0) return '0%'
  return `${((value / total) * 100).toFixed(1)}%`
}

async function openChipViewer(): Promise<void> {
  const projectPath = currentProject.value?.path
  const step = chipViewerStep.value
  if (!projectPath || !step || !chipViewerAvailable.value) return

  chipViewerBusy.value = true
  try {
    await getDesktopApi().chipViewer.open(
      buildChipViewerOpenRequest(projectPath, step, 'view'),
    )
  } catch (cause) {
    console.error('Failed to open Chip Viewer from step dashboard:', cause)
  } finally {
    chipViewerBusy.value = false
  }
}

async function openReport(report: StepDashboardReport): Promise<void> {
  reportDialog.value = {
    label: report.label,
    content: '',
    error: '',
    loading: true,
    visible: true,
  }
  try {
    const path = await resolveProjectPathAccess(report.path)
    if (!path) throw new Error('Report is outside the active workspace scope.')
    const content = await readOptionalProjectTextFile(path)
    reportDialog.value.content =
      content === null ? 'Report is no longer available.' : content
  } catch (cause) {
    reportDialog.value.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    reportDialog.value.loading = false
  }
}

function reportMeta(report: StepDashboardReport): string {
  return report.sizeBytes === null
    ? ''
    : `${Math.max(1, Math.round(report.sizeBytes / 1024))} KB`
}

interface StepConfigPreviewEntry {
  id: string
  label: string
  value: string
}

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stepConfigPreview(value: unknown): StepConfigPreviewEntry[] {
  const entries: StepConfigPreviewEntry[] = []

  function visit(current: unknown, path: string[]): void {
    if (entries.length >= 9) return
    if (Array.isArray(current)) {
      entries.push({
        id: path.join('.') || 'value',
        label: path[path.length - 1] || 'Value',
        value: `[${current.length} items]`,
      })
      return
    }
    if (isConfigRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        visit(child, [...path, key])
        if (entries.length >= 9) return
      }
      return
    }
    const label = path[path.length - 1] || 'Value'
    entries.push({
      id: path.join('.') || label,
      label,
      value: current === null ? 'null' : String(current),
    })
  }

  visit(value, [])
  return entries
}

function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
</script>

<style scoped>
.step-dashboard {
  box-sizing: border-box;
  display: grid;
  gap: 8px;
  grid-template-rows: minmax(0, 2fr) minmax(0, 3fr) minmax(0, 3fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
}

.step-dashboard-row {
  display: grid;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.step-dashboard-top,
.step-dashboard-middle {
  grid-template-columns: minmax(0, 5fr) minmax(250px, 3fr);
}
.step-dashboard-bottom {
  grid-template-columns: minmax(0, 8fr) minmax(180px, 2fr);
}

.step-dashboard-card {
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

.step-dashboard-card::before {
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

.step-dashboard-header {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  justify-content: space-between;
  min-height: 33px;
  padding: 6px 9px;
}

.step-dashboard-header > div,
.header-actions {
  align-items: center;
  display: flex;
  gap: 6px;
  min-width: 0;
}

.step-dashboard-header h2 {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-dashboard-header > div > i {
  color: var(--accent-color);
  font-size: 14px;
}

.dashboard-muted {
  color: var(--text-secondary);
  font-size: 9px;
  white-space: nowrap;
}

.dashboard-icon-button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 24px;
  height: 24px;
  justify-content: center;
  padding: 0;
  width: 24px;
}

.dashboard-icon-button:hover:not(:disabled) {
  color: var(--accent-color);
}
.dashboard-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.step-status {
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 5px;
  white-space: nowrap;
}

.is-good {
  color: var(--success-color);
}
.is-warn {
  color: var(--warn-color);
}
.is-bad {
  color: var(--danger-color);
}
.is-neutral {
  color: var(--text-secondary);
}

.step-summary-body,
.data-body,
.step-qor-overview,
.step-status-card-content {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.step-summary-body {
  display: grid;
  grid-template-columns: minmax(138px, 0.85fr) minmax(0, 1.15fr);
}

.data-highlights {
  margin: 0;
}

.step-summary-body {
  gap: 8px;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  padding: 8px;
}

.overview-subcard {
  background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.overview-subcard-header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  min-height: 30px;
  padding: 5px 7px;
}

.overview-subcard-header > i {
  color: var(--accent-color);
  font-size: 13px;
}

.overview-subcard-header h3 {
  color: var(--text-primary);
  font-size: 10px;
  font-weight: 700;
  margin: 0;
}

.overview-subcard-header span {
  color: var(--text-secondary);
  font-size: 8px;
  margin-left: auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.basic-info-list {
  display: grid;
  flex: 1;
  gap: 4px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  margin: 0;
  min-height: 0;
  overflow: hidden;
  padding: 6px;
}

.basic-info-list > div {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
  min-width: 0;
  padding: 5px 7px;
}

.basic-info-list > div:last-child {
  grid-column: 1 / -1;
}

.basic-info-list dt,
.config-preview-grid dt,
.data-highlights dt {
  color: var(--text-secondary);
  font-size: 8px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.basic-info-list dd,
.config-preview-grid dd,
.data-highlights dd {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.basic-info-list dd {
  line-height: 1.25;
  overflow: visible;
  overflow-wrap: anywhere;
  white-space: normal;
}

.config-summary-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.config-preview-grid {
  display: grid;
  flex: 1;
  gap: 4px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  margin: 0;
  min-height: 0;
  overflow: hidden;
  padding: 6px;
}

.config-preview-grid > div {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: 5px 7px;
}

.config-preview-grid dd {
  margin-top: 3px;
  text-align: left;
}

.config-summary-state,
.checklist-empty-state {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 10px;
  gap: 5px;
  justify-content: center;
  min-height: 0;
  padding: 8px;
  text-align: center;
}

.config-summary-state > i,
.checklist-empty-state > i {
  color: var(--accent-color);
  font-size: 18px;
}

.checklist-empty-state strong {
  color: var(--text-primary);
  font-size: 11px;
}

.checklist-empty-state span {
  color: var(--success-color);
  font-size: 10px;
  font-weight: 700;
}

.config-details-link {
  align-self: flex-end;
  flex: 0 0 auto;
  margin: 0 7px 6px;
}

.data-highlights div {
  min-width: 0;
}

.step-status-card-content {
  display: grid;
  grid-template-columns: minmax(104px, 0.45fr) minmax(0, 1fr);
}
.step-status-card-content > .status-pie,
.qor-visual-column {
  align-self: stretch;
  border-right: 1px solid var(--border-color);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
}
.step-status-summary,
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
.step-status-summary p {
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
.step-status-summary.is-pass .status-summary-title {
  color: var(--success-color);
}
.step-status-summary.is-warning .status-summary-title {
  color: var(--warn-color);
}
.step-status-summary.is-blocked .status-summary-title {
  color: var(--danger-color);
}
.status-count-list > .is-pass dt,
.status-count-list > .is-pass dd {
  color: var(--success-color);
}
.status-count-list > .is-blocked dt,
.status-count-list > .is-blocked dd {
  color: var(--danger-color);
}
.status-count-list > .is-warning dt,
.status-count-list > .is-warning dd {
  color: var(--warn-color);
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

.step-qor-overview {
  display: grid;
  grid-template-columns: minmax(104px, 0.32fr) minmax(148px, 0.56fr) minmax(0, 1fr);
}
.qor-visual-column {
  display: grid;
  padding: 5px;
}
.qor-visual-column :deep(.status-pie-chart-wrap) {
  min-height: 118px;
}
.qor-summary-content {
  border-right: 1px solid var(--border-color);
}
.qor-step-list {
  display: grid;
  gap: 4px 6px;
  grid-auto-rows: minmax(0, 1fr);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  min-width: 0;
  overflow: hidden;
  padding: 5px 6px;
}
.qor-step-row {
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 2px 4px;
}
.qor-step-link {
  align-items: center;
  display: grid;
  gap: 4px;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
}
.qor-step-link strong {
  color: var(--text-primary);
  font-size: 8px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-step-status {
  background: var(--text-secondary);
  border-radius: 50%;
  flex: 0 0 auto;
  height: 6px;
  width: 6px;
}
.qor-step-status.is-good {
  background: var(--success-color);
}
.qor-step-status.is-bad {
  background: var(--danger-color);
}
.qor-step-status.is-warn {
  background: var(--warn-color);
}
.qor-step-status.is-unavailable {
  background: color-mix(in srgb, var(--text-secondary) 45%, transparent);
}
.qor-metric-comparison {
  min-width: 0;
  width: 100%;
}
.qor-metric-values {
  display: flex;
  justify-content: space-between;
  margin: 1px 0 0;
  min-width: 0;
  width: 100%;
}
.qor-metric-values span {
  color: var(--text-primary);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.2;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}
.qor-metric-values span:last-child {
  text-align: right;
}
.qor-step-trend {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  margin: 6px 0 0;
  min-width: 0;
}
.qor-step-trend-bar {
  background: color-mix(in srgb, var(--border-color) 80%, transparent);
  border-radius: 2px;
  display: flex;
  height: 4px;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}
.qor-step-trend-bar > span {
  flex: 0 0 auto;
  min-width: 0;
}
.qor-metric-baseline {
  background: var(--text-secondary);
}
.qor-metric-current.is-improved {
  background: var(--success-color);
}
.qor-metric-current.is-regressed {
  background: var(--danger-color);
}
.qor-metric-current.is-neutral {
  background: var(--accent-color);
}
.qor-metric-current.is-unavailable {
  background: color-mix(in srgb, var(--text-secondary) 45%, transparent);
}
.qor-step-total {
  color: var(--text-secondary);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
  white-space: normal;
}
.qor-step-total.is-improvement {
  color: var(--success-color);
}
.qor-step-total.is-regression {
  color: var(--danger-color);
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

.synthesis-data-body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.floorplan-data-body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.rcx-data-body,
.drc-data-body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.data-body.harden-data-body {
  grid-template-columns: minmax(0, 1fr);
}
.sta-data-body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: auto minmax(0, 1fr);
}
.synthesis-insight-column,
.floorplan-insight-column,
.rcx-insight-column,
.harden-output-column,
.sta-insight-column {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.synthesis-insight-column + .synthesis-insight-column,
.floorplan-insight-column + .floorplan-insight-column,
.rcx-insight-column + .rcx-insight-column,
.sta-insight-column + .sta-insight-column {
  border-left: 1px solid var(--border-color);
}
.synthesis-insight-header,
.floorplan-insight-header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  justify-content: space-between;
  min-height: 30px;
  padding: 5px 8px;
}
.synthesis-insight-header > div,
.floorplan-insight-header > div,
.timing-path-summary header > div,
.timing-path-list-header > div {
  align-items: center;
  display: flex;
  gap: 5px;
  min-width: 0;
}
.synthesis-insight-header i,
.floorplan-insight-header i,
.timing-path-summary header i,
.timing-path-list-header i {
  color: var(--accent-color);
  font-size: 12px;
}
.synthesis-insight-header h3,
.floorplan-insight-header h3,
.timing-path-summary h3,
.timing-path-list h3 {
  color: var(--text-primary);
  font-size: 10px;
  font-weight: 700;
  margin: 0;
}
.synthesis-insight-header > span,
.floorplan-insight-header > span,
.timing-path-list-header > span {
  color: var(--text-secondary);
  font-size: 8px;
  white-space: nowrap;
}
.synthesis-value-grid,
.timing-path-summary-grid,
.timing-path-values,
.timing-path-stages dl {
  margin: 0;
}
.synthesis-value-grid {
  display: grid;
  flex: 1;
  gap: 4px;
  grid-auto-rows: minmax(0, 1fr);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-height: 0;
  padding: 6px;
}
.synthesis-value-grid > div,
.timing-path-summary-grid > div,
.timing-path-values > div,
.timing-path-stages dl > div {
  min-width: 0;
}
.synthesis-value-grid > div {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
  padding: 5px 7px;
}
.synthesis-value-grid dt,
.timing-path-summary-grid dt,
.timing-path-values dt,
.timing-path-stages dt {
  color: var(--text-secondary);
  font-size: 8px;
  margin: 0;
}
.synthesis-value-grid dt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.synthesis-value-grid dd,
.timing-path-summary-grid dd,
.timing-path-values dd,
.timing-path-stages dd {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}
.synthesis-value-grid dd {
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  font-variant-numeric: normal;
  font-weight: 600;
  margin: 0;
  overflow: visible;
  text-align: left;
  white-space: normal;
}
.synthesis-timing-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.synthesis-timing-tabs {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: grid;
  flex: 0 0 auto;
  gap: 2px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-width: 0;
  padding: 5px 6px;
}
.synthesis-timing-tabs button {
  background: var(--bg-secondary);
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 8px;
  min-height: 21px;
  min-width: 0;
  overflow: hidden;
  padding: 3px 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.synthesis-timing-tabs button:hover,
.synthesis-timing-tabs button.is-active {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent-color) 44%, transparent);
  color: var(--accent-color);
  font-weight: 700;
}
.synthesis-timing-parameter-grid {
  padding-top: 5px;
}
.floorplan-metrics-grid {
  grid-auto-rows: minmax(0, 1fr);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.floorplan-metrics-grid > div {
  gap: 4px;
  justify-content: flex-start;
  padding: 6px 7px;
}
.floorplan-metric-label {
  display: block;
  line-height: 1.15;
  min-height: 18px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.floorplan-metrics-grid dd {
  font-size: 11px;
  line-height: 1.2;
}
.floorplan-snapshot-grid {
  display: grid;
  flex: 1;
  gap: 4px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  min-height: 0;
  padding: 6px;
}
.floorplan-snapshot-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  color: inherit;
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 3px;
  grid-template-rows: minmax(0, 1fr) auto;
  margin: 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 4px;
  text-align: left;
}
.floorplan-snapshot-card:hover {
  border-color: color-mix(in srgb, var(--accent-color) 62%, var(--border-color));
}
.floorplan-snapshot-card:focus-visible {
  outline: 1px solid var(--accent-color);
  outline-offset: -2px;
}
.floorplan-snapshot-image-card img {
  display: block;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  width: 100%;
}
.floorplan-snapshot-copy {
  align-items: center;
  display: flex;
  gap: 4px;
  justify-content: space-between;
  min-width: 0;
}
.floorplan-snapshot-copy strong {
  color: var(--text-secondary);
  font-size: 8px;
  font-weight: 400;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.floorplan-snapshot-copy span {
  color: var(--text-primary);
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.floorplan-snapshot-pie {
  min-height: 0;
}
.floorplan-snapshot-pie :deep(.status-pie-chart-wrap) {
  min-height: 0;
}
.floorplan-snapshot-pie :deep(.status-pie-center strong) {
  font-size: 10px;
}
.floorplan-snapshot-pie :deep(.status-pie-center span) {
  font-size: 7px;
  margin-top: 1px;
}
.rcx-summary-grid {
  flex: 0 0 86px;
  grid-template-rows: repeat(2, minmax(0, 1fr));
}
.rcx-summary-grid > div {
  padding: 4px 6px;
}
.insight-table-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 5px 6px 6px;
}
.insight-table-wrap table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}
.insight-table-wrap th,
.insight-table-wrap td {
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 7px;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  min-width: 0;
  overflow: hidden;
  padding: 3px 2px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insight-table-wrap thead th {
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 7px;
  font-weight: 600;
  text-align: center;
}
.insight-table-wrap tbody th,
.insight-table-wrap tbody td:first-child {
  color: var(--text-primary);
  font-family: inherit;
  font-weight: 600;
  text-align: left;
}
.insight-table-wrap tbody td {
  color: var(--text-primary);
}
.rcx-corner-table tbody tr {
  height: 18px;
}
.drc-statistics-table {
  padding: 6px;
}
.drc-statistics-table th,
.drc-statistics-table td {
  font-size: 6px;
  padding: 3px 1px;
  text-align: center;
}
.drc-statistics-table th:first-child,
.drc-statistics-table td:first-child {
  overflow-wrap: anywhere;
  text-align: left;
  white-space: normal;
}
.harden-output-table th:first-child,
.harden-output-table td:first-child {
  width: 52px;
}
.harden-output-table {
  padding: 0;
  width: 100%;
}
.harden-output-table table {
  width: 100%;
}
.harden-output-table th:last-child,
.harden-output-table td:last-child {
  width: 92px;
}
.harden-output-table td:nth-child(2) {
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: left;
  text-overflow: clip;
  white-space: normal;
}
.harden-output-state {
  align-items: center;
  display: inline-flex;
  gap: 3px;
  justify-content: flex-end;
  white-space: nowrap;
}
.harden-output-table tr.is-available .harden-output-state {
  color: var(--success-color);
}
.harden-output-table tr.is-missing .harden-output-state {
  color: var(--danger-color);
}
.sta-corner-tabs {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: grid;
  gap: 3px;
  grid-column: 1 / -1;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  padding: 5px 6px;
}
.sta-corner-tabs button {
  background: var(--bg-secondary);
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 8px;
  min-height: 21px;
  min-width: 0;
  overflow: hidden;
  padding: 3px 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sta-corner-tabs button:hover,
.sta-corner-tabs button.is-active {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent-color) 44%, transparent);
  color: var(--accent-color);
  font-weight: 700;
}
.sta-metrics-grid {
  padding-top: 5px;
}
.floorplan-snapshot-dialog {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(270px, 0.9fr) minmax(0, 1.1fr);
  height: min(64vh, 580px);
  min-height: 320px;
}
.floorplan-snapshot-large-chart,
.floorplan-snapshot-detail-list {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  min-height: 0;
  min-width: 0;
}
.floorplan-snapshot-large-chart {
  padding: 12px;
}
.floorplan-snapshot-large-pie,
.floorplan-snapshot-large-pie :deep(.status-pie-chart-wrap) {
  min-height: 0;
}
.floorplan-snapshot-large-pie :deep(.status-pie-center strong) {
  font-size: 26px;
}
.floorplan-snapshot-large-pie :deep(.status-pie-center span) {
  font-size: 11px;
}
.floorplan-snapshot-detail-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.floorplan-snapshot-detail-list > header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  min-height: 36px;
  padding: 7px 9px;
}
.floorplan-snapshot-detail-list > header > div {
  align-items: center;
  display: flex;
  gap: 6px;
  min-width: 0;
}
.floorplan-snapshot-detail-list > header i {
  color: var(--accent-color);
  font-size: 13px;
}
.floorplan-snapshot-detail-list h3 {
  color: var(--text-primary);
  font-size: 11px;
  margin: 0;
}
.floorplan-snapshot-detail-list > header > span {
  color: var(--text-secondary);
  font-size: 9px;
  white-space: nowrap;
}
.floorplan-snapshot-detail-list ul {
  display: grid;
  flex: 1;
  gap: 5px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
.floorplan-snapshot-detail-list li {
  align-items: center;
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  display: grid;
  gap: 5px;
  grid-template-columns: 7px minmax(0, 1fr) auto auto;
  min-width: 0;
  padding: 5px;
}
.floorplan-snapshot-swatch {
  background: var(--text-secondary);
  border-radius: 2px;
  display: block;
  height: 7px;
  width: 7px;
}
.floorplan-snapshot-swatch.is-good {
  background: var(--success-color);
}
.floorplan-snapshot-swatch.is-warn {
  background: var(--warn-color);
}
.floorplan-snapshot-swatch.is-bad {
  background: var(--danger-color);
}
.floorplan-snapshot-detail-list li strong,
.floorplan-snapshot-detail-list li > span:not(.floorplan-snapshot-swatch),
.floorplan-snapshot-detail-list li small {
  font-variant-numeric: tabular-nums;
  min-width: 0;
}
.floorplan-snapshot-detail-list li strong {
  color: var(--text-primary);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.floorplan-snapshot-detail-list li > span:not(.floorplan-snapshot-swatch) {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 9px;
  text-align: right;
}
.floorplan-snapshot-detail-list li small {
  color: var(--text-secondary);
  font-size: 8px;
  text-align: right;
}
.synthesis-timing-path-link {
  align-items: center;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: flex;
  flex: 0 0 27px;
  gap: 5px;
  justify-content: flex-end;
  margin: 0;
  padding: 0 8px;
}
.synthesis-timing-path-link span {
  color: var(--text-secondary);
  font-size: 8px;
}
.synthesis-empty-state {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 9px;
  gap: 4px;
  justify-content: center;
  padding: 8px;
  text-align: center;
}
.synthesis-empty-state i {
  color: var(--accent-color);
  font-size: 16px;
}

.data-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(150px, 0.9fr);
}
.distribution-chart {
  border-right: 1px solid var(--border-color);
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 9px;
}
.distribution-chart figcaption {
  color: var(--text-secondary);
  font-size: 9px;
  margin-bottom: 8px;
}
.distribution-tabs {
  display: flex;
  gap: 2px;
  margin: -2px 0 8px;
}
.distribution-tabs button {
  background: var(--bg-secondary);
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  flex: 1;
  font-size: 8px;
  min-height: 19px;
  padding: 2px 4px;
}
.distribution-tabs button.is-active {
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-secondary));
  color: var(--accent-color);
  font-weight: 700;
}
.distribution-bars {
  display: grid;
  gap: 6px;
}
.distribution-row {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(44px, 0.8fr) minmax(58px, 1.5fr) auto;
}
.distribution-row span {
  color: var(--text-secondary);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.distribution-row i {
  background: var(--bg-secondary);
  display: block;
  height: 6px;
  overflow: hidden;
}
.distribution-row b {
  background: var(--accent-color);
  display: block;
  height: 100%;
}
.distribution-row strong {
  color: var(--text-primary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.data-highlights {
  align-content: center;
  display: grid;
  gap: 7px;
  overflow: auto;
  padding: 9px;
}
.data-chart-empty {
  align-items: center;
  border-right: 1px solid var(--border-color);
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  font-size: 10px;
  gap: 5px;
  justify-content: center;
  padding: 8px;
  text-align: center;
}
.data-chart-empty i {
  font-size: 20px;
  opacity: 0.6;
}

.report-list {
  display: grid;
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 3px 6px;
}
.report-list li {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: grid;
  gap: 7px;
  grid-template-columns: 20px minmax(0, 1fr) 24px;
  min-height: 34px;
}
.report-list li:last-child {
  border-bottom: 0;
}
.report-file-icon {
  align-items: center;
  color: var(--accent-color);
  display: flex;
  justify-content: center;
}
.report-copy {
  min-width: 0;
}
.report-copy strong {
  color: var(--text-primary);
  display: block;
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.report-copy small {
  color: var(--text-secondary);
  display: block;
  font-size: 8px;
  margin-top: 2px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.report-copy small i {
  color: var(--accent-color);
  font-size: 10px;
  margin-right: 3px;
}
.reports-card.is-sta-report-card .report-list {
  grid-auto-rows: minmax(54px, auto);
}
.reports-card.is-sta-report-card .report-list li {
  align-items: start;
  min-height: 54px;
  padding: 7px 0;
}
.reports-card.is-sta-report-card .report-file-icon,
.reports-card.is-sta-report-card .report-list li > .dashboard-icon-button {
  padding-top: 3px;
}
.reports-card.is-sta-report-card .report-copy strong {
  line-height: 1.35;
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
}
.reports-card.is-sta-report-card .report-copy small {
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.step-config-dialog {
  height: min(72vh, 720px);
  min-height: 420px;
}

.timing-paths-dialog {
  display: grid;
  gap: 12px;
  max-height: min(68vh, 760px);
  overflow: auto;
  padding-right: 4px;
}
.timing-path-summary,
.timing-path-list {
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  min-width: 0;
}
.timing-path-summary > header,
.timing-path-list-header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  justify-content: space-between;
  min-height: 31px;
  padding: 5px 8px;
}
.timing-path-summary-grid {
  display: grid;
  gap: 5px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 7px;
}
.timing-path-summary-grid > div {
  background: color-mix(in srgb, var(--bg-secondary) 50%, transparent);
  padding: 4px 6px;
}
.timing-path-waterfall {
  column-count: 2;
  column-gap: 10px;
  padding: 8px;
}
.timing-path-waterfall > article {
  background: color-mix(in srgb, var(--bg-secondary) 54%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 74%, transparent);
  break-inside: avoid;
  display: inline-block;
  margin: 0 0 10px;
  min-width: 0;
  vertical-align: top;
  width: 100%;
}
.timing-path-waterfall > article > header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  display: flex;
  gap: 8px;
  justify-content: space-between;
  padding: 5px 7px;
}
.timing-path-waterfall > article > header > span {
  color: var(--accent-color);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.timing-path-waterfall > article > header small {
  color: var(--text-secondary);
  flex: 0 0 auto;
  font-size: 8px;
}
.timing-path-values {
  display: grid;
  gap: 4px 7px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 7px;
}
.timing-path-values dd {
  font-size: 8px;
}
.timing-path-stages {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 7px;
}
.timing-path-stages h4 {
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.timing-path-stages ol {
  display: grid;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.timing-path-stages li {
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  display: grid;
  gap: 5px;
  grid-template-columns: 17px minmax(0, 1fr);
  padding: 4px;
}
.timing-path-stages li > span {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 8px;
  padding-top: 1px;
  text-align: right;
}
.timing-path-stages dl {
  display: grid;
  gap: 3px 5px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.timing-path-stages dd {
  font-size: 8px;
  margin-top: 1px;
}

.card-empty,
.step-dashboard-state {
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
.card-empty i,
.step-dashboard-state i {
  font-size: 20px;
  opacity: 0.65;
}
.card-empty.compact {
  grid-column: 2;
}
.step-dashboard-state {
  grid-row: 1 / -1;
}
.step-dashboard-state.is-error {
  color: var(--danger-color);
}
.step-dashboard-retry {
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}

.dialog-image-preview {
  display: block;
  max-height: min(72vh, 720px);
  object-fit: contain;
  width: 100%;
}
.dialog-loading {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  gap: 8px;
  min-height: 180px;
  justify-content: center;
}
.dialog-error {
  color: var(--danger-color);
  font-size: 12px;
  margin: 0;
}
.report-code {
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  margin: 0;
  max-height: min(66vh, 680px);
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.dialog-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}
.checklist-detail-list,
.qor-detail-content,
.qor-detail-metric-list {
  display: grid;
  gap: 8px;
}
.checklist-detail-list section,
.qor-gate-list section {
  border-left: 3px solid var(--text-secondary);
  padding: 7px 9px;
}
.checklist-detail-list section.is-pass,
.qor-gate-list section.is-pass {
  border-left-color: var(--success-color);
}
.checklist-detail-list section.is-warning,
.qor-gate-list section.is-warning {
  border-left-color: var(--warn-color);
}
.checklist-detail-list section.is-failed,
.qor-gate-list section.is-failed {
  border-left-color: var(--danger-color);
}
.checklist-detail-list section > div {
  align-items: baseline;
  display: flex;
  gap: 8px;
}
.checklist-detail-list span,
.qor-gate-list span,
.checklist-detail-list small,
.qor-gate-list small {
  color: var(--text-secondary);
  font-size: 10px;
}
.checklist-detail-list strong,
.qor-gate-list strong {
  color: var(--text-primary);
  font-size: 12px;
}
.checklist-detail-list p {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
  margin: 5px 0 0;
}
.checklist-detail-list code {
  color: var(--text-secondary);
  display: block;
  font-size: 9px;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.checklist-detail-list small {
  display: block;
  margin-top: 4px;
}
.qor-gate-list {
  display: grid;
  gap: 5px;
}
.qor-gate-list section {
  align-items: baseline;
  display: grid;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.qor-detail-metric-list {
  border-top: 1px solid var(--border-color);
  padding-top: 8px;
}
.qor-detail-metric-list section {
  display: grid;
  gap: 4px;
}
.qor-detail-metric-list section > div:first-child {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.qor-detail-metric-list strong {
  color: var(--text-primary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-detail-metric-list small {
  color: var(--text-secondary);
  font-size: 10px;
}

@media (max-width: 880px) {
  .step-dashboard {
    grid-template-rows: repeat(3, minmax(232px, auto));
    overflow: auto;
  }
  .step-dashboard-top,
  .step-dashboard-middle,
  .step-dashboard-bottom {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(210px, auto) minmax(210px, auto);
  }
  .step-summary-body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .sta-corner-tabs {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .floorplan-snapshot-dialog {
    grid-template-columns: 1fr;
    height: min(72vh, 620px);
  }
  .floorplan-snapshot-large-chart {
    min-height: 220px;
  }
  .floorplan-snapshot-detail-list ul {
    grid-template-columns: 1fr;
  }
  .step-qor-overview {
    grid-template-columns: minmax(96px, 0.36fr) minmax(0, 0.64fr);
  }
  .qor-step-list,
  .step-qor-overview > .card-empty {
    border-top: 1px solid var(--border-color);
    grid-column: 1 / -1;
  }
  .qor-step-list {
    max-height: 220px;
  }
}
</style>
