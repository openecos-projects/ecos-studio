<template>
  <div class="timeline" role="list" aria-label="Flow progress">
    <div
      v-for="step in steps"
      :key="step.id"
      class="step"
      role="listitem"
      :data-status="step.status"
    >
      <button
        v-if="step.detailLines?.length && step.status !== 'running'"
        type="button"
        class="step__head"
        :aria-expanded="isExpanded(step.id)"
        @click="toggleExpanded(step.id)"
      >
        <i :class="statusIcon(step.status)" aria-hidden="true"></i>
        <span class="step__label">{{ step.summary }}</span>
        <i
          class="ri-arrow-down-s-line step__expand"
          :class="{ 'is-open': isExpanded(step.id) }"
          aria-hidden="true"
        ></i>
      </button>
      <div v-else class="step__head step__head--static">
        <i :class="statusIcon(step.status)" aria-hidden="true"></i>
        <span class="step__label">{{ step.summary }}</span>
      </div>

      <div
        v-if="step.detailLines?.length && (step.status === 'running' || isExpanded(step.id))"
        class="step__detail"
      >
        <p
          v-for="(line, index) in step.detailLines"
          :key="index"
          class="step__detail-line"
          :class="{
            'is-current':
              step.status === 'running' && index === step.detailLines.length - 1,
          }"
          :title="line"
        >
          <span class="step__bullet" aria-hidden="true">·</span>
          <span>{{ line }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  buildAgentToolSteps,
  type AgentToolStepStatus,
} from './agentToolSteps'

const props = withDefaults(
  defineProps<{
    content: string
    status?: 'loading' | 'done' | 'error'
  }>(),
  { status: 'done' },
)

const expandedIds = ref<Set<string>>(new Set())
const steps = computed(() => buildAgentToolSteps(props.content, props.status))

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function statusIcon(status: AgentToolStepStatus): string {
  if (status === 'running') return 'ri-loader-4-line step__spinner'
  if (status === 'error') return 'ri-close-circle-line step__icon--error'
  return 'ri-checkbox-circle-fill step__icon--done'
}
</script>

<style scoped>
.timeline {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 0.25rem;
}

.step {
  min-width: 0;
}

.step__head {
  display: flex;
  width: 100%;
  min-height: 1.45rem;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.05rem 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.step__head--static {
  cursor: default;
}

.step__head:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
  border-radius: 4px;
}

.step__head > i:first-child {
  flex: 0 0 auto;
  width: 0.95rem;
  font-size: 0.9rem;
}

.step__icon--done {
  color: color-mix(in srgb, var(--success-color) 88%, var(--text-secondary));
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
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.step[data-status='running'] .step__label,
.step[data-status='error'] .step__label {
  color: var(--text-primary);
}

.step__expand {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--text-secondary) 60%, transparent);
  font-size: 0.95rem;
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.step__expand.is-open {
  transform: rotate(180deg);
}

.step__detail {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  margin: 0.05rem 0 0.1rem;
  padding: 0.05rem 0 0.1rem 1.35rem;
}

.step__detail-line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0;
  color: color-mix(in srgb, var(--text-secondary) 78%, transparent);
  font-size: 0.6875rem;
  line-height: 1.45;
  user-select: text;
}

.step__detail-line.is-current {
  color: var(--text-primary);
}

.step__bullet {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--text-secondary) 50%, transparent);
}

.step__detail-line > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes tool-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .step__expand,
  .step__spinner {
    transition: none;
    animation: none;
  }
}
</style>
