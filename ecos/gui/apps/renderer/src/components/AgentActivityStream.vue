<template>
  <section
    v-if="status === 'loading' || activity.items.length || activity.notice"
    class="activity-stream"
    :data-state="streamState"
    aria-label="Agent activity"
  >
    <button
      type="button"
      class="activity-stream__toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <i
        v-if="hasFailure"
        class="ri-error-warning-line activity-stream__error-icon"
        aria-hidden="true"
      ></i>
      <i
        v-else-if="status === 'loading'"
        class="ri-loader-4-line activity-stream__spinner"
        aria-hidden="true"
      ></i>
      <i v-else class="ri-sparkling-2-line" aria-hidden="true"></i>
      <span>{{ headerLabel }}</span>
      <i
        class="ri-arrow-down-s-line activity-stream__chevron"
        :class="{ 'is-open': expanded }"
        aria-hidden="true"
      ></i>
    </button>

    <div v-show="expanded" class="activity-stream__items" role="list">
      <AgentActivityItem v-for="item in activity.items" :key="item.itemId" :item="item" />
      <p v-if="activity.notice" class="activity-stream__notice">
        <i class="ri-information-line" aria-hidden="true"></i>
        <span>{{ activity.notice }}</span>
      </p>
    </div>

    <p class="activity-stream__sr-status" role="status" aria-live="polite">
      {{ liveStatus }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DesktopAgentActivity } from '@ecos-studio/shared'
import AgentActivityItem from './AgentActivityItem.vue'
import {
  agentActivityKindLabel,
  formatActivityDuration,
} from './agentActivityPresentation'

const props = defineProps<{
  activity: {
    completedAt?: number
    items: DesktopAgentActivity[]
    notice?: string
    startedAt: number
    turnId: string
  }
  status?: 'loading' | 'done' | 'error'
}>()

const expanded = ref(props.status !== 'done')
const now = ref(Date.now())
let elapsedTimer: ReturnType<typeof setInterval> | undefined
const hasFailure = computed(
  () =>
    props.status === 'error' ||
    props.activity.items.some((item) => item.status === 'failed'),
)
const hasNotice = computed(() => Boolean(props.activity.notice))
const streamState = computed(() => {
  if (hasFailure.value) return 'failed'
  if (hasNotice.value) return 'unavailable'
  if (props.status === 'loading') return 'running'
  if (props.activity.items.some((item) => item.status === 'interrupted')) {
    return 'interrupted'
  }
  return 'completed'
})
const latestItem = computed(() => props.activity.items[props.activity.items.length - 1])
const elapsedMs = computed(() =>
  Math.max(0, (props.activity.completedAt ?? now.value) - props.activity.startedAt),
)
const elapsedLabel = computed(() =>
  formatActivityDuration(Math.max(1000, elapsedMs.value)),
)
const headerLabel = computed(() => {
  if (hasFailure.value) return 'Activity failed'
  if (hasNotice.value) return 'Activity details unavailable'
  if (props.activity.items.some((item) => item.status === 'interrupted')) {
    return `Activity interrupted after ${elapsedLabel.value}`
  }
  if (props.activity.items.some((item) => item.status === 'declined')) {
    return 'Activity declined'
  }
  if (props.status === 'done') {
    return `Worked for ${elapsedLabel.value}`
  }
  return `Working for ${elapsedLabel.value}`
})
const liveStatus = computed(() => {
  const item = latestItem.value
  if (!item) return props.activity.notice ?? ''
  return `${agentActivityKindLabel(item)}: ${item.status}`
})

function syncElapsedTimer(status = props.status): void {
  if (status === 'loading' && elapsedTimer === undefined) {
    now.value = Date.now()
    elapsedTimer = setInterval(() => (now.value = Date.now()), 1000)
    return
  }
  if (status !== 'loading' && elapsedTimer !== undefined) {
    clearInterval(elapsedTimer)
    elapsedTimer = undefined
  }
}

onMounted(syncElapsedTimer)
onUnmounted(() => {
  if (elapsedTimer !== undefined) clearInterval(elapsedTimer)
})
watch(
  () => props.status,
  (status) => {
    syncElapsedTimer(status)
    if (status === 'done' && !hasFailure.value && !hasNotice.value) {
      expanded.value = false
    }
  },
)
watch(hasFailure, (failed) => {
  if (failed) expanded.value = true
})
watch(hasNotice, (unavailable) => {
  if (unavailable) expanded.value = true
})
</script>

<style scoped>
.activity-stream {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  color: var(--text-secondary);
}

.activity-stream__toggle {
  display: inline-flex;
  min-height: 1.75rem;
  max-width: 100%;
  align-items: center;
  gap: 0.42rem;
  padding: 0.2rem 0.125rem;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 550;
  letter-spacing: 0;
  text-align: left;
  cursor: pointer;
}

.activity-stream__toggle > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-stream__toggle:hover {
  color: var(--text-primary);
}

.activity-stream__toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 55%, transparent);
  outline-offset: 2px;
}

.activity-stream__spinner {
  color: var(--accent-color);
  animation: activity-spin 900ms linear infinite;
}

.activity-stream__error-icon {
  color: var(--danger-color);
}

.activity-stream__chevron {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--text-secondary) 65%, transparent);
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.activity-stream__chevron.is-open {
  transform: rotate(180deg);
}

.activity-stream__items {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.15rem 0 0.3rem;
}

.activity-stream__notice {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  padding: 0.22rem 0.125rem;
  color: color-mix(in srgb, var(--text-secondary) 78%, transparent);
  font-size: 0.6875rem;
}

.activity-stream__sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes activity-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .activity-stream__spinner {
    animation: none;
  }

  .activity-stream__chevron {
    transition: none;
  }
}
</style>
