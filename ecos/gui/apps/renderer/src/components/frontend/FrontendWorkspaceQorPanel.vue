<template>
  <section class="workspace-qor" aria-label="Quality of Results">
    <header class="workspace-qor__header">
      <div>
        <span>Quality of Results</span>
        <strong>{{ stepLabel }}</strong>
      </div>
      <span class="workspace-qor__status" :class="`is-${qor.status}`">
        <i :class="frontendQorStatusIcon(qor.status)" aria-hidden="true"></i>
        {{ frontendQorStatusLabel(qor.status) }}
      </span>
    </header>

    <template v-if="qor.available">
      <section v-if="qor.score" class="workspace-qor__section">
        <FrontendQorScoreBreakdown :score="qor.score" :status="qor.status" />
      </section>

      <section class="workspace-qor__section">
        <header>
          <span>Quality Gates</span>
          <small>{{ passingGateCount }}/{{ qor.gates.length }} passed</small>
        </header>
        <div class="workspace-qor__gates">
          <div v-for="gate in qor.gates" :key="gate.id" class="workspace-qor__gate">
            <i :class="frontendQorGateIcon(gate.state)" aria-hidden="true"></i>
            <span>
              <strong>{{ gate.label }}</strong>
              <small>{{ frontendQorGateEvidence(gate) }}</small>
            </span>
            <em :class="`is-${gate.state}`">{{ gate.state }}</em>
          </div>
        </div>
      </section>

      <section class="workspace-qor__section">
        <header>
          <span>Measured Results</span>
          <small>{{ qor.metrics.length }} metrics</small>
        </header>
        <dl class="workspace-qor__metrics">
          <div v-for="metric in qor.metrics" :key="metric.id">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.display }}</dd>
            <small>{{ metric.category }}</small>
          </div>
        </dl>
      </section>

      <section v-if="qor.hotspots.length" class="workspace-qor__section">
        <header>
          <span>Hotspots</span>
          <small>{{ qor.hotspots.length }} reported</small>
        </header>
        <ul class="workspace-qor__hotspots" tabindex="0" aria-label="QoR hotspots">
          <li v-for="hotspot in qor.hotspots" :key="hotspot.id">
            <i :class="frontendQorHotspotIcon(hotspot.severity)" aria-hidden="true"></i>
            <span>
              <strong>{{ hotspot.label }}</strong>
              <p>{{ hotspot.description }}</p>
              <small v-if="hotspot.source">{{ hotspot.source }}</small>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <div v-else class="workspace-qor__empty">
      <i :class="frontendQorStatusIcon(qor.status)" aria-hidden="true"></i>
      <div>
        <strong>{{ frontendQorStatusLabel(qor.status) }}</strong>
        <span>No complete QoR artifact set is available for this step.</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FrontendQorScoreBreakdown from '@/components/frontend/FrontendQorScoreBreakdown.vue'
import {
  frontendQorGateEvidence,
  frontendQorGateIcon,
  frontendQorHotspotIcon,
  frontendQorStatusIcon,
  frontendQorStatusLabel,
  type FrontendStepQorAnalysis,
} from '@/utils/frontendQor'

const props = defineProps<{
  qor: FrontendStepQorAnalysis
  stepLabel: string
}>()

const passingGateCount = computed(
  () => props.qor.gates.filter((gate) => gate.state === 'pass').length,
)
</script>

<style scoped>
.workspace-qor {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-gutter: stable;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.workspace-qor__header,
.workspace-qor__section > header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.workspace-qor__header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
}

.workspace-qor__header > div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.workspace-qor__header span,
.workspace-qor__section > header span {
  font-size: 12px;
  font-weight: 760;
}

.workspace-qor__header strong,
.workspace-qor__section > header small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-qor__status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--text-secondary) 28%, transparent);
  border-radius: 4px;
  padding: 3px 7px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 65%, transparent);
  font-size: 10px;
  font-weight: 750;
  line-height: 1.2;
  white-space: nowrap;
}

.workspace-qor__status.is-pass {
  border-color: color-mix(in srgb, var(--success-color) 35%, transparent);
  color: var(--success-color);
  background: color-mix(in srgb, var(--success-color) 7%, transparent);
}

.workspace-qor__status.is-blocked {
  border-color: color-mix(in srgb, var(--danger-color) 38%, transparent);
  color: var(--danger-color);
  background: color-mix(in srgb, var(--danger-color) 7%, transparent);
}

.workspace-qor__status.is-incomplete {
  border-color: color-mix(in srgb, var(--warn-color) 38%, transparent);
  color: var(--warn-color);
  background: color-mix(in srgb, var(--warn-color) 7%, transparent);
}

.workspace-qor__section {
  padding: 14px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
}

.workspace-qor__section > header {
  margin-bottom: 10px;
}

.workspace-qor__gates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--border-color);
}

.workspace-qor__gate {
  display: grid;
  min-width: 0;
  min-height: 48px;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--bg-primary);
}

.workspace-qor__gate span,
.workspace-qor__hotspots span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.workspace-qor__gate strong,
.workspace-qor__gate small,
.workspace-qor__hotspots strong,
.workspace-qor__hotspots p,
.workspace-qor__hotspots small {
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-qor__gate strong,
.workspace-qor__hotspots strong {
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.workspace-qor__gate small,
.workspace-qor__hotspots small {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  white-space: nowrap;
}

.workspace-qor__gate em {
  color: var(--text-secondary);
  font-size: 9px;
  font-style: normal;
  font-weight: 760;
  text-transform: uppercase;
}

.workspace-qor__gate em.is-pass {
  color: var(--success-color);
}

.workspace-qor__gate em.is-failed {
  color: var(--danger-color);
}

.workspace-qor__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--border-color);
}

.workspace-qor__metrics > div {
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 9px 10px;
  background: var(--bg-primary);
}

.workspace-qor__metrics dt,
.workspace-qor__metrics dd {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-qor__metrics dt,
.workspace-qor__metrics small {
  color: var(--text-secondary);
  font-size: 10px;
}

.workspace-qor__metrics dd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  font-weight: 750;
}

.workspace-qor__hotspots {
  max-height: clamp(160px, 38vh, 360px);
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  list-style: none;
}

.workspace-qor__hotspots:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 72%, transparent);
  outline-offset: 2px;
}

.workspace-qor__hotspots li {
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  padding: 8px 10px;
}

.workspace-qor__hotspots li + li {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
}

.workspace-qor__hotspots p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.35;
  white-space: normal;
}

.workspace-qor__empty {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--text-secondary);
}

.workspace-qor__empty > i {
  font-size: 24px;
}

.workspace-qor__empty > div {
  display: grid;
  gap: 3px;
}

.workspace-qor__empty strong {
  color: var(--text-primary);
  font-size: 12px;
}

.workspace-qor__empty span {
  font-size: 11px;
}

@media (max-width: 900px) {
  .workspace-qor__gates,
  .workspace-qor__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-qor__metrics > div:nth-child(odd) {
    border-left: 0;
  }
}

@media (max-width: 620px) {
  .workspace-qor__header {
    align-items: flex-start;
  }

  .workspace-qor__header > div {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }

  .workspace-qor__gates,
  .workspace-qor__metrics {
    grid-template-columns: 1fr;
  }
}
</style>
