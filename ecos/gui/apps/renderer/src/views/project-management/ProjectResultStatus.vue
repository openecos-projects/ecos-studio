<template>
  <span class="result-status" :title="statusTitle">
    <span class="workspace-flow-hint" :class="`flow-hint-${hint.state}`">{{
      hint.label
    }}</span>
    <small v-if="previous">{{ previous }}</small>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectWorkspace } from '@/utils/projectManagement'
import { previousProjectResultLabel } from '@/utils/projectResultPresentation'

const props = defineProps<{
  hint: ProjectWorkspace['flowStatusHint']
  resultState?: ProjectWorkspace['resultState']
}>()
const previous = computed(() => previousProjectResultLabel(props.resultState))
const statusTitle = computed(() => {
  const revision = props.resultState
    ? `Current configuration: Revision ${props.resultState.workspaceRevision}`
    : ''
  return [props.hint.label, previous.value, revision].filter(Boolean).join(' · ')
})
</script>

<style scoped>
.result-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  text-align: right;
}
.result-status small {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.workspace-flow-hint {
  max-width: 100%;
  padding: 4px 7px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 750;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flow-hint-success {
  color: var(--success-color);
  background: var(--success-bg);
}
.flow-hint-running,
.flow-hint-warning {
  color: var(--warn-color);
  background: var(--warn-bg);
}
.flow-hint-failed {
  color: var(--danger-color);
  background: var(--danger-bg);
}
</style>
