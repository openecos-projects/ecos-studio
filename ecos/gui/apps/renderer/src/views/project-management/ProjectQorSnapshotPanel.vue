<template>
  <section class="dash-qphys" aria-label="QoR v3 Snapshot">
    <header class="dash-section-head">
      <span>QoR record breakdown</span>
      <small>scored by ECC</small>
    </header>
    <div v-if="insights.dimensions.length > 0" class="dash-qphys-list">
      <div
        v-for="dimension in insights.dimensions"
        :key="dimension.key"
        class="dash-qphys-row"
      >
        <span class="dash-qphys-label">{{ dimension.label }}</span>
        <span
          class="dash-qphys-bar"
          role="img"
          :aria-label="dimension.label + ' ' + dimension.display + ' of 100'"
        >
          <i
            :class="dashboardToneClass(dimension.tone)"
            :style="{ width: (dimension.percent ?? 0) + '%' }"
          ></i>
        </span>
        <strong class="dash-qphys-value">{{ dimension.display }}</strong>
        <small class="dash-qphys-state">{{ dimension.state }}</small>
      </div>
    </div>
    <p v-else class="dash-qphys-empty">QoR v3 Snapshot unavailable</p>
    <div v-if="insights.diagnoses.length > 0" class="dash-diagnoses">
      <details v-for="diagnosis in insights.diagnoses" :key="diagnosis.id">
        <summary :class="dashboardToneClass(diagnosis.tone)">
          {{ diagnosis.state }} · {{ diagnosis.id }} · {{ diagnosis.confidence }}
        </summary>
        <p v-if="diagnosis.severity !== null">
          Severity {{ diagnosis.severity.toFixed(2) }}
        </p>
        <p v-if="diagnosis.evidence.length" class="dash-diagnosis-evidence">
          Evidence: {{ diagnosis.evidence.join(', ') }}
        </p>
        <p
          v-for="intervention in diagnosis.interventions"
          :key="intervention"
          class="dash-diagnosis-hypothesis"
        >
          {{ intervention }}
        </p>
        <p v-if="diagnosis.validationRequired" class="dash-diagnosis-validation">
          Validate: {{ diagnosis.validationRequired }}
        </p>
      </details>
    </div>
    <details
      v-if="insights.evidence || insights.feasibility || insights.power"
      class="dash-qor-facts-disclosure"
    >
      <summary>Record details</summary>
      <dl class="dash-qor-facts">
        <div v-if="insights.evidence">
          <dt>Evidence</dt>
          <dd>
            {{ insights.evidence.state }} · {{ formatIndex(insights.evidence.index) }}
            <small>
              Integrity {{ formatRatio(insights.evidence.integrity) }} · Coverage
              {{ formatRatio(insights.evidence.coverage) }} · Consistency
              {{ formatRatio(insights.evidence.consistency) }}
            </small>
          </dd>
        </div>
        <div v-if="insights.feasibility">
          <dt>Feasibility</dt>
          <dd>{{ insights.feasibility.status }}</dd>
          <ul v-if="insights.feasibility.gates.length" class="dash-qor-gates">
            <li v-for="gate in insights.feasibility.gates" :key="gate.id">
              <span>{{ gate.id }}</span>
              <small>{{ gate.state }}</small>
            </li>
          </ul>
        </div>
        <div v-if="insights.power">
          <dt>Power</dt>
          <dd>{{ formatPower(insights.power.totalUw, insights.power.budgetUw) }}</dd>
        </div>
      </dl>
    </details>
  </section>
</template>

<script setup lang="ts">
import type { DashboardQorInsights } from './projectDashboard'
import { dashboardToneClass } from './projectDashboard'

defineProps<{
  insights: DashboardQorInsights
}>()

function formatIndex(value: number | null): string {
  return value === null ? 'NR' : value.toFixed(1) + '/100'
}

function formatRatio(value: number | null): string {
  return value === null ? 'NR' : Math.round(value * 100) + '%'
}

function formatPower(totalUw: number | null, budgetUw: number | null): string {
  const total = totalUw === null ? 'NR' : totalUw.toFixed(1) + ' uW'
  const budget = budgetUw === null ? 'NR' : budgetUw.toFixed(1) + ' uW budget'
  return total + ' · ' + budget
}
</script>

<style scoped>
.dash-qphys {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-radius: 8px;
  padding: 16px 18px 14px;
  background: var(--bg-primary);
}

.dash-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.dash-section-head span {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 750;
}

.dash-section-head small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tone-good {
  color: var(--success-color);
}

.tone-warn {
  color: var(--warn-color);
}

.tone-bad {
  color: var(--danger-color);
}

.tone-neutral {
  color: var(--text-secondary);
}

.dash-qphys-list {
  display: grid;
  gap: 13px;
}

.dash-qphys-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.35fr) minmax(120px, 1.8fr) 48px minmax(
      100px,
      0.35fr
    );
  align-items: center;
  gap: 12px;
  min-height: 30px;
}

.dash-qphys-label,
.dash-qphys-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-qphys-label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.dash-qphys-value {
  color: var(--text-primary);
  font-size: 14px;
  text-align: right;
}

.dash-qphys-state {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.15;
  text-align: right;
  text-transform: uppercase;
}

.dash-qphys-bar {
  display: block;
  height: 7px;
  overflow: hidden;
  border-radius: 3px;
  background: color-mix(in srgb, var(--border-color) 70%, transparent);
}

.dash-qphys-bar i {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
  background: var(--text-secondary);
}

.dash-qphys-bar i.tone-good {
  background: var(--success-color);
}

.dash-qphys-bar i.tone-warn {
  background: var(--warn-color);
}

.dash-qphys-bar i.tone-bad {
  background: var(--danger-color);
}

.dash-qphys-empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.dash-qor-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 8px 0 0;
  padding-top: 0;
}

.dash-qor-facts-disclosure {
  order: 1;
  margin-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  padding-top: 8px;
}

.dash-qor-facts-disclosure summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  list-style-position: inside;
}

.dash-qor-facts-disclosure[open] summary {
  color: var(--text-primary);
}

.dash-qor-facts div {
  min-width: 0;
}

.dash-qor-facts dt,
.dash-qor-facts dd {
  margin: 0;
}

.dash-qor-gates {
  display: grid;
  gap: 3px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  color: var(--text-secondary);
  font-size: 10px;
}

.dash-qor-gates li {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.dash-qor-facts dt {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.dash-qor-facts dd {
  margin-top: 4px;
  color: var(--text-primary);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.dash-qor-facts dd small {
  display: block;
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 10px;
}

.dash-qor-gates span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dash-diagnoses {
  order: 2;
  display: grid;
  gap: 6px;
  margin-top: auto;
  padding-top: 14px;
}

.dash-diagnoses details {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  padding-top: 7px;
}

.dash-diagnoses summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.dash-diagnoses p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.dash-diagnosis-hypothesis {
  padding-left: 10px;
}

@media (max-width: 700px) {
  .dash-qor-facts {
    grid-template-columns: 1fr;
  }

  .dash-qphys-row {
    grid-template-columns: minmax(76px, 0.8fr) minmax(70px, 1.2fr) 38px;
  }

  .dash-qphys-state {
    display: none;
  }
}
</style>
