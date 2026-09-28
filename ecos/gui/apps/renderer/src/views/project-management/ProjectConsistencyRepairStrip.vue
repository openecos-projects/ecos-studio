<template>
  <div v-if="report" class="consistency-strip" role="status">
    <i class="ri-error-warning-line" aria-hidden="true"></i>
    <span :title="report.projectRoot ?? projectRoot">{{ summary }}</span>
    <button type="button" :disabled="busy" @click="repair">Repair</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  consistencyRepairFailureMessage,
  summarizeConsistencyFindings,
} from '@/utils/projectConsistency'
import { useNotificationStore } from '@/stores/notificationStore'
import { useProjectConsistencyStore } from '@/stores/projectConsistencyStore'

const props = defineProps<{
  projectRoot: string
}>()

const emit = defineEmits<{
  repaired: [projectRoot: string]
}>()

const store = useProjectConsistencyStore()
const notifications = useNotificationStore()
const busy = ref(false)

const report = computed(() => {
  const entry = store.reports[props.projectRoot]
  return entry && entry.findings.length > 0 ? entry : null
})
const summary = computed(() =>
  report.value ? summarizeConsistencyFindings(report.value.findings) : '',
)

async function repair(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const result = await store.repair(props.projectRoot)
    if (result.status === 'failed') {
      notifications.addNotification({
        message: consistencyRepairFailureMessage(result),
        severity: 'error',
        title: 'Project consistency repair incomplete',
      })
    }
    emit('repaired', props.projectRoot)
  } catch (error) {
    notifications.addNotification({
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      title: 'Project consistency repair failed',
    })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.consistency-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 6px 4px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-left: 2px solid var(--error-color, #e45757);
  border-radius: 4px;
  background: var(--bg-secondary);
}

.consistency-strip i {
  flex-shrink: 0;
  color: var(--error-color, #e45757);
  font-size: 12px;
}

.consistency-strip span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.consistency-strip button {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  background: transparent;
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
}

.consistency-strip button:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>
