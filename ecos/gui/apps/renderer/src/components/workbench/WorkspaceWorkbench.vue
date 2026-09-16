<template>
  <div class="workspace-workbench">
    <Splitter class="workspace-workbench-splitter" :gutter-size="7">
      <SplitterPanel :size="60" :min-size="33" class="workspace-workbench-left">
        <slot name="left" />
      </SplitterPanel>
      <SplitterPanel
        :size="40"
        :min-size="25"
        class="workspace-workbench-right"
        :class="{ 'workspace-workbench-right--agent-collapsed': workspaceAgentCollapsed }"
      >
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
        <div v-show="!workspaceAgentCollapsed" class="workspace-workbench-inspector">
          <ChatInspectorPanel />
        </div>
        <div v-if="workspaceAgentCollapsed" class="workspace-workbench-agent-collapsed">
          <button
            type="button"
            class="workspace-workbench-agent-toggle"
            :title="expandAgentTitle"
            aria-label="Expand Agent panel"
            aria-expanded="false"
            @click="agentShell.setWorkspaceAgentCollapsed(false)"
          >
            <i class="ri-sparkling-2-line" aria-hidden="true" />
            <span>Agent</span>
            <span class="workspace-workbench-agent-status" :data-state="codexStatusState">
              <span class="workspace-workbench-agent-status-dot" aria-hidden="true" />
              {{ codexStatusLabel }}
            </span>
            <i class="ri-arrow-up-s-line" aria-hidden="true" />
          </button>
        </div>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
import { getDesktopApi } from '@/platform/desktop'
import { useAgentShellStore } from '@/stores/agentShellStore'

const props = withDefaults(
  defineProps<{
    flowTitle: string
    loading?: boolean
    logRerunAffectedSteps?: readonly string[]
    nodes: FlowStatusNode[]
  }>(),
  { loading: false },
)

const agentShell = useAgentShellStore()
const { workspaceAgentCollapsed, codexStatus } = storeToRefs(agentShell)
const codexStatusState = computed(() => codexStatus.value?.state ?? 'unknown')
const codexStatusLabel = computed(() => {
  switch (codexStatus.value?.state) {
    case 'ready':
      return codexStatus.value.binPath ? 'Codex ready' : 'Agent ready'
    case 'needs_api_key':
      return 'Codex API key required'
    case 'installing':
      return 'Codex installing'
    case 'error':
      return 'Codex unavailable'
    case 'missing':
      return 'Codex not found'
    default:
      return 'Checking Codex'
  }
})
const expandAgentTitle = computed(() => {
  const binPath = codexStatus.value?.binPath
  return binPath ? `Expand Agent panel (${binPath})` : 'Expand Agent panel'
})

onMounted(() => {
  if (!workspaceAgentCollapsed.value) return
  try {
    const codex = getDesktopApi().agent?.codex
    if (!codex) return
    void codex
      .getStatus()
      .then((status) => agentShell.setCodexStatus(status))
      .catch(() => undefined)
  } catch {
    // The renderer can be mounted without the desktop bridge in tests.
  }
})

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

.workspace-workbench-right--agent-collapsed :deep(.flow-log-panel) {
  flex: 1 1 auto;
  min-height: 0;
}

.workspace-workbench-agent-collapsed {
  flex: 0 0 auto;
  min-height: 34px;
  border-bottom: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 62%, var(--bg-primary));
}

.workspace-workbench-agent-toggle {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  padding: 0.3rem 0.625rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.6875rem;
  text-align: left;
}

.workspace-workbench-agent-toggle:hover {
  background: color-mix(in srgb, var(--accent-color) 9%, var(--bg-primary));
  color: var(--text-primary);
}

.workspace-workbench-agent-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: -2px;
}

.workspace-workbench-agent-status {
  display: inline-flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.3rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-workbench-agent-status-dot {
  width: 0.4rem;
  height: 0.4rem;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--text-secondary);
}

.workspace-workbench-agent-status[data-state='ready']
  .workspace-workbench-agent-status-dot {
  background: var(--success-color, #22c55e);
}

.workspace-workbench-agent-status[data-state='error']
  .workspace-workbench-agent-status-dot,
.workspace-workbench-agent-status[data-state='missing']
  .workspace-workbench-agent-status-dot,
.workspace-workbench-agent-status[data-state='installed_needs_login']
  .workspace-workbench-agent-status-dot {
  background: var(--warning-color, #f59e0b);
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
  display: flex;
  flex: 1 1 auto;
  height: auto !important;
  min-height: clamp(184px, 30vh, 280px);
  min-width: 0;
  overflow: hidden;
}
</style>
