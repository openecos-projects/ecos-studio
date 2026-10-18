<template>
  <Dialog
    :visible="visible"
    modal
    maximizable
    header="QoR Details"
    class="qor-detail-dialog"
    :style="{ width: 'min(1280px, calc(100vw - 32px))' }"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="detail" class="qor-detail-waterfall">
      <article class="qor-detail-card qor-detail-summary-card">
        <header>
          <div>
            <span>Current QoR</span>
            <strong>{{ detail.current.workspaceName }}</strong>
          </div>
          <i class="ri-scales-3-line" aria-hidden="true" />
        </header>
        <div class="qor-detail-summary-grid">
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
              <dt>Dimension count</dt>
              <dd>{{ detail.scoring?.dimensions.length ?? 0 }}</dd>
            </div>
          </dl>
        </div>
      </article>

      <article v-if="detail.scoring" class="qor-detail-card qor-detail-scoring-card">
        <header>
          <div>
            <span>Score calculation</span>
            <strong>{{ detail.scoring.engine }} · {{ detail.scoring.profile }}</strong>
          </div>
          <i class="ri-function-line" aria-hidden="true" />
        </header>
        <p class="qor-detail-method">
          The total is the authoritative QoR v3 score emitted by the runtime. It combines
          the five normalized dimensions below; the runtime status bands classify the
          result.
        </p>
        <dl class="qor-detail-dimension-list">
          <div v-for="dimension in detail.scoring.dimensions" :key="dimension.name">
            <dt>{{ dimension.name }}</dt>
            <dd>{{ dimension.value ?? 'NR' }}</dd>
            <small>{{ dimension.state }}</small>
          </div>
        </dl>
        <dl class="qor-detail-scoring-facts">
          <div>
            <dt>Feasibility</dt>
            <dd>{{ detail.scoring.feasibility }}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{{ detail.scoring.evidence.state }}</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>{{ detail.scoring.evidence.coverage ?? 'NR' }}</dd>
          </div>
          <div>
            <dt>Consistency</dt>
            <dd>{{ detail.scoring.evidence.consistency ?? 'NR' }}</dd>
          </div>
          <div>
            <dt>Power</dt>
            <dd>{{ detail.scoring.power.totalUw ?? 'NR' }} µW</dd>
          </div>
          <div>
            <dt>Power source</dt>
            <dd>{{ detail.scoring.power.sourceKind ?? 'NR' }}</dd>
          </div>
          <div>
            <dt>Placement inflation</dt>
            <dd>{{ detail.scoring.inflation.iPlace ?? 'NR' }}</dd>
          </div>
          <div>
            <dt>Route inflation</dt>
            <dd>{{ detail.scoring.inflation.iRoute ?? 'NR' }}</dd>
          </div>
          <div>
            <dt>Total inflation</dt>
            <dd>{{ detail.scoring.inflation.iTotal ?? 'NR' }}</dd>
          </div>
          <div>
            <dt>Congestion severity</dt>
            <dd>{{ detail.scoring.inflation.congestionSeverity ?? 'NR' }}</dd>
          </div>
        </dl>
        <div class="qor-detail-subsection">
          <strong>Feasibility gates</strong>
          <ul>
            <li v-for="gate in detail.scoring.gates" :key="gate.id">
              <span>{{ gate.stage }} · {{ gate.id }}</span>
              <em :class="`is-${gate.state}`"
                >{{ gate.state }}{{ gate.blocksTapeout ? ' · tapeout blocker' : '' }}</em
              >
            </li>
          </ul>
        </div>
        <div v-if="detail.scoring.diagnoses.length" class="qor-detail-subsection">
          <strong>Runtime diagnoses</strong>
          <ul>
            <li
              v-for="diagnosis in detail.scoring.diagnoses"
              :key="diagnosis.diagnosisId"
            >
              <span
                >{{ diagnosis.diagnosisId }} ·
                {{ diagnosis.affectedDimensions.join(', ') || 'general' }}</span
              >
              <em>{{ diagnosis.state }} · severity {{ diagnosis.severity }}</em>
            </li>
          </ul>
        </div>
      </article>

      <p v-if="!detail.scoring" class="qor-detail-no-metrics">{{ emptyLabel }}</p>
    </div>
    <p v-else class="dialog-empty">{{ emptyLabel }}</p>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import { formatQorScore, type HomeQorDetailModel } from './qorComparisonData'

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

.qor-detail-method {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  padding: 10px 12px 0;
}

.qor-detail-dimension-list,
.qor-detail-scoring-facts {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  padding: 10px 12px;
}

.qor-detail-dimension-list > div,
.qor-detail-scoring-facts > div {
  min-width: 0;
}

.qor-detail-dimension-list dt,
.qor-detail-scoring-facts dt {
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: capitalize;
}

.qor-detail-dimension-list dd,
.qor-detail-scoring-facts dd {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  margin: 2px 0 0;
}

.qor-detail-dimension-list small {
  color: var(--text-secondary);
  font-size: 10px;
}

.qor-detail-subsection {
  border-top: 1px solid var(--border-color);
  padding: 10px 12px;
}

.qor-detail-subsection > strong {
  color: var(--text-primary);
  font-size: 12px;
}

.qor-detail-subsection ul {
  display: grid;
  gap: 5px;
  list-style: none;
  margin: 7px 0 0;
  padding: 0;
}

.qor-detail-subsection li {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 11px;
  gap: 8px;
  justify-content: space-between;
}

.qor-detail-subsection em {
  color: var(--text-primary);
  font-style: normal;
  white-space: nowrap;
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
