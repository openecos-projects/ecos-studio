<template>
  <div v-if="visible" ref="root" class="shutdown-status">
    <button
      ref="trigger"
      type="button"
      class="shutdown-status-trigger"
      :class="{ active: open }"
      :aria-expanded="open"
      :aria-label="`Close status: ${triggerLabel}`"
      title="View close status"
      @click.stop="toggle"
    >
      <i class="ri-shut-down-line" aria-hidden="true"></i>
      <span>{{ triggerLabel }}</span>
    </button>

    <Transition name="shutdown-status-popover">
      <section
        v-if="open"
        class="shutdown-status-popover"
        role="dialog"
        aria-label="Close status"
      >
        <header class="shutdown-status-header">
          <strong>Closing ECOS Studio</strong>
          <span role="status" aria-live="polite">{{ blockerLabel }}</span>
        </header>
        <p v-if="shutdownStatus.issue" class="shutdown-status-issue">
          {{ shutdownStatus.issue }}
        </p>
        <button type="button" class="shutdown-view-tasks" @click="openBackgroundTasks">
          <i class="ri-progress-3-line" aria-hidden="true"></i>
          <span>View Background Tasks</span>
        </button>
        <div v-if="shutdownStatus.state !== 'forcing'" class="shutdown-status-actions">
          <button type="button" class="shutdown-keep-open" @click="keepAppOpen">
            Keep App Open
          </button>
          <button type="button" class="shutdown-force" @click="reviewShutdownOptions">
            Force Quit...
          </button>
        </div>
      </section>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  isShutdownInProgress,
  useBackgroundOperationStore,
} from '@/stores/backgroundOperationStore'

const store = useBackgroundOperationStore()
const { shutdownStatus } = storeToRefs(store)
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const topbarOverlayEvent = 'ecos-topbar-overlay-open'

const visible = computed(() => isShutdownInProgress(shutdownStatus.value.state))
const blockerCount = computed(
  () =>
    shutdownStatus.value.activeFlows +
    shutdownStatus.value.finalizations +
    shutdownStatus.value.pendingCreations +
    (shutdownStatus.value.pendingCommands ?? 0) +
    shutdownStatus.value.snapshotFailures,
)
const triggerLabel = computed(() => {
  if (shutdownStatus.value.state === 'forcing') return 'Force quitting'
  if (shutdownStatus.value.state === 'error') return 'Close needs attention'
  if (!blockerCount.value) return 'Closing ECOS Studio'
  return `Closing after ${blockerCount.value} ${blockerCount.value === 1 ? 'task' : 'tasks'}`
})
const blockerLabel = computed(() => {
  const status = shutdownStatus.value
  const parts = [
    countLabel(status.activeFlows, 'Flow'),
    countLabel(status.finalizations, 'snapshot'),
    countLabel(status.pendingCreations, 'creation'),
    countLabel(status.pendingCommands ?? 0, 'command'),
    countLabel(status.snapshotFailures, 'snapshot issue'),
  ].filter(Boolean)
  return parts.join(' · ') || 'Finishing cleanup'
})

function countLabel(count: number, label: string): string {
  return count ? `${count} ${label}${count === 1 ? '' : 's'}` : ''
}

function toggle(): void {
  if (open.value) {
    open.value = false
    return
  }
  document.dispatchEvent(
    new CustomEvent(topbarOverlayEvent, { detail: 'shutdown-status' }),
  )
  open.value = true
}

function openBackgroundTasks(): void {
  document.dispatchEvent(
    new CustomEvent(topbarOverlayEvent, { detail: 'background-tasks' }),
  )
}

async function keepAppOpen(): Promise<void> {
  await store.cancelShutdown()
  open.value = false
}

async function reviewShutdownOptions(): Promise<void> {
  await store.reviewShutdownOptions()
}

function handleOverlay(event: Event): void {
  if ((event as CustomEvent<string>).detail !== 'shutdown-status') open.value = false
}

function closeFromDocument(event: MouseEvent): void {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false
}

function closeFromKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  open.value = false
  trigger.value?.focus()
}

watch(visible, (isVisible) => {
  if (!isVisible) open.value = false
})

onMounted(() => {
  document.addEventListener('click', closeFromDocument)
  document.addEventListener('keydown', closeFromKeyboard)
  document.addEventListener(topbarOverlayEvent, handleOverlay)
})

onUnmounted(() => {
  document.removeEventListener('click', closeFromDocument)
  document.removeEventListener('keydown', closeFromKeyboard)
  document.removeEventListener(topbarOverlayEvent, handleOverlay)
})
</script>

<style scoped>
.shutdown-status {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
}

.shutdown-status-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  margin-right: 4px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}

.shutdown-status-trigger:hover,
.shutdown-status-trigger:focus-visible,
.shutdown-status-trigger.active {
  border-color: var(--accent-color);
  color: var(--text-primary);
  outline: none;
}

.shutdown-status-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 1100;
  width: min(340px, calc(100vw - 16px));
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.shutdown-status-header {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 7px 10px;
}

.shutdown-status-header strong {
  color: var(--text-primary);
  font-size: 13px;
}

.shutdown-status-header span,
.shutdown-status-issue {
  color: var(--text-secondary);
  font-size: 10px;
}

.shutdown-status-issue {
  margin: 0;
  padding: 8px 7px;
  border-top: 1px solid var(--border-color);
  color: var(--danger-color);
}

.shutdown-view-tasks {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 7px;
  padding: 8px 7px;
  border: 0;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.shutdown-status-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding-top: 8px;
}

.shutdown-status-actions button {
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}

.shutdown-status-actions .shutdown-force {
  border-color: var(--danger-color);
  color: var(--danger-color);
}

.shutdown-view-tasks:hover,
.shutdown-view-tasks:focus-visible,
.shutdown-status-actions button:hover,
.shutdown-status-actions button:focus-visible {
  background: var(--bg-tertiary);
  outline: none;
}

.shutdown-status-popover-enter-active,
.shutdown-status-popover-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.shutdown-status-popover-enter-from,
.shutdown-status-popover-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .shutdown-status-popover-enter-active,
  .shutdown-status-popover-leave-active {
    transition: none;
  }
}
</style>
