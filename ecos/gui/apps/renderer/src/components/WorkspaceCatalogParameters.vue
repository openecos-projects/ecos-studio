<template>
  <div v-for="parameter in parameters" :key="parameter.definition.id">
    <label class="mb-2 block text-sm font-semibold text-(--text-primary)">
      {{ parameter.definition.id }}
    </label>
    <select
      v-if="Array.isArray(parameter.definition.choices)"
      :value="String(values[parameter.definition.id] ?? '')"
      :disabled="parameter.state === 'inapplicable'"
      class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color) disabled:cursor-not-allowed disabled:opacity-50"
      @change="updateChoice(parameter, $event)"
    >
      <option
        v-for="choice in parameter.definition.choices"
        :key="String(choice)"
        :value="String(choice)"
      >
        {{ choice }}
      </option>
    </select>
    <label
      v-else-if="parameter.definition.type === 'bool'"
      class="flex h-[42px] items-center gap-2"
    >
      <input
        :checked="Boolean(values[parameter.definition.id])"
        type="checkbox"
        :disabled="parameter.state === 'inapplicable'"
        @change="updateBoolean(parameter.definition.id, $event)"
      />
      <span class="text-sm text-(--text-secondary)">{{ parameter.state }}</span>
    </label>
    <input
      v-else
      :value="displayValue(parameter.definition.id)"
      :type="parameterInputType(parameter.definition.type)"
      :disabled="parameter.state === 'inapplicable'"
      class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color) disabled:cursor-not-allowed disabled:opacity-50"
      @change="updateInput(parameter, $event)"
    />
    <p
      v-if="parameter.state === 'inapplicable'"
      class="mt-1 text-xs text-(--text-secondary)"
    >
      {{ parameter.inapplicableReason }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { WorkspaceCreationParameter } from '@ecos-studio/shared'

const props = defineProps<{
  parameters: WorkspaceCreationParameter[]
  values: Record<string, unknown>
}>()
const emit = defineEmits<{
  update: [parameterId: string, value: unknown]
}>()

function displayValue(parameterId: string): string | number {
  const value = props.values[parameterId]
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

function parameterInputType(type: unknown): 'number' | 'text' {
  return type === 'int' || type === 'float' ? 'number' : 'text'
}

function updateBoolean(parameterId: string, event: Event): void {
  emit('update', parameterId, (event.target as HTMLInputElement).checked)
}

function updateChoice(parameter: WorkspaceCreationParameter, event: Event): void {
  const selected = (event.target as HTMLSelectElement).value
  const choices = parameter.definition.choices as unknown[]
  emit(
    'update',
    parameter.definition.id,
    choices.find((choice) => String(choice) === selected),
  )
}

function updateInput(parameter: WorkspaceCreationParameter, event: Event): void {
  const input = event.target as HTMLInputElement
  const type = String(parameter.definition.type)
  const parts = input.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const value = type.startsWith('list[')
    ? type === 'list[int]' || type === 'list[float]'
      ? parts.map(Number)
      : parts
    : type === 'int' || type === 'float'
      ? input.valueAsNumber
      : input.value
  emit('update', parameter.definition.id, value)
}
</script>
