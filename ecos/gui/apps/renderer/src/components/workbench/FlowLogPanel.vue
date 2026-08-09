<template>
  <section
    v-if="visible"
    class="flow-log-panel"
    :class="{ 'is-collapsed': !expanded }"
    aria-label="Flow step log"
  >
    <header>
      <div class="flow-log-title">
        <i class="ri-terminal-box-line" aria-hidden="true" />
        <strong :title="logTitle">{{ logTitle }}</strong>
      </div>
      <div class="flow-log-actions">
        <button
          type="button"
          :title="copied ? 'Copied' : 'Copy log'"
          :aria-label="copied ? 'Copied log' : 'Copy log'"
          :disabled="!selectedContent"
          @click="copyLog"
        >
          <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Open log"
          aria-label="Open log"
          :disabled="!selectedSegment"
          @click="dialogVisible = true"
        >
          <i class="ri-fullscreen-line" aria-hidden="true" />
        </button>
        <button
          type="button"
          :title="expanded ? 'Collapse log' : 'Expand log'"
          :aria-label="expanded ? 'Collapse log' : 'Expand log'"
          @click="expanded = !expanded"
        >
          <i
            :class="expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"
            aria-hidden="true"
          />
        </button>
      </div>
    </header>
    <div v-if="expanded" class="flow-log-panel-body">
      <div v-if="error" class="flow-log-message is-error">{{ error }}</div>
      <div v-else-if="selectedSegment" class="flow-log-viewer">
        <FlowLogCodeViewer
          :content="selectedContent"
          :live="Boolean(selectedSegment.live)"
          :loading="loading"
          :missing="selectedSegment.missing"
        />
      </div>
      <div v-else class="flow-log-message">
        {{
          selectedNode
            ? `No log is available for ${selectedNode.label}.`
            : 'Waiting for the first flow step log.'
        }}
      </div>
    </div>
  </section>

  <Dialog
    v-model:visible="dialogVisible"
    class="flow-log-dialog"
    modal
    maximizable
    :header="logTitle"
    :style="{ width: 'min(980px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <pre class="flow-log-dialog-content">{{
      selectedContent || 'No log content yet.'
    }}</pre>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import FlowLogCodeViewer from '@/components/FlowLogCodeViewer.vue'
import { copyFlowLogText } from '@/components/flowLogCopy'
import { formatFlowLogTitle } from './flowLogTitle'
import type { FlowStatusNode } from './flowStatus'
import type { FlowLogSegment } from '@/composables/useHomeData'

const props = defineProps<{
  activeStepName: string
  contentByKey: Record<string, string>
  ensureContent: (segment: FlowLogSegment) => Promise<boolean>
  error: string | null
  executionActive: boolean
  loading: boolean
  selectedNode: FlowStatusNode | null
  segments: FlowLogSegment[]
}>()

const selectedKey = ref('')
const expanded = ref(true)
const dialogVisible = ref(false)
const copied = ref(false)
const visible = computed(() => props.executionActive || props.segments.length > 0)
const currentRuntimeSegment = computed(() => {
  const activeStepName = props.activeStepName.trim().toLowerCase()
  if (activeStepName) {
    const matching = props.segments.filter(
      (segment) => segment.stepName.trim().toLowerCase() === activeStepName,
    )
    const active =
      matching.find((segment) => segment.live) ?? matching[matching.length - 1]
    if (active) return active
  }
  return props.segments.find((segment) => segment.live) ?? null
})
const selectedSegment = computed(
  () => props.segments.find((segment) => keyFor(segment) === selectedKey.value) ?? null,
)
const selectedContent = computed(() =>
  selectedSegment.value ? (props.contentByKey[keyFor(selectedSegment.value)] ?? '') : '',
)
const logTitle = computed(() =>
  formatFlowLogTitle(selectedSegment.value, props.selectedNode),
)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function keyFor(segment: FlowLogSegment): string {
  return `${segment.stepName}\u001f${segment.tool}`
}

async function copyLog(): Promise<void> {
  if (!selectedContent.value) return
  const result = await copyFlowLogText(selectedContent.value)
  copied.value = result.ok
  if (copiedTimer) clearTimeout(copiedTimer)
  if (result.ok) {
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1200)
  }
}

function selectSegmentForNode(): void {
  if (props.executionActive && currentRuntimeSegment.value) {
    selectedKey.value = keyFor(currentRuntimeSegment.value)
    return
  }
  const node = props.selectedNode
  if (node) {
    const matchingSegments = props.segments.filter(
      (segment) =>
        segment.stepName.trim().toLowerCase() === node.label.trim().toLowerCase(),
    )
    const segment = matchingSegments.find((item) => item.live) ?? matchingSegments[0]
    selectedKey.value = segment ? keyFor(segment) : ''
    return
  }

  const segment = props.segments.find((item) => item.live) ?? props.segments[0]
  selectedKey.value = segment ? keyFor(segment) : ''
}

watch(
  () => props.selectedNode?.id,
  () => selectSegmentForNode(),
  { immediate: true },
)

watch(
  () => [props.segments, props.executionActive, props.activeStepName] as const,
  ([segments, executionActive]) => {
    if (
      executionActive ||
      !segments.some((segment) => keyFor(segment) === selectedKey.value)
    ) {
      selectSegmentForNode()
    }
  },
  { deep: true, immediate: true },
)

watch(
  selectedSegment,
  (segment) => {
    if (segment) void props.ensureContent(segment)
  },
  { immediate: true },
)

watch(
  () => props.executionActive,
  (active) => {
    if (active) expanded.value = true
  },
)

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.flow-log-panel {
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  display: flex;
  flex: 0 1 min(28vh, 220px);
  flex-direction: column;
  min-height: 124px;
  min-width: 0;
}

.flow-log-panel.is-collapsed {
  flex-basis: 34px;
  min-height: 34px;
}

.flow-log-panel header,
.flow-log-title,
.flow-log-actions {
  align-items: center;
  display: flex;
}

.flow-log-panel header {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 84%, transparent);
  gap: 8px;
  justify-content: space-between;
  min-height: 33px;
  padding: 0.3125rem 0.625rem;
  background: color-mix(in srgb, var(--bg-secondary) 62%, var(--bg-primary));
}

.flow-log-title {
  color: var(--text-primary);
  font-size: 0.6875rem;
  gap: 5px;
  min-width: 0;
}

.flow-log-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-log-actions {
  flex: 0 0 auto;
  gap: 2px;
  min-width: 0;
}

.flow-log-actions button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 0.25rem;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 1.5rem;
  justify-content: center;
  padding: 0;
  width: 1.5rem;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.flow-log-actions button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-color) 9%, var(--bg-primary));
  color: var(--accent-color);
}

.flow-log-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.flow-log-panel-body,
.flow-log-viewer {
  min-height: 0;
}

.flow-log-panel-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.flow-log-viewer {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.flow-log-message {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  font-size: 10px;
  justify-content: center;
  padding: 8px;
  text-align: center;
  user-select: text;
}

.flow-log-message.is-error {
  color: var(--danger-color);
}

.flow-log-dialog-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  max-height: min(70vh, 760px);
  min-height: 0;
  overflow: auto;
  padding: 12px;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

<!-- Dialog teleports to body; keep maximize layout rules unscoped. -->
<style>
.flow-log-dialog.p-dialog-maximized {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  width: 100vw;
}

.flow-log-dialog.p-dialog-maximized .p-dialog-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.flow-log-dialog.p-dialog-maximized .flow-log-dialog-content {
  flex: 1 1 auto;
  height: 100%;
  max-height: none;
}
</style>
