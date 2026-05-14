<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'
import { StepEnum } from '@/api/type'
import GenericStepConfigView from './GenericStepConfigView.vue'
/** Sync import: async chunks mount after flex scroll layout in WebKit/GTK, which can break .sc-scroll overflow. */
import FloorplanStepConfigView from './views/FloorplanStepConfigView.vue'

const draft = defineModel<unknown>({ required: true })

const props = defineProps<{
  step: StepEnum
}>()
const CtsStepConfigView = defineAsyncComponent(() => import('./views/CtsStepConfigView.vue'))
const RtStepConfigView = defineAsyncComponent(() => import('./views/RtStepConfigView.vue'))
const DrcStepConfigView = defineAsyncComponent(() => import('./views/DrcStepConfigView.vue'))
const PlStepConfigView = defineAsyncComponent(() => import('./views/PlStepConfigView.vue'))

const VIEW_MAP: Partial<Record<StepEnum, Component>> = {
  [StepEnum.FLOORPLAN]: FloorplanStepConfigView,
  [StepEnum.CTS]: CtsStepConfigView,
  [StepEnum.ROUTING]: RtStepConfigView,
  /** pl_default_config.json: root `PL` block — same schema as Placement / Legalization */
  [StepEnum.FILLER]: PlStepConfigView,
  [StepEnum.DRC]: DrcStepConfigView,
  [StepEnum.PLACEMENT]: PlStepConfigView,
  [StepEnum.LEGALIZATION]: PlStepConfigView,
}

const activeView = computed(() => VIEW_MAP[props.step] ?? GenericStepConfigView)
</script>

<template>
  <component :is="activeView" v-model="draft" />
</template>
