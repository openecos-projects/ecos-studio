<template>
  <section
    v-if="interaction.status === 'pending'"
    class="interaction-card"
    :aria-label="interaction.title"
  >
    <div v-if="descriptionTable" class="interaction-card__parameter-summary">
      <p v-if="descriptionTable.intro" class="interaction-card__description">
        {{ descriptionTable.intro }}
      </p>
      <dl class="interaction-card__parameter-list">
        <div v-for="row in descriptionTable.rows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <p v-if="descriptionTable.outro" class="interaction-card__hint">
        {{ descriptionTable.outro }}
      </p>
    </div>
    <p v-else-if="interaction.description" class="interaction-card__description">
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
      <div
        v-for="field in formInteraction?.fields ?? []"
        :key="field.id"
        class="interaction-card__field"
      >
        <label :for="`interaction-field-${field.id}`">{{ field.label }}</label>
        <select
          v-if="field.kind === 'select'"
          :id="`interaction-field-${field.id}`"
          v-model="values[field.id]"
        >
          <option v-for="option in field.options" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
        <div v-else-if="isRtlPathField(field)" class="interaction-card__path-control">
          <input
            :id="`interaction-field-${field.id}`"
            v-model="values[field.id]"
            type="text"
            :required="field.required"
          />
          <button
            type="button"
            title="Choose RTL file"
            aria-label="Choose RTL file"
            :disabled="disabled"
            @click="emit('browseRtl', field.id)"
          >
            <i class="ri-folder-open-line" aria-hidden="true"></i>
          </button>
        </div>
        <input
          v-else
          :id="`interaction-field-${field.id}`"
          v-model="values[field.id]"
          :type="field.kind === 'number' ? 'number' : 'text'"
          :min="field.kind === 'number' ? field.min : undefined"
          :max="field.kind === 'number' ? field.max : undefined"
          :step="field.kind === 'number' ? 'any' : undefined"
          :required="field.required"
        />
      </div>
      <div
        class="interaction-card__actions"
        :class="{ 'interaction-card__actions--single': !isParameterForm }"
      >
        <button
          v-if="isParameterForm"
          type="button"
          class="interaction-card__option"
          :disabled="disabled"
          @click="submitWithoutChanges"
        >
          <span>Keep current values</span>
        </button>
        <button
          type="submit"
          class="interaction-card__option"
          :disabled="disabled || (isParameterForm && !formHasInput)"
        >
          <span>{{ isParameterForm ? 'Apply changes' : 'Continue' }}</span>
          <i class="ri-arrow-right-line" aria-hidden="true"></i>
        </button>
      </div>
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
    <div
      v-if="interaction.canUndo && interaction.kind !== 'form'"
      class="interaction-card__session-actions"
    >
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
import type {
  DesktopAgentInteractionField,
  DesktopAgentInteractionRequest,
} from '@ecos-studio/shared'

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
  browseRtl: [fieldId: string]
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
const descriptionTable = computed(() =>
  parseDescriptionTable(props.interaction.description),
)
const isParameterForm = computed(
  () => formInteraction.value !== null && descriptionTable.value !== null,
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
const formHasInput = computed(() =>
  Object.values(values).some((value) => value !== null && String(value).trim() !== ''),
)

function parseDescriptionTable(description?: string): {
  intro: string
  outro: string
  rows: { label: string; value: string }[]
} | null {
  if (!description) return null
  const lines = description.split('\n').map((line) => line.trim())
  const tableStart = lines.findIndex((line) => line.startsWith('|') && line.endsWith('|'))
  if (tableStart < 0 || !/^\|(?:\s*-+\s*\|){2}$/.test(lines[tableStart + 1] ?? ''))
    return null

  const rows: { label: string; value: string }[] = []
  let tableEnd = tableStart + 2
  for (; tableEnd < lines.length; tableEnd += 1) {
    const cells = lines[tableEnd]
      ?.slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
    if (cells?.length !== 2) break
    rows.push({ label: cells[0], value: cells[1] })
  }
  if (!rows.length) return null
  return {
    intro: lines.slice(0, tableStart).join(' '),
    outro: lines.slice(tableEnd).join(' '),
    rows,
  }
}

function submitForm(): void {
  emit('answer', { values: { ...values } })
}

function submitWithoutChanges(): void {
  emit('answer', {
    values: Object.fromEntries(
      (formInteraction.value?.fields ?? []).map((field) => [field.id, '']),
    ),
  })
}

function isRtlPathField(field: DesktopAgentInteractionField): boolean {
  return (
    field.kind === 'path' &&
    field.extensions?.includes('v') === true &&
    field.extensions.includes('sv')
  )
}

function setFieldValue(fieldId: string, value: string): void {
  values[fieldId] = value
}

defineExpose({ setFieldValue })

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
.interaction-card__description {
  max-width: 68ch;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.55;
  letter-spacing: 0;
}
.interaction-card__parameter-summary {
  display: grid;
  gap: 0.625rem;
}
.interaction-card__parameter-list {
  margin: 0;
  border-block: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}
.interaction-card__parameter-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(4rem, max-content);
  gap: 1rem;
  align-items: baseline;
  padding: 0.4375rem 0;
}
.interaction-card__parameter-list > div + div {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 52%, transparent);
}
.interaction-card__parameter-list dt,
.interaction-card__parameter-list dd {
  min-width: 0;
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
}
.interaction-card__parameter-list dt {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
.interaction-card__parameter-list dd {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.interaction-card__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
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
.interaction-card__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
.interaction-card__actions--single {
  grid-template-columns: 1fr;
}
.interaction-card__actions .interaction-card__option {
  justify-content: center;
  gap: 0.375rem;
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
.interaction-card__path-control {
  display: flex;
  gap: 0.5rem;
}
.interaction-card__path-control input {
  flex: 1;
}
.interaction-card__path-control button {
  display: inline-flex;
  width: 2.625rem;
  height: 2.625rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  border-radius: 0.5rem;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
}
.interaction-card__path-control button:hover:not(:disabled),
.interaction-card__path-control button:focus-visible {
  border-color: color-mix(in srgb, var(--accent-color) 50%, var(--border-color));
  color: var(--text-primary);
}
.interaction-card__path-control button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 28%, transparent);
  outline-offset: 1px;
}
.interaction-card__path-control button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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
