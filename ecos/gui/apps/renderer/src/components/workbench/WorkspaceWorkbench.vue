<template>
  <div class="workspace-workbench">
    <Splitter class="workspace-workbench-splitter" :gutter-size="4">
      <SplitterPanel :size="60" :min-size="33" class="workspace-workbench-left">
        <slot name="left" />
      </SplitterPanel>
      <SplitterPanel :size="40" :min-size="25" class="workspace-workbench-right">
        <FlowStatusStrip :loading="loading" :nodes="nodes" :title="flowTitle" />
        <FlowReportPanel :reports="reports" />
        <slot name="right-extra" />
        <ChatInspectorPanel class="workspace-workbench-inspector" />
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import ChatInspectorPanel from '@/components/ChatInspectorPanel.vue'
import type { DashboardReport } from '@/components/home/dashboardData'
import FlowReportPanel from './FlowReportPanel.vue'
import FlowStatusStrip from './FlowStatusStrip.vue'
import type { FlowStatusNode } from './flowStatus'

withDefaults(
  defineProps<{
    flowTitle: string
    loading?: boolean
    nodes: FlowStatusNode[]
    reports?: DashboardReport[]
  }>(),
  { loading: false, reports: () => [] },
)
</script>

<style scoped>
.workspace-workbench {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.workspace-workbench-splitter {
  background: transparent;
  border: 0;
  display: flex;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

:deep(.p-splitterpanel) {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

:deep(.p-splitter-gutter) {
  background: var(--border-color);
  cursor: col-resize;
}

:deep(.p-splitter-gutter:hover) {
  background: var(--accent-color);
}

:deep(.p-splitter-gutter-handle) {
  display: none;
}

.workspace-workbench-left,
.workspace-workbench-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.workspace-workbench-left > *,
.workspace-workbench-right > * {
  min-height: 0;
  min-width: 0;
}

.workspace-workbench-left > * {
  flex: 1 1 auto;
}

.workspace-workbench-inspector {
  flex: 1 1 auto;
}
</style>
