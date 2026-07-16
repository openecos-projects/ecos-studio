<script setup lang="ts">
import StepConfigValueBlock from './StepConfigValueBlock.vue'

const draft = defineModel<unknown>({ required: true })
</script>

<template>
  <div class="sc-pro sc-cards max-w-full min-w-0" data-accent="indigo">
    <StepConfigValueBlock v-model="draft" :depth="0" :max-depth="6" accent="indigo" />
  </div>
</template>
