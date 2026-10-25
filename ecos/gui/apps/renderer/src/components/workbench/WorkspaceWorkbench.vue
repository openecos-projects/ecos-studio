<template>
  <div
    class="workspace-workbench"
    :class="{
      'is-agent-hidden': agentOnly && !workspaceAgentOpen,
      'is-agent-only': agentOnly,
    }"
  >
    <Splitter class="workspace-workbench-splitter" :gutter-size="7">
      <SplitterPanel :size="75" :min-size="33" class="workspace-workbench-left">
        <slot name="left" />
      </SplitterPanel>
      <SplitterPanel :size="25" :min-size="25" class="workspace-workbench-right">
        <FlowStatusStrip
          v-if="!agentOnly"
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
          v-if="!agentOnly"
          name="right-log"
          :selected-node="selectedLogNode"
          :selected-node-pinned="logSelectionPinned"
        />
        <div v-if="workspaceAgentOpen" class="workspace-workbench-inspector">
          <ChatInspectorPanel :hide-gui-artifacts="agentOnly" />
        </div>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
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
import { useAgentShellStore } from '@/stores/agentShellStore'

const props = withDefaults(
  defineProps<{
    flowTitle: string
    loading?: boolean
    logRerunAffectedSteps?: readonly string[]
    nodes: FlowStatusNode[]
    agentOnly?: boolean
  }>(),
  { loading: false },
)

const agentShell = useAgentShellStore()
const { workspaceAgentOpen } = storeToRefs(agentShell)

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

.is-agent-hidden :deep(.p-splitter-gutter),
.is-agent-hidden .workspace-workbench-right {
  display: none;
}

.is-agent-hidden .workspace-workbench-left {
  flex-basis: 100% !important;
  flex-grow: 1;
}

.is-agent-only .workspace-workbench-inspector {
  min-height: 0;
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

.workspace-workbench-flow-status {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
}

.workspace-workbench-right > .workspace-workbench-inspector {
  display: flex;
  flex: 1 1 0px;
  height: auto !important;
  min-height: clamp(184px, 30vh, 280px);
  min-width: 0;
  overflow: hidden;
}
</style>
