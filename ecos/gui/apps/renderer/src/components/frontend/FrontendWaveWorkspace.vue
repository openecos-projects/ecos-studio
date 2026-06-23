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

<style scoped>
.frontend-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.wave-workspace-clean {
  gap: 0;
  padding: 0;
}

.wave-workspace-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.wave-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.wave-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.wave-row:hover,
.wave-row.active {
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.3);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.wave-row i {
  flex-shrink: 0;
  color: var(--accent-color);
  font-size: 16px;
}

.wave-row span {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.wave-row strong,
.wave-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wave-row strong {
  font-size: 12px;
}

.wave-row small {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.wave-viewer-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.wave-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.wave-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.wave-title > i {
  flex-shrink: 0;
  color: var(--accent-color);
  font-size: 18px;
}

.wave-title div {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.wave-title strong,
.wave-title span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wave-title strong {
  font-size: 12px;
}

.wave-title span {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.text-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
  cursor: pointer;
}

.surfer-shell {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  background: #111827;
}

.wave-surfer-shell {
  min-height: 0;
}

.surfer-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: #111827;
}

.wave-status {
  position: absolute;
  inset: 12px auto auto 12px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: min(520px, calc(100% - 24px));
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
}

.wave-status.error {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.35);
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  padding: 20px;
  color: var(--text-secondary);
}

.empty-panel.compact {
  min-height: 80px;
  font-size: 11px;
}

.wave-empty {
  height: 100%;
  border: 0;
  border-radius: 0;
}

@media (max-width: 1180px) {
  .wave-workspace-layout {
    grid-template-columns: 1fr;
  }
}
</style>
