<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import type { ImagePreviewController } from '@/applications/image-preview'

interface Props {
  preview?: ImagePreviewController | null
  /** 是否显示「打开 Native Layout Viewer」工具 */
  showNativeLayoutViewer?: boolean
  /** Native viewer 拉起中 */
  nativeLayoutViewerBusy?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  preview: null,
  showNativeLayoutViewer: false,
  nativeLayoutViewerBusy: false,
})

const emit = defineEmits<{
  openNativeLayoutViewer: []
}>()

const isRulerEnabled = ref(true)
const zoomPercentLabel = ref('100')
let unlistenTransform: (() => void) | null = null

function formatZoomPercentLabel(scale: number): string {
  const pct = scale * 100
  if (!Number.isFinite(pct) || pct <= 0) return '0'
  if (pct < 0.01) return '<0.01'
  if (pct < 1) return pct.toFixed(2).replace(/\.?0+$/, '')
  return String(Math.round(pct))
}

function toggleRuler(): void {
  isRulerEnabled.value = !isRulerEnabled.value
  props.preview?.setRulerEnabled(isRulerEnabled.value)
}

function handleZoomIn(): void {
  props.preview?.zoomIn()
}

function handleZoomOut(): void {
  props.preview?.zoomOut()
}

function handleFitToWorld(): void {
  props.preview?.fitToWorld()
}

watch(() => props.preview, (preview) => {
  if (unlistenTransform) {
    unlistenTransform()
    unlistenTransform = null
  }

  if (!preview) return

  preview.setRulerEnabled(isRulerEnabled.value)
  zoomPercentLabel.value = formatZoomPercentLabel(preview.getScale())
  unlistenTransform = preview.onTransformChange((t) => {
    zoomPercentLabel.value = formatZoomPercentLabel(t.scale)
  })
}, { immediate: true })

onUnmounted(() => {
  if (unlistenTransform) {
    unlistenTransform()
  }
})
</script>

<template>
  <div class="h-10 shrink-0 border-b border-(--border-color) bg-(--bg-secondary) px-4 flex items-center gap-2">
    <div class="flex items-center gap-1">
      <button
        v-if="showNativeLayoutViewer"
        type="button"
        :disabled="nativeLayoutViewerBusy"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded text-base transition-all disabled:cursor-wait disabled:opacity-50 disabled:text-(--text-secondary)"
        :class="nativeLayoutViewerBusy
          ? 'text-(--text-secondary)'
          : 'text-(--text-secondary) hover:text-(--text-primary) hover:bg-(--bg-hover)'"
        title="打开 Native Layout Viewer"
        aria-label="打开 Native Layout Viewer"
        @click="emit('openNativeLayoutViewer')"
      >
        <i
          class="ri-window-line text-base"
          :class="{ 'animate-pulse': nativeLayoutViewerBusy }"
        ></i>
      </button>
    </div>

    <div class="h-6 w-px bg-(--border-color)"></div>

    <div class="flex flex-1 items-center justify-end gap-3">
      <button
        :class="[
          isRulerEnabled
            ? 'text-(--accent-color) bg-(--accent-color)/20 border-(--accent-color)/50 shadow-sm shadow-(--accent-color)/20'
            : 'text-(--text-secondary) border-(--border-color) hover:text-(--text-primary) hover:bg-(--bg-hover) hover:border-(--border-color)',
          'h-8 px-2 flex items-center gap-1.5 rounded border transition-all',
        ]"
        title="Show/Hide Ruler"
        @click="toggleRuler"
      >
        <i class="ri-ruler-line text-base"></i>
      </button>

      <div class="h-6 w-px bg-(--border-color)"></div>

      <div class="flex items-center gap-2 rounded border border-(--border-color) bg-(--bg-primary) px-3 py-1.5">
        <button
          class="text-(--text-secondary) transition-colors hover:text-(--text-primary)"
          title="Zoom Out"
          @click="handleZoomOut"
        >
          <i class="ri-subtract-line text-sm"></i>
        </button>
        <span class="min-w-[52px] text-center text-[13px] font-medium text-(--text-primary) tabular-nums">
          {{ zoomPercentLabel }}%
        </span>
        <button
          class="text-(--text-secondary) transition-colors hover:text-(--text-primary)"
          title="Zoom In"
          @click="handleZoomIn"
        >
          <i class="ri-add-line text-sm"></i>
        </button>
      </div>
      <button
        class="flex h-8 w-8 items-center justify-center rounded text-(--text-secondary) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
        title="Fit to Canvas"
        @click="handleFitToWorld"
      >
        <i class="ri-fullscreen-fill text-base"></i>
      </button>
    </div>
  </div>
</template>
