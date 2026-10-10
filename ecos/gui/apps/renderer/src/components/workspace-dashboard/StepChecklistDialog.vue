<template>
  <Dialog
    :visible="true"
    modal
    :header="`${step.label} — Checklist Details`"
    :style="{ width: 'min(800px, calc(100vw - 32px))' }"
    :draggable="false"
    @update:visible="$emit('close')"
  >
    <div class="step-checklist">
      <section
        v-for="finding in step.checklist"
        :key="finding.id"
        :class="{ blocked: finding.blocked }"
      >
        <header>
          <strong>{{ finding.title }}</strong
          ><span>{{ finding.state }}</span>
        </header>
        <small>{{ finding.category }}</small>
        <p>{{ finding.summary }}</p>
        <p v-if="finding.reconciled">
          Reconciled with committed flow: {{ finding.reconciled.previousState }} → pass
          ({{ finding.reconciled.committedFlowState }})
        </p>
        <button type="button" @click="void toggleFinding(finding.id)">
          {{ expandedFindingId === finding.id ? 'Hide evidence' : 'View evidence' }}
        </button>
        <template v-if="expandedFindingId === finding.id">
          <pre v-if="evidenceState(finding.id)?.status === 'ready'">{{
            evidenceText(finding.id)
          }}</pre>
          <p v-else-if="evidenceState(finding.id)?.status === 'unavailable'">
            {{ evidenceError(finding.id) }}
          </p>
          <p v-else role="status">Loading evidence…</p>
        </template>
      </section>
      <p v-if="!step.checklist.length">No checklist detail is available for this step.</p>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import {
  useChecklistEvidence,
  checklistEvidenceLabel,
} from '@/composables/useChecklistEvidence'
import type { DashboardFlowStep } from './flowDashboardData'

defineProps<{ step: DashboardFlowStep }>()
defineEmits<{ close: [] }>()
const { expandedFindingId, evidenceState, toggleFinding } = useChecklistEvidence()
function evidenceText(id: string): string {
  const state = evidenceState(id)
  return state?.status === 'ready' ? state.text : ''
}
function evidenceError(id: string): string {
  const state = evidenceState(id)
  return state?.status === 'unavailable' ? checklistEvidenceLabel(state.code) : ''
}
</script>

<style scoped>
.step-checklist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
section {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
}
section.blocked {
  border-color: var(--error-color, #ef4444);
}
header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
p,
small {
  color: var(--text-secondary);
  font-size: 12px;
}
button {
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
}
pre {
  padding: 8px;
  overflow: auto;
  max-height: 360px;
  font-size: 12px;
}
</style>
