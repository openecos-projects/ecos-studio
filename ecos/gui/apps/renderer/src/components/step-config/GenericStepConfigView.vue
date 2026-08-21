<script setup lang="ts">
import StepConfigValueBlock from './StepConfigValueBlock.vue'

const draft = defineModel<unknown>({ required: true })

withDefaults(
  defineProps<{
    readonly?: boolean
  }>(),
  { readonly: false },
)
</script>

<template>
  <div
    class="sc-pro sc-cards max-w-full min-w-0"
    :class="{ 'is-readonly': readonly }"
    :inert="readonly"
    data-accent="indigo"
  >
    <StepConfigValueBlock v-model="draft" :depth="0" :max-depth="6" accent="indigo" :readonly="readonly" />
  </div>
</template>
