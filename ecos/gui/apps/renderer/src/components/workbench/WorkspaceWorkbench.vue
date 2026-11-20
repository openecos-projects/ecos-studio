<template>
  <div class="workspace-workbench" :class="{ 'is-agent-hidden': !workspaceAgentOpen }">
    <Splitter class="workspace-workbench-splitter" :gutter-size="7">
      <SplitterPanel :size="75" :min-size="33" class="workspace-workbench-left">
        <slot name="left" />
      </SplitterPanel>
      <SplitterPanel :size="25" :min-size="25" class="workspace-workbench-right">
        <div v-if="workspaceAgentOpen" class="workspace-workbench-inspector">
          <ChatInspectorPanel hide-gui-artifacts />
        </div>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import ChatInspectorPanel from '@/components/ChatInspectorPanel.vue'
import { useAgentShellStore } from '@/stores/agentShellStore'

const { workspaceAgentOpen } = storeToRefs(useAgentShellStore())
</script>

<style scoped>
.workspace-workbench {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.is-agent-hidden :deep(.p-splitter-gutter),
.is-agent-hidden .workspace-workbench-right {
  display: none;
}

.is-agent-hidden .workspace-workbench-left {
  flex-basis: 100% !important;
  flex-grow: 1;
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

.workspace-workbench-right {
  background: var(--bg-secondary);
}

.workspace-workbench-left > *,
.workspace-workbench-right > * {
  min-width: 0;
}

.workspace-workbench-left > * {
  flex: 1 1 auto;
  min-height: 0;
}

.workspace-workbench-right > .workspace-workbench-inspector {
  display: flex;
  flex: 1 1 0px;
  height: auto !important;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
