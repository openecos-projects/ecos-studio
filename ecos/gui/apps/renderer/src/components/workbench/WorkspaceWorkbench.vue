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
          @select="selectFlowNode"
        >
          <template #actions>
            <FlowRunControl />
          </template>
        </FlowStatusStrip>
        <slot
          name="right-log"
          :selected-node="selectedLogNode"
          :selected-node-pinned="logSelectionPinned"
        />
        <ChatInspectorPanel class="workspace-workbench-inspector" />
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
import {
  initialSelectedNodeId,
  nextFlowNodeSelection,
  runningFlowNodeId,
  type FlowStatusNode,
} from './flowStatus'
import { sameFlowStepName } from '@/api/type'

const props = withDefaults(
  defineProps<{
    flowTitle: string
    loading?: boolean
    logRerunAffectedSteps?: readonly string[]
    nodes: FlowStatusNode[]
  }>(),
  { loading: false },
)

const selectedFlowNode = ref<FlowStatusNode | null>(findInitialNode(props.nodes))
const selectedLogNode = ref<FlowStatusNode | null>(selectedFlowNode.value)
const logSelectionPinned = ref(false)
let lastRunningNodeId = runningFlowNodeId(props.nodes)

watch(
  () => props.nodes,
  (nodes) => {
    const selection = nextFlowNodeSelection(
      nodes,
      selectedFlowNode.value?.id ?? null,
      lastRunningNodeId,
    )
    lastRunningNodeId = selection.runningNodeId
    selectedFlowNode.value =
      nodes.find((node) => node.id === selection.selectedNodeId) ?? findInitialNode(nodes)
    if (
      logSelectionPinned.value &&
      !nodes.some((node) => node.id === selectedLogNode.value?.id)
    ) {
      logSelectionPinned.value = false
    }
    if (!logSelectionPinned.value) selectedLogNode.value = selectedFlowNode.value
  },
  { deep: true },
)

watch(
  () => props.logRerunAffectedSteps,
  (affectedSteps) => {
    if (!logSelectionPinned.value || !selectedLogNode.value) return
    const affected = (affectedSteps ?? []).map((step) => step.trim()).filter(Boolean)
    if (!affected.some((step) => sameFlowStepName(step, selectedLogNode.value!.label))) {
      return
    }

    logSelectionPinned.value = false
    selectedLogNode.value = selectedFlowNode.value
  },
  { immediate: true },
)

function selectFlowNode(node: FlowStatusNode): void {
  selectedFlowNode.value = node
  selectedLogNode.value = node
  logSelectionPinned.value = true
}

function findInitialNode(nodes: readonly FlowStatusNode[]): FlowStatusNode | null {
  const id = initialSelectedNodeId(nodes)
  return nodes.find((node) => node.id === id) ?? null
}

defineSlots<{
  left(): unknown
  'right-log'(props: {
    selectedNode: FlowStatusNode | null
    selectedNodePinned: boolean
  }): unknown
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

.workspace-workbench-right {
  background: var(--bg-secondary);
}

.workspace-workbench-left > *,
.workspace-workbench-right > * {
  min-height: 0;
  min-width: 0;
}

.workspace-workbench-left > * {
  flex: 1 1 auto;
}

.workspace-workbench-flow-status {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
}

.workspace-workbench-right > .workspace-workbench-inspector {
  flex: 1 1 auto;
  height: auto !important;
  min-height: clamp(184px, 30vh, 280px);
}
</style>
