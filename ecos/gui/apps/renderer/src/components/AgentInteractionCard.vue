<template>
  <section
    v-if="interaction.status === 'pending'"
    class="interaction-card"
    :aria-label="interaction.title"
  >
    <p class="interaction-card__title">{{ interaction.title }}</p>
    <p v-if="interaction.description" class="interaction-card__description">
      {{ interaction.description }}
    </p>
    <div v-if="choiceInteraction" class="interaction-card__options">
      <button
        v-for="(option, index) in choiceInteraction.options"
        :key="option.id"
        type="button"
        class="interaction-card__option"
        :disabled="disabled"
        @click="emit('answer', { optionId: option.id })"
      >
        <span class="interaction-card__index">{{ index + 1 }}</span>
        <span>{{ option.label }}</span>
      </button>
    </div>
    <div v-else-if="confirmInteraction" class="interaction-card__options">
      <button
        type="button"
        class="interaction-card__option"
        :disabled="disabled"
        @click="emit('answer', { optionId: confirmInteraction.confirm.id })"
      >
        <span class="interaction-card__index">1</span>
        <span>{{ confirmInteraction.confirm.label }}</span>
      </button>
      <button
        type="button"
        class="interaction-card__option"
        :disabled="disabled"
        @click="emit('answer', { optionId: confirmInteraction.cancel.id })"
      >
        <span class="interaction-card__index">2</span>
        <span>{{ confirmInteraction.cancel.label }}</span>
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
    <button
      v-if="choiceInteraction && !editingOther"
      type="button"
      class="interaction-card__option interaction-card__other"
      :disabled="disabled"
      @click="startOtherAnswer"
    >
      <span class="interaction-card__index">{{ customAnswerIndex }}</span>
      <span>Other…</span>
    </button>
    <form
      v-else-if="choiceInteraction"
      class="interaction-card__custom-answer"
      @submit.prevent="submitText"
    >
      <span class="interaction-card__index">{{ customAnswerIndex }}</span>
      <input
        ref="otherInputRef"
        v-model="textAnswer"
        type="text"
        placeholder="Type another answer…"
        aria-label="Other answer"
        :disabled="disabled"
        @keydown.esc="cancelOtherAnswer"
      />
      <button
        type="submit"
        title="Send answer"
        aria-label="Send answer"
        :disabled="disabled || !textAnswer.trim()"
      >
        <i class="ri-arrow-up-line" aria-hidden="true"></i>
      </button>
    </form>
    <div v-if="interaction.canUndo" class="interaction-card__session-actions">
      <button
        type="button"
        class="interaction-card__session-action"
        aria-label="Undo last selection"
        :disabled="disabled"
        @click="emit('undo')"
      >
        <i class="ri-arrow-go-back-line" aria-hidden="true"></i>
        <span>Undo selection</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import type { DesktopAgentInteractionRequest } from '@ecos-studio/shared'

type InteractionAnswer =
  | { optionId: string }
  | { text: string }
  | { values: Record<string, string | number | null> }

const props = withDefaults(
  defineProps<{ disabled?: boolean; interaction: DesktopAgentInteractionRequest }>(),
  { disabled: false },
)
const emit = defineEmits<{
  answer: [answer: InteractionAnswer]
  undo: []
}>()

const choiceInteraction = computed(() =>
  props.interaction.interaction.kind === 'choice' ? props.interaction.interaction : null,
)
const confirmInteraction = computed(() =>
  props.interaction.interaction.kind === 'confirm' ? props.interaction.interaction : null,
)
const formInteraction = computed(() =>
  props.interaction.interaction.kind === 'form' ? props.interaction.interaction : null,
)
const customAnswerIndex = computed(
  () => (choiceInteraction.value?.options.length ?? 0) + 1,
)
const editingOther = ref(false)
const textAnswer = ref('')
const otherInputRef = ref<HTMLInputElement | null>(null)

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

function startOtherAnswer(): void {
  editingOther.value = true
  void nextTick(() => otherInputRef.value?.focus())
}

function cancelOtherAnswer(): void {
  editingOther.value = false
  textAnswer.value = ''
}

function submitText(): void {
  const text = textAnswer.value.trim()
  if (text) emit('answer', { text })
}
</script>

<style scoped>
.interaction-card {
  width: 100%;
  max-width: 100%;
}
.interaction-card__title {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 650;
  line-height: 1.4;
  letter-spacing: 0;
}
.interaction-card__description {
  max-width: 68ch;
  margin: 0.375rem 0 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.55;
  letter-spacing: 0;
}
.interaction-card__options,
.interaction-card__form {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.interaction-card__option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  min-height: 2.75rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--bg-primary) 92%, var(--bg-secondary));
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 520;
  line-height: 1.4;
  letter-spacing: 0;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
.interaction-card__option:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 5%, var(--bg-primary));
  box-shadow: 0 1px 3px color-mix(in srgb, var(--text-primary) 8%, transparent);
  transform: translateY(-1px);
}
.interaction-card__option:focus-visible {
  border-color: color-mix(in srgb, var(--accent-color) 60%, var(--border-color));
  outline: 2px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
  outline-offset: 2px;
}
.interaction-card__option:active:not(:disabled) {
  box-shadow: none;
  transform: translateY(0);
}
.interaction-card__option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.interaction-card__index {
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 0.25rem;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.interaction-card__other {
  margin-top: 0.5rem;
  border-style: dashed;
  color: var(--text-secondary);
}
.interaction-card__form > .interaction-card__option {
  justify-content: center;
  border-color: var(--border-color);
  background: var(--bg-secondary);
}
.interaction-card__custom-answer {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.625rem;
  margin-top: 0.75rem;
  padding: 0.25rem 0.375rem 0.25rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--accent-color) 60%, var(--border-color));
  border-radius: 0.5rem;
  background: var(--bg-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 10%, transparent);
}
.interaction-card__custom-answer input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
}
.interaction-card__custom-answer input::placeholder {
  color: var(--text-secondary);
}
.interaction-card__custom-answer button {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.375rem;
  background: var(--accent-color);
  color: var(--accent-text);
  cursor: pointer;
}
.interaction-card__custom-answer button:disabled {
  cursor: default;
  opacity: 0.35;
}
.interaction-card__field {
  display: grid;
  gap: 0.375rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 520;
}
.interaction-card__field input,
.interaction-card__field select {
  min-width: 0;
  min-height: 2.625rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
}
.interaction-card__field input:focus-visible,
.interaction-card__field select:focus-visible {
  border-color: color-mix(in srgb, var(--accent-color) 60%, var(--border-color));
  outline: 2px solid color-mix(in srgb, var(--accent-color) 28%, transparent);
  outline-offset: 1px;
}
.interaction-card__session-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.25rem;
  margin-top: 0.75rem;
  padding-top: 0.625rem;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
}
.interaction-card__session-action {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 520;
  letter-spacing: 0;
  cursor: pointer;
}
.interaction-card__session-action:hover:not(:disabled),
.interaction-card__session-action:focus-visible {
  border-color: color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  color: var(--text-primary);
}
.interaction-card__session-action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
  outline-offset: 1px;
}
.interaction-card__session-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .interaction-card__option {
    transition: none;
  }

  .interaction-card__option:hover:not(:disabled) {
    transform: none;
  }
}
</style>
