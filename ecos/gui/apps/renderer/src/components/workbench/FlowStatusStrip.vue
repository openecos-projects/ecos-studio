<template>
  <section class="flow-status-strip" aria-label="Flow execution status">
    <header class="flow-status-header">
      <div class="flow-status-heading">
        <i class="ri-git-branch-line" aria-hidden="true" />
        <span>{{ title }}</span>
        <span v-if="loading" class="flow-status-refreshing">Updating</span>
      </div>
      <div class="flow-status-counts" aria-label="Flow status summary">
        <span title="Succeeded"
          ><i class="ri-checkbox-circle-fill is-succeeded" />{{ summary.succeeded }}</span
        >
        <span title="Running"
          ><i class="ri-loader-4-line is-running" />{{ summary.running }}</span
        >
        <span title="Failed"
          ><i class="ri-close-circle-fill is-failed" />{{ summary.failed }}</span
        >
        <span title="Queued"
          ><i class="ri-time-line is-queued" />{{ summary.queued }}</span
        >
      </div>
    </header>

    <div v-if="nodes.length" class="flow-status-track" :style="trackStyle">
      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="flow-status-node"
        :class="[`is-${node.status}`, { 'is-selected': node.id === selectedId }]"
        :aria-pressed="node.id === selectedId"
        :title="`${node.label}: ${statusLabel(node.status)}`"
        @click="selectNode(node.id)"
      >
        <span class="flow-status-node-mark" aria-hidden="true">
          <i :class="statusIcon(node.status)" />
        </span>
        <span class="flow-status-node-label">{{ node.label }}</span>
      </button>
    </div>
    <div v-else class="flow-status-empty">No flow steps are available yet.</div>

    <div v-if="selectedNode" class="flow-status-detail" aria-live="polite">
      <div class="flow-status-detail-title">
        <i :class="[statusIcon(selectedNode.status), `is-${selectedNode.status}`]" />
        <strong>{{ selectedNode.label }}</strong>
        <span>{{ statusLabel(selectedNode.status) }}</span>
      </div>
      <dl>
        <div>
          <dt>Runtime</dt>
          <dd>{{ selectedNode.runtime || '--' }}</dd>
        </div>
        <div>
          <dt>Peak memory</dt>
          <dd>{{ formatPeakMemory(selectedNode.peakMemoryMb) }}</dd>
        </div>
        <div v-if="selectedNode.detail" class="flow-status-detail-summary">
          <dt>Latest update</dt>
          <dd>{{ selectedNode.detail }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  flowStatusSummary,
  formatPeakMemory,
  initialSelectedNodeId,
  statusIcon,
  statusLabel,
  type FlowStatusNode,
} from './flowStatus'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    nodes: FlowStatusNode[]
    title: string
  }>(),
  { loading: false },
)

const emit = defineEmits<{
  select: [node: FlowStatusNode]
}>()

const selectedId = ref<string | null>(initialSelectedNodeId(props.nodes))
const summary = computed(() => flowStatusSummary(props.nodes))
const selectedNode = computed(
  () => props.nodes.find((node) => node.id === selectedId.value) ?? null,
)
const trackStyle = computed(() => ({
  '--flow-step-count': String(Math.max(props.nodes.length, 1)),
}))

watch(
  () => props.nodes,
  (nodes) => {
    if (!nodes.some((node) => node.id === selectedId.value)) {
      selectedId.value = initialSelectedNodeId(nodes)
    }
  },
  { deep: true },
)

function selectNode(id: string): void {
  selectedId.value = id
  const node = props.nodes.find((item) => item.id === id)
  if (node) emit('select', node)
}
</script>

<style scoped>
.flow-status-strip {
  container-type: inline-size;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  min-width: 0;
  overflow: hidden;
}

.flow-status-header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 38px;
  padding: 8px 12px 6px;
}

.flow-status-heading,
.flow-status-counts,
.flow-status-counts span,
.flow-status-detail-title {
  align-items: center;
  display: flex;
}

.flow-status-heading {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  gap: 6px;
  min-width: 0;
}

.flow-status-heading span:not(.flow-status-refreshing) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-status-refreshing {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 500;
}

.flow-status-counts {
  color: var(--text-secondary);
  flex: 0 0 auto;
  font-size: 10px;
  gap: 7px;
}

.flow-status-counts span {
  gap: 2px;
}

.flow-status-counts i,
.flow-status-detail-title i {
  font-size: 13px;
}

.flow-status-track {
  display: grid;
  grid-template-columns: repeat(var(--flow-step-count), minmax(0, 1fr));
  min-height: 48px;
  overflow: hidden;
  padding: 0 10px;
}

.flow-status-node {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  padding: 3px 1px 5px;
  position: relative;
}

.flow-status-node::before,
.flow-status-node::after {
  background: var(--border-color);
  content: '';
  height: 1px;
  position: absolute;
  top: 15px;
  width: calc(50% - 8px);
}

.flow-status-node::before {
  left: 0;
}

.flow-status-node::after {
  right: 0;
}

.flow-status-node:first-child::before,
.flow-status-node:last-child::after {
  display: none;
}

.flow-status-node-mark {
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  display: inline-flex;
  flex: 0 0 auto;
  height: 18px;
  justify-content: center;
  position: relative;
  width: 18px;
  z-index: 1;
}

.flow-status-node-mark i {
  font-size: 12px;
  line-height: 1;
}

.flow-status-node-label {
  font-size: 9px;
  line-height: 12px;
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-status-node:hover .flow-status-node-mark,
.flow-status-node.is-selected .flow-status-node-mark {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.flow-status-node.is-selected::before,
.flow-status-node.is-selected::after,
.flow-status-node.is-succeeded::before,
.flow-status-node.is-succeeded::after {
  background: color-mix(in srgb, var(--success-color) 55%, var(--border-color));
}

.is-succeeded {
  color: var(--success-color);
}

.is-running {
  color: var(--accent-color);
}

.is-failed {
  color: var(--danger-color);
}

.is-queued,
.is-skipped {
  color: var(--text-secondary);
}

.flow-status-node.is-running .flow-status-node-mark {
  animation: flow-status-pulse 1.4s ease-in-out infinite;
  border-color: var(--accent-color);
}

.flow-status-empty {
  color: var(--text-secondary);
  font-size: 11px;
  padding: 12px;
}

.flow-status-detail {
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  min-width: 0;
  padding: 7px 12px 8px;
}

.flow-status-detail-title {
  gap: 5px;
  min-width: 0;
}

.flow-status-detail-title strong {
  color: var(--text-primary);
  font-size: 11px;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-status-detail-title span {
  color: var(--text-secondary);
  font-size: 10px;
}

.flow-status-detail dl {
  display: grid;
  gap: 5px 12px;
  grid-template-columns: repeat(2, minmax(0, max-content));
  margin: 5px 0 0;
}

.flow-status-detail dl > div {
  display: flex;
  gap: 4px;
  min-width: 0;
}

.flow-status-detail dt,
.flow-status-detail dd {
  font-size: 9px;
  margin: 0;
}

.flow-status-detail dt {
  color: var(--text-secondary);
}

.flow-status-detail dd {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-status-detail-summary {
  grid-column: 1 / -1;
}

@container (max-width: 340px) {
  .flow-status-node-label {
    display: none;
  }

  .flow-status-track {
    min-height: 31px;
  }

  .flow-status-node {
    justify-content: center;
    padding: 2px 0;
  }
}

@keyframes flow-status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-color) 0%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-color) 28%, transparent);
  }
}
</style>
