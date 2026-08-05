<template>
  <div class="timeline" role="list" aria-label="Agent activity">
    <div v-if="earlier.length" class="timeline__earlier">
      <button
        type="button"
        class="timeline__earlier-toggle"
        :aria-expanded="earlierOpen"
        @click="earlierOpen = !earlierOpen"
      >
        <i
          class="ri-arrow-right-s-line timeline__chevron"
          :class="{ 'is-open': earlierOpen }"
          aria-hidden="true"
        ></i>
        <span>Earlier activity ({{ earlier.length }})</span>
      </button>
      <div v-if="earlierOpen" class="timeline__earlier-body">
        <div
          v-for="step in earlier"
          :key="step.id"
          class="step"
          role="listitem"
          data-status="done"
        >
          <div class="step__summary">
            <i class="ri-check-line step__icon--done" aria-hidden="true"></i>
            <span class="step__label">{{ step.summary }}</span>
          </div>
          <div v-if="step.detailLines?.length" class="step__detail">
            <p v-for="(line, index) in step.detailLines" :key="index" :title="line">
              {{ line }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div
      v-for="step in recent"
      :key="step.id"
      class="step"
      role="listitem"
      :data-status="step.status"
    >
      <div class="step__summary">
        <i :class="statusIcon(step.status)" aria-hidden="true"></i>
        <span class="step__label">{{ step.summary }}</span>
      </div>
      <div v-if="step.detailLines?.length" class="step__detail">
        <p v-for="(line, index) in step.detailLines" :key="index" :title="line">
          {{ line }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  buildAgentToolSteps,
  splitToolSteps,
  type AgentToolStepStatus,
} from './agentToolSteps'

const props = withDefaults(
  defineProps<{
    content: string
    status?: 'loading' | 'done' | 'error'
  }>(),
  { status: 'done' },
)

const earlierOpen = ref(false)
const steps = computed(() => buildAgentToolSteps(props.content, props.status))
const partitioned = computed(() => splitToolSteps(steps.value))
const earlier = computed(() => partitioned.value.earlier)
const recent = computed(() => partitioned.value.recent)

watch(
  () => props.content,
  () => {
    earlierOpen.value = false
  },
)

function statusIcon(status: AgentToolStepStatus): string {
  if (status === 'running') return 'ri-loader-4-line step__spinner'
  if (status === 'error') return 'ri-close-circle-line step__icon--error'
  return 'ri-check-line step__icon--done'
}
</script>

<style scoped>
.timeline {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 0.125rem;
}

.timeline__earlier {
  min-width: 0;
}

.timeline__earlier-toggle {
  display: inline-flex;
  min-height: 1.5rem;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.125rem 0.125rem 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  cursor: pointer;
}

.timeline__earlier-toggle:hover {
  color: var(--text-primary);
}

.timeline__earlier-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
  border-radius: 4px;
}

.timeline__chevron {
  font-size: 0.875rem;
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.timeline__chevron.is-open {
  transform: rotate(90deg);
}

.timeline__earlier-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.125rem 0 0.25rem 0.125rem;
}

.step {
  min-width: 0;
}

.step__summary {
  display: flex;
  width: 100%;
  min-height: 1.5rem;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.step__summary > i:first-child {
  flex: 0 0 auto;
  font-size: 0.8125rem;
}

.step__icon--done {
  color: var(--success-color);
}

.step__icon--error {
  color: var(--danger-color);
}

.step__spinner {
  color: var(--accent-color);
  animation: tool-spin 900ms linear infinite;
}

.step__label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.step[data-status='running'] .step__label,
.step[data-status='error'] .step__label {
  color: var(--text-primary);
  white-space: normal;
}

.step__detail {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0 0 0.25rem 1.25rem;
}

.step__detail p {
  margin: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--text-secondary) 88%, var(--text-primary));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.625rem;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

@keyframes tool-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .timeline__chevron,
  .step__spinner {
    transition: none;
    animation: none;
  }
}
</style>
