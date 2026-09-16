<template>
  <Dialog
    :visible="visible"
    modal
    maximizable
    header="QoR Comparison"
    class="qor-detail-dialog"
    :style="{ width: 'min(1280px, calc(100vw - 32px))' }"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="detail" class="qor-detail-waterfall">
      <article class="qor-detail-card qor-detail-summary-card">
        <header>
          <div>
            <span>QoR comparison</span>
            <strong>Baseline and current workspace</strong>
          </div>
          <i class="ri-scales-3-line" aria-hidden="true" />
        </header>
        <div class="qor-detail-summary-grid">
          <section class="is-baseline">
            <span>Baseline</span>
            <strong :title="detail.baseline.workspaceName">
              {{ detail.baseline.workspaceName }}
            </strong>
            <div class="qor-detail-score-value">
              <strong>{{ formatQorScore(detail.baseline.score) }}</strong>
              <span v-if="detail.baseline.score !== null">/ 100</span>
            </div>
          </section>
          <section class="is-current" :class="`is-${detail.scoreState}`">
            <span>Current workspace</span>
            <strong :title="detail.current.workspaceName">
              {{ detail.current.workspaceName }}
            </strong>
            <div class="qor-detail-score-value">
              <strong>{{ formatQorScore(detail.current.score) }}</strong>
              <span v-if="detail.current.score !== null">/ 100</span>
            </div>
          </section>
          <dl class="qor-detail-summary-list">
            <div>
              <dt>Directional metrics</dt>
              <dd>{{ detail.summary.comparableCount }}</dd>
            </div>
            <div class="is-improvement">
              <dt>Improved</dt>
              <dd>{{ detail.summary.improvedCount }}</dd>
            </div>
            <div class="is-regression">
              <dt>Regressed</dt>
              <dd>{{ detail.summary.regressedCount }}</dd>
            </div>
            <div>
              <dt>Score trend</dt>
              <dd :class="`is-${detail.scoreState}`">
                {{ qorScoreComparisonLabel(detail.current.score, detail.baseline.score) }}
              </dd>
            </div>
          </dl>
        </div>
      </article>

      <p v-if="!detail.steps.length" class="qor-detail-no-metrics">
        {{ emptyLabel }}
      </p>

      <article
        v-for="step in detail.steps"
        :key="step.step"
        class="qor-detail-card qor-detail-step-card"
      >
        <header>
          <div>
            <span>Step {{ String(step.order).padStart(2, '0') }}</span>
            <strong>{{ step.label }}</strong>
          </div>
          <small>
            {{ step.metrics.length }} metrics · {{ step.improvedCount }} improved ·
            {{ step.regressedCount }} regressed
          </small>
        </header>
        <dl class="qor-detail-metric-list">
          <div class="qor-detail-metric-heading" aria-hidden="true">
            <dt>Metric</dt>
            <dd>Baseline</dd>
            <dd>Current</dd>
            <p>Trend</p>
          </div>
          <div
            v-for="metric in step.metrics"
            :key="`${step.step}:${metric.metricName}`"
            :class="`is-${metric.state}`"
          >
            <dt>
              <span>{{ metric.displayName }}</span>
              <small>{{ metric.metricName }}</small>
            </dt>
            <dd>{{ formatQorValue(metric.baselineValue, metric.unit) }}</dd>
            <dd>{{ formatQorValue(metric.currentValue, metric.unit) }}</dd>
            <p :class="`is-${metric.state}`">{{ qorMetricComparisonLabel(metric) }}</p>
          </div>
        </dl>
      </article>
    </div>
    <p v-else class="dialog-empty">{{ emptyLabel }}</p>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import {
  formatQorScore,
  formatQorValue,
  qorMetricComparisonLabel,
  qorScoreComparisonLabel,
  type HomeQorDetailModel,
} from './qorComparisonData'

defineProps<{
  detail: HomeQorDetailModel | null
  emptyLabel: string
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<style scoped>
.qor-detail-waterfall {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: min(700px, 72vh);
  min-height: 440px;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 5px 8px 0;
}

.qor-detail-card header > span,
.qor-detail-step-card header span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.qor-detail-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--text-secondary);
  border-radius: 6px;
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
}

.qor-detail-card > header {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-height: 34px;
  padding: 7px 9px;
}

.qor-detail-card > header i {
  color: var(--accent-color);
  font-size: 15px;
}

.qor-detail-summary-card > header > div,
.qor-detail-step-card header > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qor-detail-step-card header strong {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.25;
}

.qor-detail-step-card header small {
  color: var(--text-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.qor-detail-summary-grid > section {
  min-width: 0;
  padding: 10px 12px 8px;
}

.qor-detail-summary-grid > section + section {
  border-left: 1px solid var(--border-color);
}

.qor-detail-summary-grid > section > span {
  color: var(--text-secondary);
  display: block;
  font-size: 12px;
  font-weight: 600;
}

.qor-detail-summary-grid > section > strong {
  color: var(--text-primary);
  display: block;
  font-size: 14px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-score-value {
  align-items: baseline;
  display: flex;
  gap: 4px;
  padding: 9px 0 0;
}

.qor-detail-score-value strong {
  color: var(--text-primary);
  font-size: 31px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.qor-detail-summary-grid > .is-current.is-improvement .qor-detail-score-value strong {
  color: var(--success-color);
}

.qor-detail-summary-grid > .is-current.is-regression .qor-detail-score-value strong {
  color: var(--danger-color);
}

.qor-detail-score-value > span {
  color: var(--text-secondary);
  font-size: 12px;
}

.qor-detail-summary-list,
.qor-detail-metric-list {
  margin: 0;
}

.qor-detail-summary-list {
  display: grid;
  gap: 0;
  grid-column: 1 / -1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 0 12px 10px;
}

.qor-detail-summary-list > div {
  border-top: 1px solid var(--border-color);
  min-width: 0;
  padding: 7px 5px 0 0;
}

.qor-detail-summary-list > div + div {
  padding-left: 8px;
}

.qor-detail-summary-list dt {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}

.qor-detail-summary-list dd {
  color: var(--text-primary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-summary-list .is-improvement dd,
.qor-detail-metric-list p.is-improvement {
  color: var(--success-color);
}

.qor-detail-summary-list .is-regression dd,
.qor-detail-metric-list p.is-regression {
  color: var(--danger-color);
}

.qor-detail-summary-list .is-neutral {
  color: var(--text-secondary);
}

.qor-detail-no-metrics {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  margin: 2px 0;
  padding: 4px 2px;
}

.qor-detail-metric-list > div {
  align-items: start;
  border-bottom: 1px solid var(--border-color);
  display: grid;
  gap: 6px 16px;
  grid-template-columns:
    minmax(180px, 1.4fr) minmax(118px, 0.8fr) minmax(118px, 0.8fr)
    minmax(176px, 1fr);
  min-width: 0;
  padding: 9px 12px;
}

.qor-detail-metric-list > div:last-child {
  border-bottom: 0;
}

.qor-detail-metric-list > .qor-detail-metric-heading {
  align-items: center;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding-bottom: 7px;
  padding-top: 7px;
}

.qor-detail-metric-heading dt,
.qor-detail-metric-heading dd,
.qor-detail-metric-heading p {
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  margin: 0;
  text-align: left;
  white-space: nowrap;
}

.qor-detail-metric-list dt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qor-detail-metric-list dt > span {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-metric-list dt small {
  color: var(--text-secondary);
  font-family: var(--font-family-mono, monospace);
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-metric-list dd {
  color: var(--text-primary);
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 0;
  text-align: left;
  white-space: nowrap;
}

.qor-detail-metric-list > div.is-improvement dd:nth-of-type(2) {
  color: var(--success-color);
}

.qor-detail-metric-list > div.is-regression dd:nth-of-type(2) {
  color: var(--danger-color);
}

.qor-detail-metric-list p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.3;
  margin: 0;
}

.dialog-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}

@media (max-width: 760px) {
  .qor-detail-waterfall {
    height: min(720px, 74vh);
    padding-right: 0;
  }

  .qor-detail-summary-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .qor-detail-metric-list > div {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .qor-detail-metric-list > .qor-detail-metric-heading {
    display: none;
  }

  .qor-detail-metric-list dt,
  .qor-detail-metric-list p {
    grid-column: 1 / -1;
  }

  .qor-detail-metric-list dd::before {
    color: var(--text-secondary);
    display: block;
    font-family: var(--font-family-base, sans-serif);
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 2px;
  }

  .qor-detail-metric-list dd:nth-of-type(1)::before {
    content: 'Baseline';
  }

  .qor-detail-metric-list dd:nth-of-type(2)::before {
    content: 'Current';
  }
}
</style>

<!-- Dialog teleports to body; keep maximize layout rules unscoped. -->
<style>
.qor-detail-dialog.p-dialog-maximized {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  width: 100vw;
}

.qor-detail-dialog.p-dialog-maximized .p-dialog-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: auto !important;
  max-height: none !important;
  min-height: 0;
  overflow: hidden;
}

.qor-detail-dialog.p-dialog-maximized .qor-detail-waterfall {
  flex: 1 1 auto;
  height: auto !important;
  max-height: none;
  min-height: 0;
  overflow: auto;
}
</style>
