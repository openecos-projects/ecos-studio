<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, type Component } from 'vue'
import { StepEnum } from '@/api/type'
import GenericStepConfigView from './GenericStepConfigView.vue'
/** Sync import: async chunks mount after flex scroll layout in WebKit/GTK, which can break .sc-scroll overflow. */
import FloorplanStepConfigView from './views/FloorplanStepConfigView.vue'

const draft = defineModel<unknown>({ required: true })

const props = defineProps<{
  step: StepEnum
  readonly?: boolean
}>()
const emit = defineEmits<{ initialized: [] }>()
let initialized = false
const CtsStepConfigView = defineAsyncComponent(
  () => import('./views/CtsStepConfigView.vue'),
)
const RtStepConfigView = defineAsyncComponent(
  () => import('./views/RtStepConfigView.vue'),
)
const DrcStepConfigView = defineAsyncComponent(
  () => import('./views/DrcStepConfigView.vue'),
)

const VIEW_MAP: Partial<Record<StepEnum, Component>> = {
  [StepEnum.FLOORPLAN]: FloorplanStepConfigView,
  [StepEnum.CTS]: CtsStepConfigView,
  [StepEnum.ROUTING]: RtStepConfigView,
  [StepEnum.DRC]: DrcStepConfigView,
}

const activeView = computed(() => VIEW_MAP[props.step] ?? GenericStepConfigView)

function emitInitialized(): void {
  if (initialized) return
  initialized = true
  emit('initialized')
}

onMounted(() => {
  if (activeView.value !== DrcStepConfigView) {
    emitInitialized()
  }
})
</script>

<template>
  <component :is="activeView" v-model="draft" :readonly="readonly" @initialized="emitInitialized" />
</template>
