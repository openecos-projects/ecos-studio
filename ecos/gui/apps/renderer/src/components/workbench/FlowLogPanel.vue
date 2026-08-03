<template>
  <section v-if="visible" class="flow-log-panel" aria-label="Flow step log">
    <header>
      <div>
        <i class="ri-terminal-box-line" aria-hidden="true" />
        <strong>Flow Step Log</strong>
      </div>
      <select
        v-if="segments.length > 1"
        v-model="selectedKey"
        aria-label="Select a flow step log"
      >
        <option
          v-for="segment in segments"
          :key="keyFor(segment)"
          :value="keyFor(segment)"
        >
          {{ segment.stepName }} - {{ segment.state }}
        </option>
      </select>
    </header>
    <div v-if="error" class="flow-log-message is-error">{{ error }}</div>
    <div v-else-if="selectedSegment" class="flow-log-viewer">
      <FlowLogCodeViewer
        :content="contentByKey[keyFor(selectedSegment)] ?? ''"
        :live="Boolean(selectedSegment.live)"
        :loading="loading"
        :missing="selectedSegment.missing"
      />
    </div>
    <div v-else class="flow-log-message">Waiting for the first flow step log.</div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowLogCodeViewer from '@/components/FlowLogCodeViewer.vue'
import type { FlowLogSegment } from '@/composables/useHomeData'

const props = defineProps<{
  contentByKey: Record<string, string>
  ensureContent: (segment: FlowLogSegment) => Promise<boolean>
  error: string | null
  executionActive: boolean
  loading: boolean
  segments: FlowLogSegment[]
}>()

const selectedKey = ref('')
const visible = computed(() => props.executionActive || props.segments.length > 0)
const selectedSegment = computed(
  () => props.segments.find((segment) => keyFor(segment) === selectedKey.value) ?? null,
)

function keyFor(segment: FlowLogSegment): string {
  return `${segment.stepName}\u001f${segment.tool}`
}

watch(
  () => props.segments,
  (segments) => {
    if (!segments.some((segment) => keyFor(segment) === selectedKey.value)) {
      selectedKey.value = segments.find((segment) => segment.live)
        ? keyFor(segments.find((segment) => segment.live)!)
        : segments[0]
          ? keyFor(segments[0])
          : ''
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
</script>

<style scoped>
.flow-log-panel {
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex: 0 0 min(28vh, 220px);
  flex-direction: column;
  min-height: 124px;
  min-width: 0;
}

.flow-log-panel header {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-height: 31px;
  padding: 5px 10px;
}

.flow-log-panel header > div {
  align-items: center;
  color: var(--text-primary);
  display: flex;
  font-size: 10px;
  gap: 5px;
  min-width: 0;
}

.flow-log-panel select {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 10px;
  max-width: 55%;
  min-width: 0;
  padding: 3px 5px;
}

.flow-log-viewer {
  min-height: 0;
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
}

.flow-log-message.is-error {
  color: var(--danger-color);
}
</style>
