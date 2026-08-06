<template>
  <section
    v-if="!answeredOptionId"
    class="choice-card"
    :class="{
      'choice-card--embedded': embedded,
      [`choice-card--${choice.variant}`]: true,
    }"
    :aria-label="choice.title"
  >
    <p v-if="choice.variant === 'list'" class="choice-card__title">{{ choice.title }}</p>
    <div
      class="choice-card__options"
      :class="[
        `choice-card__options--${choice.variant}`,
        {
          'choice-card__options--single': choice.options.length === 1,
          'choice-card__options--stack': stackOptions,
        },
      ]"
    >
      <button
        v-for="option in renderedOptions"
        :key="option.id"
        type="button"
        class="choice-card__option"
        :class="{ 'choice-card__option--stacked': Boolean(option.detail) }"
        :disabled="disabled"
        :title="option.detail || option.label"
        @click="emit('select', option.source)"
      >
        <span class="choice-card__option-label">{{ option.label }}</span>
        <span v-if="option.detail" class="choice-card__option-detail">{{
          option.detail
        }}</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DesktopAgentChoice, DesktopAgentChoiceOption } from '@ecos-studio/shared'
import { choiceOptionDetail } from './agentChoiceDisplay'

const props = withDefaults(
  defineProps<{
    answeredOptionId?: string
    choice: DesktopAgentChoice
    disabled?: boolean
    embedded?: boolean
  }>(),
  {
    answeredOptionId: '',
    disabled: false,
    embedded: false,
  },
)
const emit = defineEmits<{
  select: [option: DesktopAgentChoiceOption]
}>()

const renderedOptions = computed(() =>
  props.choice.options.map((option) => ({
    ...option,
    detail: choiceOptionDetail(option),
    source: option,
  })),
)

/** Path-bearing actions need full width; keep short Confirm/Cancel side-by-side. */
const stackOptions = computed(
  () =>
    props.choice.variant === 'buttons' &&
    renderedOptions.value.some((option) => Boolean(option.detail)),
)
</script>

<style scoped>
.choice-card {
  width: 100%;
  max-width: 100%;
}

.choice-card--embedded {
  width: 100%;
}

.choice-card__title {
  margin: 0 0 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
}

.choice-card__options {
  display: grid;
  gap: 0.375rem;
}

.choice-card__options--buttons {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.choice-card__options--buttons.choice-card__options--single,
.choice-card__options--buttons.choice-card__options--stack {
  grid-template-columns: 1fr;
}

.choice-card__option {
  /* Keep the <button> fill transparent. Linux/Electron UA button painting often
   * ignores border-radius and leaves a square slab behind the rounded stroke.
   * Surface + border live on ::before, which does clip to the radius. */
  -webkit-appearance: none;
  appearance: none;
  position: relative;
  isolation: isolate;
  display: flex;
  min-width: 0;
  min-height: 2.125rem;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.125rem;
  padding: 0.5rem 0.75rem;
  overflow: hidden;
  border: 0;
  border-radius: 0.625rem;
  background: transparent;
  background-color: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.choice-card__option::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border: 1px solid var(--border-color);
  border-radius: inherit;
  background-color: var(--bg-secondary);
  pointer-events: none;
  transition:
    border-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.choice-card__options--buttons:not(.choice-card__options--stack)
  .choice-card__option:not(.choice-card__option--stacked) {
  align-items: center;
}

.choice-card__options--buttons .choice-card__option--stacked {
  align-items: stretch;
  padding-top: 0.625rem;
  padding-bottom: 0.625rem;
}

.choice-card__options--stack .choice-card__option:not(.choice-card__option--stacked) {
  min-height: 1.875rem;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
}

.choice-card__option-label {
  min-width: 0;
  width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}

/* Compact Confirm/Cancel rows stay single-line; list options wrap in the narrow rail. */
.choice-card__options--buttons:not(.choice-card__options--stack)
  .choice-card__option:not(.choice-card__option--stacked)
  .choice-card__option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.choice-card__option-detail {
  min-width: 0;
  width: 100%;
  color: var(--text-secondary);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 0.6875rem;
  font-weight: 400;
  line-height: 1.35;
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.choice-card__options--buttons .choice-card__option:first-child,
.choice-card__options--list .choice-card__option:first-child {
  color: var(--text-primary);
  font-weight: 500;
}

.choice-card__options--buttons .choice-card__option:first-child::before,
.choice-card__options--list .choice-card__option:first-child::before {
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  background-color: color-mix(in srgb, var(--accent-color) 9%, var(--bg-primary));
}

.choice-card__options--list {
  max-height: min(22rem, 55vh);
  overflow: auto;
  padding-right: 0.125rem;
}

.choice-card__options--list .choice-card__option {
  min-height: 1.875rem;
  align-items: stretch;
  padding: 0.45rem 0.625rem;
  font-size: 0.75rem;
}

.choice-card__options--list .choice-card__option-label {
  line-height: 1.35;
}

.choice-card__option:hover:not(:disabled)::before {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
  background-color: color-mix(in srgb, var(--accent-color) 7%, var(--bg-primary));
}

.choice-card__option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, var(--border-color));
  outline-offset: 2px;
}

.choice-card__option:disabled {
  cursor: default;
  opacity: 0.55;
}

@media (max-width: 420px) {
  .choice-card__options--buttons {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .choice-card__option::before {
    transition: none;
  }
}
</style>
