<template>
  <div class="workspace-workbench">
    <Splitter class="workspace-workbench-splitter" :gutter-size="7">
      <SplitterPanel :size="60" :min-size="33" class="workspace-workbench-left">
        <slot name="left" />
      </SplitterPanel>
      <SplitterPanel :size="40" :min-size="25" class="workspace-workbench-right">
        <FlowStatusStrip
          class="workspace-workbench-flow-status"
          :loading="loading"
          :nodes="nodes"
          :title="flowTitle"
        >
          <template #actions>
            <FlowRunControl />
          </template>
        </FlowStatusStrip>
        <slot name="right-log" />
        <FlowReportPanel :reports="reports" />
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
import FlowRunControl from './FlowRunControl.vue'
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
  height: 100%;
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
  position: relative;
}

:deep(.p-splitter-gutter)::before {
  background: var(--accent-color);
  border-radius: 4px;
  content: '';
  height: 42px;
  left: 50%;
  opacity: 0.5;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
}

:deep(.p-splitter-gutter:hover) {
  background: var(--accent-color);
}

:deep(.p-splitter-gutter:hover)::before {
  background: var(--bg-primary);
  opacity: 1;
}

:deep(.p-splitter-gutter-handle) {
  display: none;
}

.workspace-workbench-left,
.workspace-workbench-right {
  align-items: stretch;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.workspace-workbench-left > *,
.workspace-workbench-right > * {
  min-height: 0;
  min-width: 0;
}

.workspace-workbench-left > * {
  flex: 1 1 auto;
}

.workspace-workbench-right > * {
  flex-shrink: 0;
}

.workspace-workbench-flow-status {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
}

.workspace-workbench-right > .workspace-workbench-inspector {
  flex: 1 1 0;
  height: auto !important;
  min-height: 0;
}
</style>
