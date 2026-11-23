<template>
  <div
    v-if="status"
    class="chip-viewer-opening-status"
    :class="`is-${status.phase}`"
    :role="status.phase === 'started' ? 'status' : undefined"
  >
    <div class="chip-viewer-opening-status__copy">
      <i
        :class="status.phase === 'started' ? 'ri-checkbox-circle-line' : 'ri-cpu-line'"
        aria-hidden="true"
      />
      <div>
        <strong>{{ status.message }}</strong>
        <small v-if="status.detail">{{ status.detail }}</small>
      </div>
    </div>
    <progress
      v-if="status.phase === 'opening'"
      class="chip-viewer-opening-status__progress"
      :aria-label="status.message"
    />
  </div>
</template>

<script setup lang="ts">
import { useChipViewerOpeningStatus } from '@/composables/chipViewerOpeningStatus'

const status = useChipViewerOpeningStatus()
</script>

<style scoped>
.chip-viewer-opening-status {
  position: fixed;
  z-index: 1200;
  inset-block-start: 54px;
  inset-inline-start: 50%;
  display: grid;
  width: min(380px, calc(100vw - 24px));
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--text-primary) 16%, transparent);
  color: var(--text-primary);
  pointer-events: none;
  transform: translateX(-50%);
}

.chip-viewer-opening-status__copy {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 9px;
}

.chip-viewer-opening-status__copy > i {
  flex: 0 0 auto;
  padding-block-start: 1px;
  color: var(--accent-color);
  font-size: 16px;
}

.chip-viewer-opening-status__copy > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.chip-viewer-opening-status strong {
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.chip-viewer-opening-status small {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 1.35;
}

.chip-viewer-opening-status__progress {
  display: block;
  width: 100%;
  height: 3px;
  appearance: none;
  border: 0;
  border-radius: 2px;
  background: var(--surface-border, var(--border-color));
  color: var(--accent-color);
}

.chip-viewer-opening-status__progress::-webkit-progress-bar {
  border-radius: 2px;
  background: var(--surface-border, var(--border-color));
}

.chip-viewer-opening-status__progress::-webkit-progress-value {
  border-radius: 2px;
  background: var(--accent-color);
}

.chip-viewer-opening-status__progress::-moz-progress-bar {
  border-radius: 2px;
  background: var(--accent-color);
}
</style>
