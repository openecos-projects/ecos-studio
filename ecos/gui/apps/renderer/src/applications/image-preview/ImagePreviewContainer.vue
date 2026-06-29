<script setup lang="ts">
import { ref, shallowRef, markRaw, onMounted, onUnmounted, watch } from 'vue'
import { ImagePreviewController } from './ImagePreviewController'
import { useThemeStore } from '@/stores/themeStore'

const emit = defineEmits<{
  ready: [preview: ImagePreviewController]
}>()

const themeStore = useThemeStore()
const containerRef = ref<HTMLDivElement | null>(null)
const preview = shallowRef<ImagePreviewController | null>(null)

function initPreview(): void {
  if (!containerRef.value) return

  const controller = markRaw(new ImagePreviewController({ theme: themeStore.themeName }))
  controller.init(containerRef.value)
  preview.value = controller
  emit('ready', controller)
}

function destroyPreview(): void {
  preview.value?.destroy()
  preview.value = null
}

watch(
  () => themeStore.themeName,
  (newTheme) => {
    preview.value?.setTheme(newTheme)
  },
)

onMounted(() => {
  containerRef.value?.addEventListener('contextmenu', preventContextMenu, { passive: false })
  initPreview()
})

onUnmounted(() => {
  containerRef.value?.removeEventListener('contextmenu', preventContextMenu)
  destroyPreview()
})

function preventContextMenu(event: Event): void {
  event.preventDefault()
}

defineExpose({
  preview,
})
</script>

<template>
  <div ref="containerRef" class="image-preview-container" />
</template>

<style scoped>
.image-preview-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--bg-secondary, #1a1a2e);
}
</style>
