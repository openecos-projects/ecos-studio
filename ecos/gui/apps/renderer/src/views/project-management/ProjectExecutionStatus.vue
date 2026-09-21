<template>
  <span
    v-if="current"
    class="workspace-flow-hint flow-hint-running"
    role="status"
    :title="label"
  >
    <i :class="icon" aria-hidden="true"></i>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BackendProjectActiveOperation } from '@ecos-studio/shared'

const props = defineProps<{ operations: BackendProjectActiveOperation[] }>()

const current = computed(
  () =>
    [...props.operations].sort(
      (left, right) =>
        priority(left) - priority(right) || right.updatedAt - left.updatedAt,
    )[0],
)
const action = computed(() => {
  if (current.value?.cancelRequested) return 'cancelling'
  return current.value?.state ?? ''
})
const label = computed(() => {
  if (!current.value) return ''
  const operation = current.value
  const count = props.operations.length > 1 ? ` +${props.operations.length - 1}` : ''
  return `${operation.step ? `${operation.step} ` : ''}${action.value}${count}`
})
const icon = computed(() =>
  action.value === 'queued' ? 'ri-time-line' : 'ri-loader-4-line execution-spinner',
)

function priority(operation: BackendProjectActiveOperation): number {
  if (operation.cancelRequested) return 0
  return operation.state === 'running' ? 1 : 2
}
</script>

<style scoped>
.workspace-flow-hint {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.execution-spinner {
  animation: execution-spin 1s linear infinite;
}

@keyframes execution-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .execution-spinner {
    animation: none;
  }
}
</style>
