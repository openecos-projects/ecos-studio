<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import DrawingArea from '../components/DrawingArea.vue'
import ChatInspectorPanel from '../components/ChatInspectorPanel.vue'
import ThumbnailGallery from '../components/ThumbnailGallery.vue'

const route = useRoute()
const router = useRouter()
let isResizing = false

const projectContext = computed(() => {
  const projectRoot = queryString(route.query.projectRoot)
  if (!projectRoot) return null

  return {
    projectRoot,
    projectName: queryString(route.query.projectName) || basenamePath(projectRoot),
    workspaceId: queryString(route.query.workspaceId),
  }
})

function backToProject() {
  router.push('/projects')
}

function createWorkspaceFromCurrentStep() {
  if (!projectContext.value) return
  const sourceStep = queryString(route.params.step) || 'Synth'
  router.push({
    path: '/ecc',
    query: {
      projectRoot: projectContext.value.projectRoot,
      projectName: projectContext.value.projectName,
      sourceWorkspace: projectContext.value.workspaceId,
      sourceStep,
    },
  })
}

function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function basenamePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').split('/').filter(Boolean).pop() ?? ''
}

const handleMouseDown = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  const gutter = target.closest('.p-splitter-gutter')
  if (gutter) {
    isResizing = true
    document.body.classList.add('splitter-resizing')

    const splitter = gutter.closest('.p-splitter')
    if (splitter?.classList.contains('p-splitter-vertical')) {
      document.body.classList.add('splitter-resizing-vertical')
    }

    // Clear any selection (Linux WebKitGTK)
    window.getSelection()?.removeAllRanges()
  }
}

const handleMouseUp = () => {
  if (isResizing) {
    isResizing = false
  }
  document.body.classList.remove('splitter-resizing')
  document.body.classList.remove('splitter-resizing-vertical')
}

const handleVisibilityChange = () => {
  if (document.visibilityState !== 'visible') {
    handleMouseUp()
  }
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
  <div class="editor-view">
    <div v-if="projectContext" class="project-context-strip">
      <div class="project-context-copy">
        <strong>{{ projectContext.projectName }}</strong>
        <span>{{ projectContext.workspaceId || 'workspace' }}</span>
      </div>
      <div class="project-context-actions">
        <button type="button" @click="backToProject">
          <i class="ri-arrow-left-line"></i>
          <span>Back to Project</span>
        </button>
        <button type="button" @click="createWorkspaceFromCurrentStep">
          <i class="ri-add-line"></i>
          <span>Create Workspace From Current Step</span>
        </button>
      </div>
    </div>

    <Splitter class="flex-1 h-full border-none min-w-0">
      <SplitterPanel :size="75" :minSize="35" class="flex flex-col min-w-0">
        <Splitter layout="vertical" class="h-full border-none">
          <SplitterPanel :size="70" :minSize="30" class="flex flex-col">
            <DrawingArea />
          </SplitterPanel>
          <SplitterPanel :size="30" class="flex flex-col">
            <ThumbnailGallery />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <SplitterPanel :size="25" :minSize="25" class="chat-panel overflow-hidden min-w-0 max-w-full">
        <ChatInspectorPanel />
      </SplitterPanel>
    </Splitter>
  </div>
</template>
<style scoped>
.editor-view {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
  height: 100%;
}

.project-context-strip {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
}

.project-context-copy {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.project-context-copy strong,
.project-context-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-context-copy strong {
  color: var(--text-primary);
  font-size: 13px;
}

.project-context-copy span {
  color: var(--text-secondary);
  font-size: 12px;
}

.project-context-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 8px;
}

.project-context-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 46%, transparent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.project-context-actions button:hover {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 58%, transparent);
}

:deep(.p-splitter) {
  display: flex;
  flex-wrap: nowrap;
  min-width: 0;
  min-height: 0;
  background: transparent;
  border: none;
  /* layout only; avoid paint containment on panels (conflicts with wide tables + scrollbars in WebKitGTK) */
  contain: layout;
}

:deep(.p-splitter.p-splitter-vertical) {
  flex-direction: column;
}

/*
 * index.css 对 .p-splitterpanel 使用了 contain: layout style paint；
 * 在部分 WebKit/GTK 下与宽图/替换元素组合时，会误参与祖先的 min-content 宽度。
 * 在此用更高优先级只保留 style containment，避免横向把整行撑出视口。
 */
:deep(.p-splitterpanel) {
  display: flex;
  flex-grow: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  contain: style;
}

:deep(.p-splitterpanel-nested) {
  display: flex;
}

:deep(.p-splitterpanel > *) {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

:deep(.p-splitterpanel .p-splitter) {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  border: 0 none;
}

:deep(.p-splitter-gutter) {
  background: var(--border-color);
  transition: background-color 0.15s ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Fewer repaints */
  will-change: background-color;
}

:deep(.p-splitter-gutter:hover) {
  background: var(--accent-color);
  opacity: 0.5;
}

:deep(.p-splitter-gutter-handle) {
  display: none !important;
  /* Hide default large handle */
}

/* Horizontal splitter gutter */
:deep(.p-splitter-horizontal > .p-splitter-gutter) {
  width: 2px !important;
  cursor: col-resize;
}

/* Vertical splitter gutter */
:deep(.p-splitter-vertical > .p-splitter-gutter) {
  height: 2px !important;
  cursor: row-resize;
}

/*
 * Right Chat/Inspector: PrimeVue sets flex-basis; theme often uses flex:1 with flex-shrink 1.
 * Wide Floorplan tables have huge min-content and shrink this column; !important prevents flex-shrink.
 */
:deep(.p-splitterpanel.chat-panel) {
  box-sizing: border-box;
  flex-grow: 0 !important;
  flex-shrink: 0 !important;
}

/* Fill column width; avoid subtree content width affecting parent flex */
:deep(.chat-panel.p-splitterpanel > *) {
  min-width: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
</style>
