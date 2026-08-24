<template>
  <section
    v-if="interaction.status === 'pending'"
    class="interaction-card"
    :aria-label="interaction.title"
  >
    <p class="interaction-card__title">{{ interaction.title }}</p>
    <div v-if="choiceInteraction" class="interaction-card__options">
      <button
        v-for="option in choiceInteraction.options"
        :key="option.id"
        type="button"
        class="interaction-card__option"
        :disabled="disabled"
        @click="emit('answer', { optionId: option.id })"
      >
        {{ option.label }}
      </button>
    </div>
    <div
      v-else-if="confirmInteraction"
      class="interaction-card__options interaction-card__options--confirm"
    >
      <button
        type="button"
        class="interaction-card__option"
        :disabled="disabled"
        @click="emit('answer', { optionId: confirmInteraction.confirm.id })"
      >
        {{ confirmInteraction.confirm.label }}
      </button>
      <button
        type="button"
        class="interaction-card__option"
        :disabled="disabled"
        @click="emit('answer', { optionId: confirmInteraction.cancel.id })"
      >
        {{ confirmInteraction.cancel.label }}
      </button>
    </div>
    <form v-else class="interaction-card__form" @submit.prevent="submitForm">
      <label
        v-for="field in formInteraction?.fields ?? []"
        :key="field.id"
        class="interaction-card__field"
      >
        <span>{{ field.label }}</span>
        <select v-if="field.kind === 'select'" v-model="values[field.id]">
          <option v-for="option in field.options" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
        <input
          v-else
          v-model="values[field.id]"
          :type="field.kind === 'number' ? 'number' : 'text'"
          :min="field.kind === 'number' ? field.min : undefined"
          :max="field.kind === 'number' ? field.max : undefined"
          :step="field.kind === 'number' ? 'any' : undefined"
          :required="field.required"
        />
      </label>
      <button type="submit" class="interaction-card__option" :disabled="disabled">
        Submit
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { DesktopAgentInteractionRequest } from '@ecos-studio/shared'

type InteractionAnswer =
  | { optionId: string }
  | { values: Record<string, string | number | null> }

const props = withDefaults(
  defineProps<{ disabled?: boolean; interaction: DesktopAgentInteractionRequest }>(),
  { disabled: false },
)
const emit = defineEmits<{ answer: [answer: InteractionAnswer] }>()

const choiceInteraction = computed(() =>
  props.interaction.interaction.kind === 'choice' ? props.interaction.interaction : null,
)
const confirmInteraction = computed(() =>
  props.interaction.interaction.kind === 'confirm' ? props.interaction.interaction : null,
)
const formInteraction = computed(() =>
  props.interaction.interaction.kind === 'form' ? props.interaction.interaction : null,
)

const values = reactive<Record<string, string | number | null>>(
  Object.fromEntries(
    formInteraction.value
      ? formInteraction.value.fields.map((field) => [field.id, field.defaultValue ?? ''])
      : [],
  ),
)

function submitForm(): void {
  emit('answer', { values: { ...values } })
}
</script>

<style scoped>
.interaction-card {
  width: 100%;
  max-width: 100%;
}
.interaction-card__title {
  margin: 0 0 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.interaction-card__options,
.interaction-card__form {
  display: grid;
  gap: 0.5rem;
}
.interaction-card__options--confirm {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.interaction-card__option {
  min-height: 2.125rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.interaction-card__option:disabled {
  cursor: default;
  opacity: 0.55;
}
.interaction-card__field {
  display: grid;
  gap: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.interaction-card__field input,
.interaction-card__field select {
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
}
</style>
