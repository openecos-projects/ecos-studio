<template>
  <section
    v-if="operation || finalization"
    class="operation-panel"
    aria-label="Background Operation"
  >
    <div class="operation-heading">
      <span class="operation-state" role="status">
        <i :class="stateIcon" aria-hidden="true"></i>
        {{ stateText }}
      </span>
      <strong>{{
        operation?.currentStep || operation?.step || 'Workspace finalization'
      }}</strong>
      <span class="operation-kind">{{
        operation?.kind === 'step' ? 'Step run' : 'Full Flow'
      }}</span>
    </div>

    <dl v-if="operation" class="operation-facts">
      <div>
        <dt>Operation</dt>
        <dd :title="operation.operationId">{{ operation.operationId }}</dd>
      </div>
      <div>
        <dt>Workspace</dt>
        <dd :title="operation.workspaceDirectory">{{ workspaceName }}</dd>
      </div>
      <div>
        <dt>Revision</dt>
        <dd>Revision {{ operation.workspaceRevision ?? '-' }}</dd>
      </div>
      <div>
        <dt>Started</dt>
        <dd>{{ formatTime(operation.createdAt) }}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{{ formatTime(operation.updatedAt) }}</dd>
      </div>
    </dl>

    <p v-if="finalization?.issue" class="operation-issue">{{ finalization.issue }}</p>

    <div class="operation-actions">
      <button
        v-if="operation && operation.interruptibility !== 'forbidden'"
        type="button"
        class="operation-action"
        aria-label="Cancel background Flow"
        :disabled="operation.cancelRequested || busy"
        @click="cancelOperation"
      >
        <i class="ri-stop-circle-line" aria-hidden="true"></i>
        {{ operation.cancelRequested ? 'Cancelling' : 'Cancel' }}
      </button>
      <button
        v-if="operation"
        type="button"
        class="operation-action"
        :disabled="logStatus === 'loading'"
        @click="loadLogs"
      >
        <i class="ri-file-text-line" aria-hidden="true"></i>
        {{ logStatus === 'loading' ? 'Loading Logs' : 'View Logs' }}
      </button>
      <button
        v-if="finalization?.state === 'snapshot-failed'"
        type="button"
        class="operation-action"
        :disabled="busy"
        @click="retrySnapshot"
      >
        <i class="ri-refresh-line" aria-hidden="true"></i>
        Retry Snapshot
      </button>
      <button
        type="button"
        class="operation-action primary"
        aria-label="Open Workspace"
        @click="$emit('open-workspace')"
      >
        <i class="ri-arrow-right-up-line" aria-hidden="true"></i>
        Open Workspace
      </button>
    </div>
    <pre v-if="logContent" class="operation-log" aria-label="Runtime log">{{
      logContent
    }}</pre>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { useNotificationStore } from '@/stores/notificationStore'

const props = defineProps<{
  operationIds: string[]
  workspacePath: string
}>()
defineEmits<{ (event: 'open-workspace'): void }>()

const store = useBackgroundOperationStore()
const notifications = useNotificationStore()
const { finalizations, operations } = storeToRefs(store)
const busy = ref(false)
const logContent = ref('')
const logStatus = ref<'idle' | 'loading'>('idle')
let logRequestSequence = 0
const normalizedWorkspacePath = computed(() => normalizePath(props.workspacePath))
const operation = computed(() =>
  operations.value.find(
    (candidate) =>
      props.operationIds.includes(candidate.operationId) &&
      normalizePath(candidate.workspaceDirectory) === normalizedWorkspacePath.value,
  ),
)
const finalization = computed(() =>
  finalizations.value.find(
    (candidate) =>
      normalizePath(candidate.workspaceDirectory) === normalizedWorkspacePath.value,
  ),
)
const workspaceName = computed(
  () =>
    props.workspacePath
      .replace(/[\\/]+$/g, '')
      .split(/[\\/]/)
      .pop() || props.workspacePath,
)
const stateText = computed(() => {
  if (operation.value?.cancelRequested) return 'Cancelling'
  if (operation.value) return operation.value.state === 'queued' ? 'Queued' : 'Running'
  return finalization.value?.state === 'snapshot-failed'
    ? 'Needs attention'
    : 'Finalizing'
})
const stateIcon = computed(() => {
  if (finalization.value?.state === 'snapshot-failed') return 'ri-error-warning-line'
  if (finalization.value) return 'ri-save-3-line'
  return operation.value?.state === 'queued' ? 'ri-time-line' : 'ri-play-circle-line'
})

watch(
  () => [props.workspacePath, props.operationIds.join('\0')],
  () => {
    logRequestSequence += 1
    logContent.value = ''
    logStatus.value = 'idle'
  },
)

async function loadLogs(): Promise<void> {
  const current = operation.value
  const runtime = getDesktopApi().ecc?.runtime
  if (!current || !runtime) return
  const sequence = ++logRequestSequence
  logStatus.value = 'loading'
  try {
    const result = await runtime.operationLog({
      operationId: current.operationId,
      workspaceHandle: current.workspaceHandle,
    })
    if (sequence !== logRequestSequence) return
    logContent.value = `${result.truncated ? '[Earlier output omitted]\n' : ''}${result.content}`
  } catch (error) {
    if (sequence !== logRequestSequence) return
    notifications.addNotification({
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      title: 'Runtime log unavailable',
    })
  } finally {
    if (sequence === logRequestSequence) logStatus.value = 'idle'
  }
}

async function cancelOperation(): Promise<void> {
  const current = operation.value
  if (
    !current ||
    current.cancelRequested ||
    current.interruptibility === 'forbidden' ||
    !confirm(`Cancel the Flow running in ${workspaceName.value}?`)
  )
    return
  await runAction(async () => {
    await store.cancelOperation(current)
  }, 'Flow cancellation failed')
}

async function retrySnapshot(): Promise<void> {
  const current = finalization.value
  if (!current) return
  await runAction(async () => {
    await store.retryFinalSnapshot(current.workspaceHandle)
  }, 'Snapshot retry failed')
}

async function runAction(action: () => Promise<void>, title: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } catch (error) {
    notifications.addNotification({
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      title,
    })
  } finally {
    busy.value = false
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp)
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}
</script>

<style scoped>
.operation-panel {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(360px, 2fr) auto;
  gap: 14px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.operation-log {
  grid-column: 1 / -1;
  max-height: 220px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  background: var(--bg-primary);
  font: 11px/1.5 monospace;
  white-space: pre-wrap;
}

.operation-heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.operation-heading strong,
.operation-kind {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-heading strong {
  font-size: 13px;
}

.operation-kind,
.operation-state,
.operation-facts dt {
  color: var(--text-secondary);
  font-size: 10px;
}

.operation-state {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--accent-color);
}

.operation-facts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.operation-facts div {
  min-width: 0;
}

.operation-facts dt,
.operation-facts dd {
  margin: 0;
}

.operation-facts dd {
  overflow: hidden;
  margin-top: 2px;
  color: var(--text-primary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-issue {
  margin: 0;
  color: var(--error-color, #e45757);
  font-size: 11px;
}

.operation-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.operation-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  background: transparent;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.operation-action.primary {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.operation-action:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (max-width: 1100px) {
  .operation-panel {
    grid-template-columns: minmax(150px, 1fr) auto;
  }
  .operation-facts {
    display: none;
  }
}
</style>
