<template>
  <Dialog
    :visible="true"
    modal
    maximizable
    :header="`${step.label} — Log`"
    :style="{ width: 'min(1100px, calc(100vw - 32px))' }"
    :draggable="false"
    @update:visible="$emit('close')"
  >
    <div class="step-log-dialog">
      <FlowLogPanel
        :active-step-name="flowLogStepName"
        :content-by-key="flowLogContentByKey"
        :ensure-content="ensureFlowLogSegmentContentLoaded"
        :error="flowLogError"
        :execution-active="currentWorkspaceFlowExecutionActive"
        :loading="flowLogLoading"
        :selected-node="step"
        :selected-node-pinned="true"
        :segments="flowLogSegments"
      />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import FlowLogPanel from '@/components/workbench/FlowLogPanel.vue'
import { useBackendFlowLogs } from '@/composables/useBackendFlowLogs'
import type { DashboardFlowStep } from './flowDashboardData'

defineProps<{ step: DashboardFlowStep }>()
defineEmits<{ close: [] }>()
const {
  currentWorkspaceFlowExecutionActive,
  flowLogStepName,
  flowLogContentByKey,
  ensureFlowLogSegmentContentLoaded,
  flowLogError,
  flowLogLoading,
  flowLogSegments,
} = useBackendFlowLogs()
</script>

<style scoped>
.step-log-dialog {
  display: flex;
  height: min(65vh, 640px);
  min-height: 200px;
}
.step-log-dialog :deep(.flow-log-panel) {
  flex: 1;
  max-height: none;
}
</style>
