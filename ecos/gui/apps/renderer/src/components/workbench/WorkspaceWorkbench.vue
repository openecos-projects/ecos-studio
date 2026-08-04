<template>
  <div class="workspace-workbench">
    <Splitter class="workspace-workbench-splitter" :gutter-size="7">
      <SplitterPanel :size="60" :min-size="33" class="workspace-workbench-left">
        <slot name="left" />
      </SplitterPanel>
      <SplitterPanel :size="40" :min-size="25" class="workspace-workbench-right">
        <div ref="chatToolbarTarget" class="workspace-workbench-chat-toolbar" />
        <FlowStatusStrip
          class="workspace-workbench-flow-status"
          :loading="loading"
          :nodes="nodes"
          :title="flowTitle"
          @select="selectedFlowNode = $event"
        >
          <template #actions>
            <FlowRunControl />
          </template>
        </FlowStatusStrip>
        <slot name="right-log" :selected-node="selectedFlowNode" />
        <ChatInspectorPanel
          class="workspace-workbench-inspector"
          :toolbar-target="chatToolbarTarget"
        />
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import ChatInspectorPanel from '@/components/ChatInspectorPanel.vue'
import FlowRunControl from './FlowRunControl.vue'
import FlowStatusStrip from './FlowStatusStrip.vue'
import { initialSelectedNodeId, type FlowStatusNode } from './flowStatus'

const chatToolbarTarget = ref<HTMLElement | null>(null)

const props = withDefaults(
  defineProps<{
    flowTitle: string
    loading?: boolean
    nodes: FlowStatusNode[]
  }>(),
  { loading: false },
)

const selectedFlowNode = ref<FlowStatusNode | null>(findInitialNode(props.nodes))

watch(
  () => props.nodes,
  (nodes) => {
    selectedFlowNode.value =
      nodes.find((node) => node.id === selectedFlowNode.value?.id) ??
      findInitialNode(nodes)
  },
  { deep: true },
)

function findInitialNode(nodes: readonly FlowStatusNode[]): FlowStatusNode | null {
  const id = initialSelectedNodeId(nodes)
  return nodes.find((node) => node.id === id) ?? null
}

defineSlots<{
  left(): unknown
  'right-log'(props: { selectedNode: FlowStatusNode | null }): unknown
}>()
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

.workspace-workbench-right > .workspace-workbench-chat-toolbar,
.workspace-workbench-flow-status {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
}

.workspace-workbench-right > .workspace-workbench-chat-toolbar {
  background: var(--bg-primary);
  min-height: 40px;
}

.workspace-workbench-right > .workspace-workbench-inspector {
  flex: 0 0 clamp(184px, 30vh, 280px);
  height: auto !important;
  margin-top: auto;
  min-height: 184px;
}
</style>
