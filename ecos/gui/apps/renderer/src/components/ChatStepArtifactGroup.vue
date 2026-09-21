<template>
  <section class="step-group" :aria-label="`${step} results`">
    <button
      type="button"
      class="step-group__head"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <i class="ri-stack-line step-group__icon" aria-hidden="true"></i>
      <span class="step-group__title">{{ step }}</span>
      <span class="step-group__meta">{{ summary }}</span>
      <i
        class="ri-arrow-down-s-line step-group__chevron"
        :class="{ 'is-open': expanded }"
        aria-hidden="true"
      ></i>
    </button>

    <div v-if="expanded" class="step-group__body">
      <MessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
        @img-load="emit('img-load')"
        class="step-group__message w-full max-w-full min-w-0"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Message } from '../types'
import MessageItem from './MessageItem.vue'
import { chatStepArtifactSummary } from './chatStepArtifacts'

const props = defineProps<{
  step: string
  messages: Message[]
}>()

const emit = defineEmits<{
  (event: 'img-load'): void
}>()

const summary = computed(() => chatStepArtifactSummary(props.messages))
const expanded = ref(false)

watch(
  () => props.step,
  () => {
    expanded.value = false
  },
)

function toggleExpanded(): void {
  expanded.value = !expanded.value
}
</script>

<style scoped>
.step-group {
  min-width: 0;
  overflow: visible;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 72%, var(--bg-primary));
}

.step-group__head {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.step-group__head:hover {
  background: color-mix(in srgb, var(--accent-color) 6%, transparent);
}

.step-group__head:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 72%, transparent);
  outline-offset: -2px;
}

.step-group__icon,
.step-group__chevron {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 15px;
}

.step-group__title {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-group__meta {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.step-group__chevron {
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.step-group__chevron.is-open {
  transform: rotate(180deg);
}

.step-group__body {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 0 8px 8px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
}

.step-group__message {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .step-group__chevron {
    transition: none;
  }
}
</style>
