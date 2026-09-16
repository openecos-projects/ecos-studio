<template>
  <section
    v-if="operation || finalization"
    class="operation-shell"
    aria-label="Background Operation"
  >
    <div class="operation-panel" :class="{ attention: needsAttention }">
      <div class="operation-identity">
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
          <dt>Workspace</dt>
          <dd :title="operation.workspaceDirectory">{{ workspaceName }}</dd>
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
    </div>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
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
const needsAttention = computed(() => finalization.value?.state === 'snapshot-failed')
const stateText = computed(() => {
  if (operation.value?.cancelRequested) return 'Cancelling'
  if (operation.value) return operation.value.state === 'queued' ? 'Queued' : 'Running'
  return needsAttention.value ? 'Needs attention' : 'Finalizing'
})
const stateIcon = computed(() => {
  if (needsAttention.value) return 'ri-error-warning-line'
  if (finalization.value) return 'ri-save-3-line'
  return operation.value?.state === 'queued' ? 'ri-time-line' : 'ri-loader-4-line'
})

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
.operation-shell {
  min-width: 0;
  flex: 0 0 auto;
  container-type: inline-size;
}

.operation-panel {
  display: grid;
  grid-template-columns: minmax(128px, max-content) minmax(0, 1fr) max-content;
  gap: 8px 16px;
  align-items: center;
  min-width: 0;
  margin: 0 0 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 18%, var(--border-color));
  border-radius: 8px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-color) 6%, var(--bg-primary));
}

.operation-panel.attention {
  border-color: color-mix(in srgb, var(--danger-color, #d85d5d) 32%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color, #d85d5d) 8%, var(--bg-primary));
}

.operation-identity {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.operation-identity strong,
.operation-kind {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-identity strong {
  font-size: 13px;
  font-weight: 720;
  line-height: 1.2;
}

.operation-kind,
.operation-facts dt {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 650;
}

.operation-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent-color);
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.operation-state i {
  font-size: 13px;
}

.operation-panel.attention .operation-state {
  color: var(--danger-color, #d85d5d);
}

.operation-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 12px;
  min-width: 0;
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
  margin-top: 1px;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-issue {
  grid-column: 1 / -1;
  min-width: 0;
  margin: 0;
  color: var(--danger-color, #d85d5d);
  font-size: 11px;
  line-height: 1.35;
}

.operation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  min-width: max-content;
}

.operation-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 11px;
  font-weight: 720;
  white-space: nowrap;
  cursor: pointer;
}

.operation-action:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--accent-color) 44%, transparent);
}

.operation-action.primary {
  color: #fff;
  border-color: color-mix(in srgb, var(--accent-color) 70%, transparent);
  background: var(--accent-color);
}

.operation-action.primary:hover:not(:disabled) {
  color: #fff;
  background: color-mix(in srgb, var(--accent-color) 88%, var(--text-primary));
}

.operation-action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 72%, transparent);
  outline-offset: 1px;
}

.operation-action:disabled {
  cursor: default;
  opacity: 0.45;
}

@container (max-width: 980px) {
  .operation-panel {
    grid-template-columns: minmax(0, 1fr) max-content;
  }

  .operation-facts {
    grid-column: 1 / -1;
  }
}

@container (max-width: 640px) {
  .operation-panel {
    grid-template-columns: minmax(0, 1fr);
  }

  .operation-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .operation-actions {
    min-width: 0;
    justify-content: flex-start;
  }
}

.operation-state .ri-loader-4-line {
  animation: operation-spin 1s linear infinite;
}

@keyframes operation-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .operation-state .ri-loader-4-line {
    animation: none;
  }
}
</style>
