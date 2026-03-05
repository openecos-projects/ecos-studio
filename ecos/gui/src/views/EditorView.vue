<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import DrawingArea from '../components/DrawingArea.vue'
import ChatInspectorPanel from '../components/ChatInspectorPanel.vue'
import ThumbnailGallery from '../components/ThumbnailGallery.vue'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import LayerPanel from '../components/LayerPanel.vue'
import { useLayoutState } from '@/composables/useLayoutState'

const layoutState = useLayoutState()
const isLayoutMode = computed(() => layoutState.renderMode.value === 'layout')

let isResizing = false

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

    // 立即清除任何已存在的选区（Linux WebKitGTK 兼容）
    window.getSelection()?.removeAllRanges()
  }
}

const handleMouseUp = () => {
  if (isResizing) {
    isResizing = false
    document.body.classList.remove('splitter-resizing')
    document.body.classList.remove('splitter-resizing-vertical')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('mouseup', handleMouseUp)
  document.body.classList.remove('splitter-resizing')
  document.body.classList.remove('splitter-resizing-vertical')
})
</script>
<template>
  <div class="editor-view">
    <Splitter class="flex-1 h-full border-none min-w-0">
      <!-- Left: Drawing + Thumbnails -->
      <SplitterPanel :size="isLayoutMode ? 50 : 65" :minSize="35" class="flex flex-col min-w-0">
        <Splitter layout="vertical" class="h-full border-none">
          <SplitterPanel :size="70" :minSize="30" class="flex flex-col">
            <DrawingArea />
          </SplitterPanel>
          <SplitterPanel :size="30" class="flex flex-col">
            <ThumbnailGallery />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <!-- Middle: Layout panels (only in layout mode) -->
      <SplitterPanel v-if="isLayoutMode" :size="15" :minSize="10" class="flex flex-col min-w-0 overflow-hidden">
        <Splitter layout="vertical" class="h-full border-none">
          <SplitterPanel :size="45" :minSize="20" class="flex flex-col overflow-hidden">
            <LayerPanel :layer-manager="layoutState.layerManager.value" />
          </SplitterPanel>
          <SplitterPanel :size="55" :minSize="20" class="flex flex-col overflow-hidden">
            <PropertiesPanel
              :selected-groups="layoutState.selectedGroups.value"
              :data-store="layoutState.dataStore.value"
            />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <!-- Right: Chat -->
      <SplitterPanel :size="isLayoutMode ? 35 : 35" :minSize="25" class="chat-panel overflow-hidden min-w-0 max-w-full">
        <ChatInspectorPanel />
      </SplitterPanel>
    </Splitter>
  </div>
</template>
<style scoped>
.editor-view {
  width: 100%;
  height: 100%;
}

:deep(.p-splitter) {
  background: transparent;
  border: none;
  /* 优化性能 */
  contain: layout style;
}

:deep(.p-splitter-panel) {
  /* 优化重绘性能 */
  contain: layout style paint;
  will-change: auto;
}

:deep(.p-splitter-gutter) {
  background: var(--border-color);
  transition: background-color 0.15s ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 减少重绘 */
  will-change: background-color;
}

:deep(.p-splitter-gutter:hover) {
  background: var(--accent-color);
  opacity: 0.5;
}

:deep(.p-splitter-gutter-handle) {
  display: none !important;
  /* 隐藏默认的大手柄 */
}

/* 针对横向分割条 */
:deep(.p-splitter-horizontal > .p-splitter-gutter) {
  width: 2px !important;
  cursor: col-resize;
}

/* 针对纵向分割条 */
:deep(.p-splitter-vertical > .p-splitter-gutter) {
  height: 2px !important;
  cursor: row-resize;
}

/* 确保 Splitter 面板可以正确收缩 */
:deep(.p-splitter-panel) {
  min-width: 0;
  overflow: hidden;
}

/* Chat 面板严格约束 - 防止内容撑开 */
.chat-panel {
  contain: layout style size;
  box-sizing: border-box;
}

:deep(.chat-panel > *) {
  max-width: 100%;
  min-width: 0;
}
</style>