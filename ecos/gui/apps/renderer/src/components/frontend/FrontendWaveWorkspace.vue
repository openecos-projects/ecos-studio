<template>
  <div class="frontend-workspace wave-workspace-clean">
    <section class="wave-workspace-layout">
      <aside class="wave-list">
        <button
          v-for="item in waveItems"
          :key="item.path"
          type="button"
          class="wave-row"
          :class="{ active: activeWaveform?.path === item.path }"
          :title="item.path"
          @click="$emit('select-waveform', item)"
        >
          <i class="ri-pulse-line"></i>
          <span>
            <strong>{{ item.caseName || fileName(item.path) }}</strong>
            <small>{{ shortPath(item.path) }}</small>
          </span>
        </button>
        <div v-if="waveItems.length === 0" class="empty-panel compact">
          <i class="ri-pulse-line"></i>
          <span>No waveform files found.</span>
        </div>
      </aside>

      <section class="wave-viewer-panel">
        <div v-if="activeWaveform" class="wave-header">
          <div class="wave-title">
            <i class="ri-pulse-line"></i>
            <div>
              <strong>{{ activeWaveform.caseName || fileName(activeWaveform.path) || 'Waveform' }}</strong>
              <span :title="activeWaveform.path">{{ activeWaveform.path }}</span>
            </div>
          </div>
          <button
            type="button"
            class="text-action"
            @click="$emit('open-wave-external', activeWaveform.path)"
          >
            <i class="ri-external-link-line"></i>
            Open
          </button>
        </div>
        <div v-if="activeWaveform" class="surfer-shell wave-surfer-shell">
          <iframe
            ref="frameRef"
            class="surfer-frame"
            title="Surfer waveform viewer"
            :src="surferViewerUrl"
            @load="$emit('frame-load')"
          ></iframe>
          <div v-if="waveStatusMessage" class="wave-status" :class="{ error: waveformError }">
            <i :class="waveformError ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin'"></i>
            <span>{{ waveStatusMessage }}</span>
          </div>
        </div>
        <div v-else class="empty-panel wave-empty">
          <i class="ri-pulse-line"></i>
          <span>Select a waveform from Wave.</span>
        </div>
      </section>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

interface WaveSelection {
  path: string
  caseName?: string
}

const props = defineProps<{
  activeWaveform: WaveSelection | null
  surferViewerUrl: string
  waveItems: WaveSelection[]
  waveStatusMessage: string
  waveformError: string
  fileName: (path: string) => string
  shortPath: (path: string) => string
}>()

const emit = defineEmits<{
  (event: 'frame-load'): void
  (event: 'frame-change', frame: HTMLIFrameElement | null): void
  (event: 'open-wave-external', path: string): void
  (event: 'select-waveform', item: WaveSelection): void
}>()

const frameRef = ref<HTMLIFrameElement | null>(null)
const waveformError = computed(() => Boolean(props.waveformError))

watch(frameRef, (frame) => {
  emit('frame-change', frame)
})

onBeforeUnmount(() => {
  emit('frame-change', null)
})
</script>
