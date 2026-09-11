<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div
        v-if="view"
        class="info-html-lightbox-overlay"
        tabindex="-1"
        @click="emit('close')"
        @wheel.self.prevent.stop
      >
        <div class="info-html-lightbox-content" @click.stop>
          <div class="info-html-lightbox-header">
            <span class="info-html-lightbox-title">{{ view.title }}</span>
            <button
              type="button"
              class="info-html-lightbox-close"
              aria-label="Close"
              @click="emit('close')"
            >
              <i class="ri-close-line"></i>
            </button>
          </div>
          <div
            class="info-html-lightbox-body"
            :class="{ 'info-html-lightbox-body--image': view.mode === 'image' }"
            tabindex="0"
            @wheel.stop
          >
            <div v-if="view.mode === 'image'" class="info-image-lightbox-wrapper">
              <img :src="view.body" :alt="view.title" class="info-image-lightbox-img" />
            </div>
            <div
              v-else-if="view.mode === 'html'"
              class="info-html-lightbox-inner markdown-body"
              v-html="view.body"
            ></div>
            <pre
              v-else
              class="info-report-lightbox-pre"
            ><code>{{ view.body }}</code></pre>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import type { ChatArtifactLightboxView } from './chatArtifactLightbox'

const props = defineProps<{
  view: ChatArtifactLightboxView | null
}>()

const emit = defineEmits<{ close: [] }>()

function setDocumentScrollLock(locked: boolean): void {
  const overflow = locked ? 'hidden' : ''
  document.documentElement.style.overflow = overflow
  document.body.style.overflow = overflow
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.view) {
    emit('close')
    event.preventDefault()
    event.stopPropagation()
  }
}

watch(
  () => props.view,
  (view) => {
    setDocumentScrollLock(view !== null)
  },
  { immediate: true },
)

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  setDocumentScrollLock(false)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<style scoped>
.info-html-lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 30000;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 16px;
  overflow: hidden;
  overscroll-behavior: none;
  background: rgba(0, 0, 0, 0.72);
  box-sizing: border-box;
}

.info-html-lightbox-content {
  width: min(98vw, 1760px);
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}

.info-html-lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.info-html-lightbox-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-html-lightbox-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.info-html-lightbox-close:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.info-html-lightbox-body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  background: var(--bg-primary);
  overflow: auto;
  overscroll-behavior: contain;
}

.info-html-lightbox-body--image {
  padding: 0;
  background: #0b0b0f;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.info-image-lightbox-wrapper {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.info-image-lightbox-img {
  max-width: min(96vw, 1720px);
  max-height: min(calc(92vh - 52px), 900px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.info-html-lightbox-inner {
  min-width: 0;
  font-size: 18px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  color: var(--text-primary);
}

.info-html-lightbox-inner :deep(pre) {
  font-size: inherit;
}

.info-report-lightbox-pre {
  display: block;
  width: max-content;
  min-width: 100%;
  margin: 0;
  padding: 0;
  font-size: 18px;
  line-height: 1.45;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  color: var(--text-primary);
}

.info-report-lightbox-pre code {
  font-size: inherit;
  font-family: inherit;
}

.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.2s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.lightbox-enter-active .info-html-lightbox-content,
.lightbox-leave-active .info-html-lightbox-content {
  transition: transform 0.2s ease;
}

.lightbox-enter-from .info-html-lightbox-content,
.lightbox-leave-to .info-html-lightbox-content {
  transform: scale(0.96);
}
</style>
