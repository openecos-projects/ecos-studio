<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import FlowRunControl from '@/components/workbench/FlowRunControl.vue'
import StepDashboard from '@/components/StepDashboard.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import { useSubflow } from '@/composables/useSubflow'
import { useRoute } from 'vue-router'

const { currentStepTitle, isLoading } = useSubflow()
const route = useRoute()
let isResizing = false

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
  <WorkspaceWorkbench
    :flow-title="currentStepTitle"
    :loading="isLoading"
    :nodes="[]"
    agent-only
  >
    <template #left>
      <section class="workspace-step-view">
        <header>
          <span>{{ currentStepTitle }}</span>
          <router-link :to="{ path: '/workspace/home', query: route.query }"
            >Dashboard</router-link
          >
          <FlowRunControl />
        </header>
        <StepDashboard />
      </section>
    </template>
  </WorkspaceWorkbench>
</template>
