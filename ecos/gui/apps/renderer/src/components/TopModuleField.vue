<template>
  <div>
    <label class="mb-2 block text-sm font-semibold text-(--text-primary)"
      >Top Module Name <span class="text-red-500">*</span></label
    >
    <p
      v-if="readonly"
      class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/45 px-3 py-2.5 text-sm text-(--text-primary)"
    >
      {{ modelValue || '-' }}
    </p>
    <input
      v-else-if="readonlyInput"
      :value="modelValue"
      type="text"
      aria-label="Top Module Name"
      readonly
      class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/45 px-3 py-2.5 text-sm text-(--text-secondary) outline-none"
    />
    <input
      v-else-if="allowFreeText"
      :value="modelValue"
      type="text"
      aria-label="Top Module Name"
      placeholder="top"
      class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <Select
      v-else
      :model-value="modelValue || null"
      :options="orderedCandidates"
      filter
      filter-placeholder="Filter modules"
      placeholder="Select a module"
      aria-label="Top Module Name"
      fluid
      append-to="body"
      overlay-class="top-module-select-overlay"
      class="top-module-select w-full"
      @update:model-value="onSelect"
    >
      <template #value="{ value, placeholder }">
        <span v-if="value">{{ optionLabel(String(value)) }}</span>
        <span v-else class="text-(--text-secondary)">{{ placeholder }}</span>
      </template>
      <template #option="{ option }">
        {{ optionLabel(option) }}
      </template>
    </Select>
    <p v-if="message" class="mt-2 text-xs" :class="messageClass">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Select from 'primevue/select'
import { orderTopModuleCandidates } from './topModuleConfirmation'

const props = withDefaults(
  defineProps<{
    allowFreeText?: boolean
    candidates?: string[]
    message?: string
    modelValue: string
    readonly?: boolean
    readonlyInput?: boolean
    suggested?: string
  }>(),
  {
    allowFreeText: false,
    candidates: () => [],
    message: '',
    readonly: false,
    readonlyInput: false,
    suggested: '',
  },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  pick: [value: string]
}>()

const orderedCandidates = computed(() =>
  orderTopModuleCandidates(props.candidates, props.suggested),
)
const messageClass = computed(() =>
  props.allowFreeText || props.readonly || props.readonlyInput
    ? 'text-(--text-secondary)'
    : 'text-red-500',
)

function optionLabel(name: string): string {
  return name === props.suggested ? `${name} (suggested)` : name
}

function onSelect(value: unknown) {
  const next = typeof value === 'string' ? value : ''
  emit('update:modelValue', next)
  if (next) emit('pick', next)
}
</script>

<style scoped>
.top-module-select {
  width: 100%;
  border-radius: 0.5rem;
  border-color: var(--border-color);
  background: color-mix(in oklab, var(--bg-primary) 75%, transparent);
}
.top-module-select :deep(.p-select-label) {
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  color: var(--text-primary);
}
</style>

<style>
.top-module-select-overlay {
  z-index: 200;
}
</style>
