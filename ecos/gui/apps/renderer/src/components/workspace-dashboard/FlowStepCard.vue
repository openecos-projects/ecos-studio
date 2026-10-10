<template>
  <article class="flow-step-card" :data-step="step.id" :data-status="step.status">
    <header :title="step.label">{{ step.label }}</header>
    <div class="step-resources">
      <button
        type="button"
        class="step-state"
        :class="`is-${step.status}`"
        :title="`${statusLabel(step.status)} — run ${step.label}`"
        :aria-label="`${statusLabel(step.status)} — run ${step.label}`"
        :disabled="step.status === 'running'"
        @click="$emit('run', step)"
      >
        <i
          :class="[
            statusIcon(step.status),
            { 'animate-spin': step.status === 'running' },
          ]"
          aria-hidden="true"
        />
      </button>
      <dl>
        <div>
          <dt>Time</dt>
          <dd>{{ step.runtime || '--' }}</dd>
        </div>
        <div>
          <dt>Peak</dt>
          <dd>{{ formatPeakMemory(step.peakMemoryMb) }}</dd>
        </div>
      </dl>
    </div>
    <button
      type="button"
      class="step-layout"
      :disabled="
        !step.thumbnail?.url ||
        !step.thumbnail.hasGeometry ||
        step.thumbnail.availability !== 'available'
      "
      :aria-label="`Open ${step.label} layout`"
      :title="step.thumbnail?.reason ?? `Open ${step.label} in Chip Viewer`"
      @click="$emit('layout', step)"
    >
      <img
        v-if="step.thumbnail?.url"
        :src="step.thumbnail.url"
        :alt="`${step.label} layout`"
      />
      <span v-else><i class="ri-image-2-line" aria-hidden="true" /> No layout</span>
    </button>
    <div class="step-checks">
      <span :class="`check-${step.checkState}`" :title="`Checklist: ${step.checkState}`">
        <i
          :class="
            step.checkState === 'passed'
              ? 'ri-checkbox-circle-fill'
              : step.checkState === 'blocked'
                ? 'ri-close-circle-fill'
                : 'ri-error-warning-line'
          "
          aria-hidden="true"
        />
        {{ step.checkState }}
      </span>
      <button
        type="button"
        :aria-label="`${step.label} checklist details`"
        @click="$emit('checklist', step)"
      >
        Details
      </button>
    </div>
    <footer>
      <button
        type="button"
        :aria-label="`${step.label} reports`"
        @click="$emit('reports', step)"
      >
        Reports
      </button>
      <button type="button" :aria-label="`${step.label} log`" @click="$emit('log', step)">
        Log
      </button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import {
  formatPeakMemory,
  statusIcon,
  statusLabel,
} from '@/components/workbench/flowStatus'
import type { DashboardFlowStep } from './flowDashboardData'

defineProps<{ step: DashboardFlowStep }>()
defineEmits<{
  run: [step: DashboardFlowStep]
  layout: [step: DashboardFlowStep]
  checklist: [step: DashboardFlowStep]
  reports: [step: DashboardFlowStep]
  log: [step: DashboardFlowStep]
}>()
</script>

<style scoped>
.flow-step-card {
  display: flex;
  flex-direction: column;
  width: 150px;
  height: 176px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 10px;
}
header {
  flex: 0 0 22px;
  padding: 3px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}
.step-resources {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
}
.step-state {
  font-size: 22px;
}
button {
  border: 0;
  background: transparent;
  color: var(--accent-color);
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.6;
}
button:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: -2px;
}
dl {
  flex: 1;
  margin: 0;
  min-width: 0;
}
dl > div {
  display: flex;
  justify-content: space-between;
  gap: 4px;
}
dt {
  color: var(--text-secondary);
}
dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.step-layout {
  flex: 1;
  min-height: 0;
  border-block: 1px solid var(--border-color);
  padding: 0;
}
.step-layout img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.step-layout span {
  color: var(--text-secondary);
}
.step-checks,
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
}
footer {
  border-top: 1px solid var(--border-color);
}
footer button {
  flex: 1;
}
.is-succeeded,
.check-passed {
  color: var(--success-color, #22c55e);
}
.is-failed,
.check-blocked {
  color: var(--error-color, #ef4444);
}
.is-running {
  color: var(--accent-color);
}
.is-warning,
.check-warning {
  color: var(--warning-color, #f59e0b);
}
.is-queued,
.is-skipped,
.check-unavailable {
  color: var(--text-secondary);
}
</style>
