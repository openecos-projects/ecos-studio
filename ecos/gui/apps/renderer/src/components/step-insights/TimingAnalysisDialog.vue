<template>
  <Dialog
    :visible="visible"
    class="timing-analysis-dialog"
    modal
    maximizable
    :header="header"
    :style="{ width: 'min(1080px, calc(100vw - 40px))' }"
    :content-style="{ height: 'min(72vh, 680px)', overflow: 'auto' }"
    :draggable="false"
    @update:visible="onVisibleUpdate"
  >
    <TimingAnalysisPanel
      v-if="visible"
      :overview="overview"
      :paths-by-corner="pathsByCorner ?? null"
      :run-info="runInfo ?? []"
      :initial-corner="initialCorner ?? null"
      :empty-hint="emptyHint"
    />
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import type { StaCriticalPath, StaOverviewModel } from '../flow-insights/flowInsightsData'
import TimingAnalysisPanel from './TimingAnalysisPanel.vue'

defineProps<{
  visible: boolean
  header: string
  overview: StaOverviewModel | null
  pathsByCorner?: Array<{ corner: string; paths: StaCriticalPath[] }> | null
  runInfo?: Array<{ id: string; label: string; value: string }>
  initialCorner?: string | null
  emptyHint?: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

function onVisibleUpdate(value: boolean): void {
  emit('update:visible', value)
}
</script>

<style scoped>
/* Content sizing lives in the unscoped block below; Dialog teleports to body. */
</style>

<style>
.timing-analysis-dialog.p-dialog-maximized {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  width: 100vw;
}

.timing-analysis-dialog.p-dialog-maximized .p-dialog-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: auto !important;
  max-height: none !important;
  min-height: 0;
  overflow: hidden;
}

.timing-analysis-dialog.p-dialog-maximized .p-dialog-content > * {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
