<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import { StepEnum } from '@/api/type'
import { useLayoutState } from '@/composables/useLayoutState'
import DrawingArea from '../components/DrawingArea.vue'
import ChatInspectorPanel from '../components/ChatInspectorPanel.vue'
import ThumbnailGallery from '../components/ThumbnailGallery.vue'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import LayerPanel from '../components/LayerPanel.vue'
import DrcViolationPanel from '../components/DrcViolationPanel.vue'

const layoutState = useLayoutState()
const route = useRoute()

/** Image preview mode hides layer/property columns; avoid :key on the whole tree or DrawingArea remounts and resets the layout view */
const showLayoutSidePanels = computed(() => layoutState.renderMode.value === 'layout')

/** DRC route only: show violation panel (matches DrawingArea step) */
const isDrcStep = computed(() => {
  const pathParts = route.path.split('/')
  const stage = pathParts[pathParts.length - 1] || ''
  return stage.toLowerCase() === StepEnum.DRC.toLowerCase()
})

const mainSplitter = ref<InstanceType<typeof Splitter> | null>(null)

watch(
  [showLayoutSidePanels, isDrcStep],
  async () => {
    await nextTick()
    mainSplitter.value?.resetState?.()
  },
  { flush: 'post' },
)

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

    // Clear any selection (Linux WebKitGTK)
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
    <Splitter ref="mainSplitter" class="flex-1 h-full border-none min-w-0">
      <!-- Left: Drawing + thumbnails (60+15 merged to 75 when middle column hidden) -->
      <SplitterPanel :size="showLayoutSidePanels ? 60 : 75" :minSize="35" class="flex flex-col min-w-0">
        <Splitter layout="vertical" class="h-full border-none">
          <SplitterPanel :size="70" :minSize="30" class="flex flex-col">
            <DrawingArea />
          </SplitterPanel>
          <SplitterPanel :size="30" class="flex flex-col">
            <ThumbnailGallery />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <!-- Middle: layout panels (vector/tile mode only) -->
      <SplitterPanel
        v-if="showLayoutSidePanels"
        :size="15"
        :minSize="10"
        class="flex flex-col min-w-0 overflow-hidden"
      >
        <Splitter layout="vertical" class="h-full border-none">
          <SplitterPanel
            v-if="isDrcStep"
            :size="32"
            :minSize="16"
            class="flex flex-col overflow-hidden min-h-0"
          >
            <DrcViolationPanel />
          </SplitterPanel>
          <SplitterPanel
            :size="isDrcStep ? 34 : 45"
            :minSize="14"
            class="flex flex-col overflow-hidden min-h-0"
          >
            <LayerPanel />
          </SplitterPanel>
          <SplitterPanel
            :size="isDrcStep ? 34 : 55"
            :minSize="18"
            class="flex flex-col overflow-hidden min-h-0"
          >
            <PropertiesPanel />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>

      <!-- Right: Chat -->
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
