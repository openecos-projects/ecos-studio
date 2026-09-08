<script setup lang="ts">
import { onMounted } from 'vue'
import type { StepEnum } from '@/api/type'
import GenericStepConfigView from './GenericStepConfigView.vue'

const draft = defineModel<unknown>({ required: true })

defineProps<{
  step: StepEnum
  readonly?: boolean
  parameterDescriptions?: Record<string, string>
}>()
const emit = defineEmits<{ initialized: [] }>()
let initialized = false

function emitInitialized(): void {
  if (initialized) return
  initialized = true
  emit('initialized')
}

onMounted(() => {
  emitInitialized()
})
</script>

<template>
  <component
    :is="GenericStepConfigView"
    v-model="draft"
    :readonly="readonly"
    :parameter-descriptions="parameterDescriptions"
    @initialized="emitInitialized"
  />
</template>
