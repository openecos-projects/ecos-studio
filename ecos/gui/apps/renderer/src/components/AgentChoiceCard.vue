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
        { 'choice-card__options--single': choice.options.length === 1 },
      ]"
    >
      <button
        v-for="option in choice.options"
        :key="option.id"
        type="button"
        class="choice-card__option"
        :disabled="disabled"
        @click="emit('select', option)"
      >
        {{ option.label }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DesktopAgentChoice, DesktopAgentChoiceOption } from '@ecos-studio/shared'

withDefaults(
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

.choice-card__options--buttons.choice-card__options--single {
  grid-template-columns: 1fr;
}

.choice-card__option {
  display: flex;
  min-width: 0;
  min-height: 2.125rem;
  align-items: center;
  justify-content: flex-start;
  padding: 0.5rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--bg-secondary) 45%, var(--bg-primary));
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.choice-card__options--buttons .choice-card__option {
  justify-content: center;
}

.choice-card__options--buttons .choice-card__option:first-child {
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 9%, var(--bg-primary));
  color: var(--text-primary);
  font-weight: 500;
}

.choice-card__option:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 7%, var(--bg-primary));
}

.choice-card__option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
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
  .choice-card__option {
    transition: none;
  }
}
</style>
