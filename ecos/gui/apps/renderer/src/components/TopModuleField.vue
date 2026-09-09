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
    <div v-else class="space-y-2">
      <input
        v-if="orderedCandidates.length > 8"
        v-model="filterText"
        type="search"
        aria-label="Filter Top Module candidates"
        placeholder="Filter modules"
        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
      />
      <select
        :value="modelValue"
        aria-label="Top Module Name"
        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
        @change="onSelect"
      >
        <option v-if="!modelValue" value="" disabled>Select a module</option>
        <option v-for="name in filteredCandidates" :key="name" :value="name">
          {{ name }}{{ name === suggested ? ' (suggested)' : '' }}
        </option>
      </select>
    </div>
    <p v-if="message" class="mt-2 text-xs" :class="messageClass">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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

const filterText = ref('')
const orderedCandidates = computed(() =>
  orderTopModuleCandidates(props.candidates, props.suggested),
)
const filteredCandidates = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  const ordered = orderedCandidates.value
  if (!query) return ordered
  const matched = ordered.filter((name) => name.toLowerCase().includes(query))
  if (
    props.modelValue &&
    ordered.includes(props.modelValue) &&
    !matched.includes(props.modelValue)
  ) {
    return [props.modelValue, ...matched]
  }
  return matched
})
const messageClass = computed(() =>
  props.allowFreeText || props.readonly || props.readonlyInput
    ? 'text-(--text-secondary)'
    : 'text-red-500',
)

function onSelect(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:modelValue', value)
  emit('pick', value)
}
</script>
