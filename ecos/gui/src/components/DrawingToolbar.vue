<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import type { Editor } from '@/applications/editor'

interface Props {
  editor?: Editor | null
}

const props = defineProps<Props>()

const activeTool = ref('hand')
const isRulerEnabled = ref(true)
const zoomLevel = ref(100)
let unlistenTransform: (() => void) | null = null

const tools = [
  { id: 'hand', icon: 'ri-hand', tooltip: 'Pan' },
  { id: 'select', icon: 'ri-cursor-fill', tooltip: 'Select' },
  { id: 'marquee', icon: 'ri-shape-line', tooltip: 'Marquee' },
  { id: 'route', icon: 'ri-route-line', tooltip: 'Route' },
  { id: 'measure', icon: 'ri-ruler-2-line', tooltip: 'Measure' },
  { id: 'highlight', icon: 'ri-focus-3-line', tooltip: 'Highlight' },
  { id: 'layers', icon: 'ri-stack-line', tooltip: 'Layers' },
  { id: 'annotation', icon: 'ri-markup-line', tooltip: 'Annotate' }
]

const setActiveTool = (toolId: string) => {
  activeTool.value = toolId
}

const toggleRuler = () => {
  isRulerEnabled.value = !isRulerEnabled.value
  props.editor?.setPluginEnabled('ruler', isRulerEnabled.value)
}

const handleZoomIn = () => {
  props.editor?.zoomIn()
}

const handleZoomOut = () => {
  props.editor?.zoomOut()
}

const handleFitToWorld = () => {
  props.editor?.fitToWorld()
}

// 监听 editor 变化，初始化状态和监听器
watch(() => props.editor, (editor) => {
  if (editor) {
    // 确保编辑器标尺状态与 UI 同步
    editor.setPluginEnabled('ruler', isRulerEnabled.value)

    // 监听缩放变化更新 UI
    zoomLevel.value = Math.round(editor.getScale() * 100)

    // 清理旧的监听器
    if (unlistenTransform) {
      unlistenTransform()
    }

    unlistenTransform = editor.onTransformChange((t) => {
      zoomLevel.value = Math.round(t.scale * 100)
    })
  }
}, { immediate: true })

onUnmounted(() => {
  if (unlistenTransform) {
    unlistenTransform()
  }
})
</script>

<template>
  <div class="h-10 bg-(--bg-secondary) border-b border-(--border-color) flex items-center gap-2 px-4 shrink-0">
    <!-- 工具按钮组 -->
    <div class="flex items-center gap-1">
      <button v-for="tool in tools" :key="tool.id" @click="setActiveTool(tool.id)" :class="{
        'bg-(--accent-color) text-white': activeTool === tool.id,
        'text-(--text-secondary) hover:text-(--text-primary) hover:bg-(--bg-hover)': activeTool !== tool.id
      }" class="w-9 h-9 flex items-center justify-center rounded transition-all" :title="tool.tooltip">
        <i :class="tool.icon" class="text-base"></i>
      </button>
    </div>

    <div class="w-px h-6 bg-(--border-color)"></div>

    <!-- 右侧：缩放控制等 -->
    <div class="flex-1 flex items-center justify-end gap-3">
      <!-- 标尺开关 -->
      <button @click="toggleRuler" :class="[
        isRulerEnabled ? 'text-(--accent-color) bg-(--accent-color)/20 border-(--accent-color)/50 shadow-sm shadow-(--accent-color)/20' : 'text-(--text-secondary) border-(--border-color) hover:text-(--text-primary) hover:bg-(--bg-hover) hover:border-(--border-color)',
        'h-8 px-2 flex items-center gap-1.5 rounded border transition-all'
      ]" title="Show/Hide Ruler">
        <i class="ri-ruler-line text-base"></i>
      </button>

      <div class="w-px h-6 bg-(--border-color)"></div>

      <div class="flex items-center gap-2 px-3 py-1.5 bg-(--bg-primary) rounded border border-(--border-color)">
        <button @click="handleZoomOut" class="text-(--text-secondary) hover:text-(--text-primary) transition-colors"
          title="Zoom Out">
          <i class="ri-subtract-line text-sm"></i>
        </button>
        <span class="text-[13px] text-(--text-primary) font-medium min-w-[50px] text-center">{{ zoomLevel }}%</span>
        <button @click="handleZoomIn" class="text-(--text-secondary) hover:text-(--text-primary) transition-colors"
          title="Zoom In">
          <i class="ri-add-line text-sm"></i>
        </button>
      </div>
      <button @click="handleFitToWorld"
        class="w-8 h-8 flex items-center justify-center rounded text-(--text-secondary) hover:text-(--text-primary) hover:bg-(--bg-hover) transition-colors"
        title="Fit to Canvas">
        <i class="ri-fullscreen-fill text-base"></i>
      </button>
    </div>
  </div>
</template>
