<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import DrawingArea from '@/components/DrawingArea.vue'
import ThumbnailGallery from '@/components/ThumbnailGallery.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import { flowNodeStatus, type FlowStatusNode } from '@/components/workbench/flowStatus'
import { useSubflow } from '@/composables/useSubflow'

const { currentStepTitle, isLoading, subflowSteps } = useSubflow()

let isResizing = false

const flowNodes = computed<FlowStatusNode[]>(() =>
  subflowSteps.value.map((step) => ({
    id: step.id,
    label: step.name,
    status: flowNodeStatus(step.status),
    runtime: step.duration ?? '',
    peakMemoryMb: step.peakMemory ?? null,
    detail: step.description,
  })),
)
const flowTitle = computed(() => `${currentStepTitle.value} subflow`)

function handleMouseDown(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (!target.closest('.p-splitter-gutter')) return
  isResizing = true
  document.body.classList.add('splitter-resizing')
  window.getSelection()?.removeAllRanges()
}

function handleMouseUp(): void {
  if (!isResizing) return
  isResizing = false
  document.body.classList.remove('splitter-resizing')
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') handleMouseUp()
}

onMounted(() => {
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('mouseup', handleMouseUp)
  document.addEventListener('pointerup', handleMouseUp)
  document.addEventListener('dragend', handleMouseUp)
  window.addEventListener('blur', handleMouseUp)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('pointerup', handleMouseUp)
  document.removeEventListener('dragend', handleMouseUp)
  window.removeEventListener('blur', handleMouseUp)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  handleMouseUp()
})
</script>

<template>
  <WorkspaceWorkbench :flow-title="flowTitle" :loading="isLoading" :nodes="flowNodes">
    <template #left>
      <div class="step-presentation">
        <Splitter layout="vertical" class="step-presentation-splitter" :gutter-size="4">
          <SplitterPanel :size="72" :min-size="30" class="step-presentation-main">
            <DrawingArea />
          </SplitterPanel>
          <SplitterPanel :size="28" class="step-presentation-thumbnails">
            <ThumbnailGallery />
          </SplitterPanel>
        </Splitter>
      </div>
    </template>
  </WorkspaceWorkbench>
</template>

<style scoped>
.step-presentation {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.step-presentation-splitter {
  background: transparent;
  border: 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

:deep(.p-splitterpanel) {
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

:deep(.p-splitterpanel > *) {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

:deep(.p-splitter-gutter) {
  background: var(--border-color);
}

:deep(.p-splitter-gutter:hover) {
  background: var(--accent-color);
}

:deep(.p-splitter-gutter-handle) {
  display: none;
}

:deep(.p-splitter-vertical > .p-splitter-gutter) {
  cursor: row-resize;
  height: 4px;
}
</style>
