<template>
  <div ref="root" class="background-tasks">
    <button
      ref="trigger"
      type="button"
      class="window-btn background-tasks-trigger"
      :class="{ active: open }"
      title="Background tasks"
      :aria-label="taskButtonLabel"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <i class="ri-progress-3-line" aria-hidden="true"></i>
      <span
        v-if="taskCount || attentionCount"
        class="background-tasks-badge"
        aria-hidden="true"
      >
        {{ taskCount ? (taskCount > 99 ? '99+' : taskCount) : '!' }}
      </span>
    </button>
    <Transition name="background-tasks-popover">
      <section
        v-if="open"
        class="background-tasks-popover"
        role="dialog"
        aria-label="Background tasks"
      >
        <header class="background-tasks-header">
          <strong>Background Tasks</strong>
          <span role="status" aria-live="polite">{{ taskCount }} active</span>
        </header>
        <div v-if="taskCount || attentionCount" class="background-tasks-list">
          <article
            v-for="operation in operations"
            :key="`${operation.workspaceId}:${operation.operationId}`"
            class="background-task-row"
          >
            <button
              type="button"
              class="background-task-main"
              :title="operation.workspaceDirectory"
              @click="inspect(operation)"
            >
              <span class="background-task-icon" aria-hidden="true">
                <i class="ri-play-circle-line"></i>
              </span>
              <span class="background-task-copy">
                <strong>{{ workspaceLabel(operation.workspaceDirectory) }}</strong>
                <span>{{
                  operation.currentStep || operation.step || 'Preparing Flow'
                }}</span>
              </span>
              <span class="background-task-meta">
                <span>{{
                  operation.cancelRequested ? 'Cancelling' : stateLabel(operation.state)
                }}</span>
                <time>{{ elapsedLabel(operation.createdAt) }}</time>
              </span>
            </button>
            <button
              v-if="operation.interruptibility !== 'forbidden'"
              type="button"
              class="background-task-cancel"
              title="Cancel Flow"
              aria-label="Cancel Flow"
              :disabled="operation.cancelRequested"
              @click.stop="cancel(operation)"
            >
              <i class="ri-stop-circle-line" aria-hidden="true"></i>
            </button>
          </article>

          <article
            v-for="creation in creationTasks"
            :key="creation.creationId"
            class="background-task-row"
          >
            <div
              class="background-task-main background-task-static"
              :title="creation.targetDirectory"
            >
              <span class="background-task-icon" aria-hidden="true">
                <i
                  :class="
                    creation.status === 'active'
                      ? 'ri-folder-add-line'
                      : 'ri-error-warning-line'
                  "
                ></i>
              </span>
              <span class="background-task-copy">
                <strong>{{ workspaceLabel(creation.targetDirectory) }}</strong>
                <span>{{
                  creation.issue ||
                  (creation.status === 'active'
                    ? 'Creating Workspace'
                    : 'Creation needs recovery')
                }}</span>
              </span>
              <span class="background-task-meta">
                <span>{{
                  creation.status === 'active' ? 'Submitted' : 'Needs attention'
                }}</span>
                <span>{{ creation.stage || 'Invalid journal' }}</span>
              </span>
            </div>
          </article>

          <article
            v-for="finalization in finalizations"
            :key="`finalization:${finalization.workspaceHandle}`"
            class="background-task-row"
          >
            <div
              class="background-task-main background-task-static"
              :title="finalization.workspaceDirectory"
            >
              <span class="background-task-icon" aria-hidden="true">
                <i
                  :class="
                    finalization.state === 'snapshot-failed'
                      ? 'ri-error-warning-line'
                      : 'ri-save-3-line'
                  "
                ></i>
              </span>
              <span class="background-task-copy">
                <strong>{{ workspaceLabel(finalization.workspaceDirectory) }}</strong>
                <span>{{ finalization.issue || 'Saving final Workspace snapshot' }}</span>
              </span>
              <span class="background-task-meta">
                <span>{{
                  finalization.state === 'snapshot-failed'
                    ? 'Needs attention'
                    : 'Finalizing'
                }}</span>
              </span>
            </div>
            <button
              v-if="finalization.state === 'snapshot-failed'"
              type="button"
              class="background-task-retry"
              title="Retry Snapshot"
              :disabled="retryingHandle === finalization.workspaceHandle"
              @click.stop="retrySnapshot(finalization.workspaceHandle)"
            >
              Retry
            </button>
          </article>
        </div>

        <div v-else class="background-tasks-empty">No background tasks</div>
        <button type="button" class="background-tasks-view" @click="viewTasks">
          <i class="ri-folder-chart-line" aria-hidden="true"></i>
          View in Project Management
        </button>
      </section>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type {
  EccBackgroundOperation,
  EccBackgroundWorkspaceCreation,
  EccRuntimeOperationState,
} from '@ecos-studio/shared'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useWorkspaceCreation } from '@/utils/workspaceNavigation'

const route = useRoute()
const router = useRouter()
const store = useBackgroundOperationStore()
const notifications = useNotificationStore()
const { creations, finalizations, operations } = storeToRefs(store)
const workspaceCreation = useWorkspaceCreation()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
const retryingHandle = ref('')
const topbarOverlayEvent = 'ecos-topbar-overlay-open'

type PresentedCreation = EccBackgroundWorkspaceCreation & {
  local?: boolean
  targetDirectory: string
}
const creationTasks = computed<PresentedCreation[]>(() => {
  const projected = creations.value.filter(
    (
      creation,
    ): creation is EccBackgroundWorkspaceCreation & { targetDirectory: string } =>
      creation.status !== 'recovered' && Boolean(creation.targetDirectory),
  )
  const local = workspaceCreation.value
  if (
    !local ||
    projected.some(
      (creation) =>
        normalizePath(creation.targetDirectory) === normalizePath(local.targetPath),
    )
  )
    return projected
  return [
    ...projected,
    {
      creationId: `local:${local.token}`,
      local: true,
      stage: 'intent-recorded',
      status: 'active',
      targetDirectory: local.targetPath,
      updatedAt: Date.now(),
    },
  ]
})
const taskCount = computed(
  () =>
    operations.value.length +
    creationTasks.value.filter((creation) => creation.status === 'active').length,
)
const attentionCount = computed(
  () =>
    finalizations.value.length +
    creationTasks.value.filter((creation) => creation.status !== 'active').length,
)
const taskButtonLabel = computed(() => {
  const attention = attentionCount.value ? `, ${attentionCount.value} need attention` : ''
  return `Background tasks, ${taskCount.value} active${attention}`
})
watch(open, (isOpen) => {
  if (clock) clearInterval(clock)
  clock = isOpen ? setInterval(() => (now.value = Date.now()), 1000) : null
})

function toggle(): void {
  if (open.value) {
    open.value = false
    return
  }
  openTasks()
}

function openTasks(): void {
  document.dispatchEvent(
    new CustomEvent(topbarOverlayEvent, { detail: 'background-tasks' }),
  )
  open.value = true
}

function handleOverlay(event: Event): void {
  open.value = (event as CustomEvent<string>).detail === 'background-tasks'
}

function projectManagementPath(): string {
  return route.path.startsWith('/workspace') ? '/workspace/projects' : '/projects'
}

function inspect(operation: EccBackgroundOperation): void {
  open.value = false
  void router.push({
    path: projectManagementPath(),
    query: {
      operationId: operation.operationId,
      workspacePath: operation.workspaceDirectory,
    },
  })
}

function viewTasks(): void {
  open.value = false
  void router.push({ path: projectManagementPath() })
}

async function cancel(operation: EccBackgroundOperation): Promise<void> {
  if (
    operation.cancelRequested ||
    operation.interruptibility === 'forbidden' ||
    !confirm(
      `Cancel the Flow running in ${workspaceLabel(operation.workspaceDirectory)}?\n\nThe Runtime will stop at the next supported cancellation boundary.`,
    )
  ) {
    return
  }
  try {
    await store.cancelOperation(operation)
  } catch (error) {
    notifications.addNotification({
      key: `background-cancel:${operation.operationId}`,
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      title: 'Flow cancellation failed',
    })
  }
}

async function retrySnapshot(workspaceHandle: string): Promise<void> {
  if (retryingHandle.value) return
  retryingHandle.value = workspaceHandle
  try {
    await store.retryFinalSnapshot(workspaceHandle)
  } catch (error) {
    notifications.addNotification({
      key: `snapshot-retry:${workspaceHandle}`,
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      title: 'Snapshot retry failed',
    })
  } finally {
    retryingHandle.value = ''
  }
}

function workspaceLabel(path: string): string {
  return (
    path
      .replace(/[\\/]+$/g, '')
      .split(/[\\/]/)
      .pop() || path
  )
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function stateLabel(state: EccRuntimeOperationState): string {
  return state === 'queued' ? 'Queued' : 'Running'
}

function elapsedLabel(timestamp: number): string {
  const startedAt = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const seconds = Math.max(0, Math.floor((now.value - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function closeFromDocument(event: MouseEvent): void {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false
}

function closeFromKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  open.value = false
  trigger.value?.focus()
}

onMounted(() => {
  document.addEventListener('click', closeFromDocument)
  document.addEventListener('keydown', closeFromKeyboard)
  document.addEventListener(topbarOverlayEvent, handleOverlay)
})

onUnmounted(() => {
  if (clock) clearInterval(clock)
  document.removeEventListener('click', closeFromDocument)
  document.removeEventListener('keydown', closeFromKeyboard)
  document.removeEventListener(topbarOverlayEvent, handleOverlay)
})
</script>

<style scoped src="./backgroundTasksButton.css"></style>
