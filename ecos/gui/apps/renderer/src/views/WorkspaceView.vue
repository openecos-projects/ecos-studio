<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import DrawingArea from '@/components/DrawingArea.vue'
import ThumbnailGallery from '@/components/ThumbnailGallery.vue'
import FlowLogPanel from '@/components/workbench/FlowLogPanel.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import { flowNodeStatus, type FlowStatusNode } from '@/components/workbench/flowStatus'
import { getStepMetadata } from '@/api/type'
import { useHomeData } from '@/composables/useHomeData'
import { useSubflow } from '@/composables/useSubflow'
import { useRoute } from 'vue-router'

const { currentStepTitle, isLoading, subflowSteps } = useSubflow()
const route = useRoute()
const {
  currentWorkspaceFlowExecutionActive,
  ensureFlowLogSegmentContentLoaded,
  flowLogContentByKey,
  flowLogError,
  flowLogLoading,
  flowLogSegments,
} = useHomeData()

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
const currentStepLogNode = computed<FlowStatusNode | null>(() => {
  const stepKey = typeof route.params.step === 'string' ? route.params.step : ''
  if (!stepKey) return null

  const metadata = getStepMetadata(stepKey)
  const label = metadata?.label ?? stepKey
  const segment = flowLogSegments.value.find(
    (item) => item.stepName.trim().toLowerCase() === label.trim().toLowerCase(),
  )
  return {
    id: `workspace-log:${metadata?.path ?? stepKey}`,
    label: segment?.stepName ?? label,
    status: flowNodeStatus(segment?.state),
    runtime: '',
    peakMemoryMb: null,
  }
})

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
    <template #right-log>
      <FlowLogPanel
        :content-by-key="flowLogContentByKey"
        :ensure-content="ensureFlowLogSegmentContentLoaded"
        :error="flowLogError"
        :execution-active="currentWorkspaceFlowExecutionActive"
        :loading="flowLogLoading"
        :selected-node="currentStepLogNode"
        :segments="flowLogSegments"
      />
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

.step-presentation-splitter :deep(.p-splitterpanel) {
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.step-presentation-splitter :deep(.p-splitterpanel > *) {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.step-presentation-splitter :deep(.p-splitter-gutter) {
  background: var(--border-color);
}

.step-presentation-splitter :deep(.p-splitter-gutter:hover) {
  background: var(--accent-color);
}

.step-presentation-splitter :deep(.p-splitter-gutter-handle) {
  display: none;
}

.step-presentation-splitter :deep(.p-splitter-vertical > .p-splitter-gutter) {
  cursor: row-resize;
  height: 4px;
}
</style>
