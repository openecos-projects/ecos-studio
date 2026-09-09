<template>
  <div class="setting-item-row">
    <div class="setting-info">
      <div class="setting-title">
        <span>{{ entry.descriptor.title }}</span>
        <span v-if="statusKind === 'pending'" class="status-badge pending">Pending</span>
      </div>
      <div class="setting-description">{{ entry.descriptor.description }}</div>
      <div
        class="setting-status"
        :class="writeError ? 'status-error' : `status-${statusKind}`"
      >
        <template v-if="validating">Validating…</template>
        <template v-else-if="writeError">✗ {{ writeError }}</template>
        <template v-else-if="statusKind === 'pending'">
          Applies after running flows finish (next sidecar start)
        </template>
        <template v-else-if="statusKind === 'error'">✗ {{ statusError }}</template>
        <template v-else-if="statusDisplayInfo">✓ {{ statusDisplayInfo }}</template>
        <template v-else-if="entry.isDefault">Using default resolution</template>
      </div>
    </div>
    <div class="setting-editor">
      <component
        :is="editorComponent"
        :entry="entry"
        @commit="onCommit"
        @error="(message: string) => emit('error', message)"
      />
      <button
        v-if="!entry.isDefault"
        class="reset-btn"
        type="button"
        title="Reset to default"
        @click="emit('reset')"
      >
        Reset
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DesktopSettingState } from '@ecos-studio/shared'
import PathSettingInput from './PathSettingInput.vue'
import PdkInstallationSelect from './PdkInstallationSelect.vue'

const props = defineProps<{
  entry: DesktopSettingState
  validating?: boolean
  /** Error from the last rejected write (main does not broadcast rejections). */
  writeError?: string
}>()

const emit = defineEmits<{
  (e: 'commit', value: string): void
  (e: 'error', message: string): void
  (e: 'reset'): void
}>()

const editorComponent = computed(() =>
  props.entry.descriptor.valueType === 'pdkInstallation'
    ? PdkInstallationSelect
    : PathSettingInput,
)

const statusKind = computed(() => props.entry.status.kind)
const statusDisplayInfo = computed(() =>
  props.entry.status.kind === 'ok' ? (props.entry.status.displayInfo ?? '') : '',
)
const statusError = computed(() =>
  props.entry.status.kind === 'error' ? props.entry.status.error : '',
)

function onCommit(value: string): void {
  emit('commit', value)
}
</script>

<style scoped>
.setting-item-row {
  align-items: flex-start;
  border-bottom: 1px solid var(--p-content-border-color, rgba(128, 128, 128, 0.25));
  display: flex;
  gap: 2rem;
  justify-content: space-between;
  padding: 1rem 0;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.setting-title {
  align-items: center;
  display: flex;
  font-weight: 600;
  gap: 0.5rem;
}

.setting-description {
  color: var(--p-text-muted-color, rgba(128, 128, 128, 0.9));
  font-size: 0.85rem;
  max-width: 40rem;
}

.setting-status {
  font-size: 0.8rem;
  margin-top: 0.15rem;
  min-height: 1rem;
}

.setting-status.status-error {
  color: var(--p-red-400, #f87171);
}

.setting-status.status-ok {
  color: var(--p-green-400, #4ade80);
}

.setting-status.status-pending {
  color: var(--p-amber-400, #fbbf24);
}

.status-badge {
  border-radius: 999px;
  font-size: 0.7rem;
  padding: 0.05rem 0.5rem;
  text-transform: uppercase;
}

.status-badge.pending {
  background: var(--p-amber-100, #fef3c7);
  color: var(--p-amber-700, #b45309);
}

.setting-editor {
  align-items: center;
  display: flex;
  flex: 0 1 auto;
  gap: 0.5rem;
}

.reset-btn {
  background: transparent;
  border: 1px solid var(--p-content-border-color, rgba(128, 128, 128, 0.4));
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  padding: 0.35rem 0.7rem;
}

.reset-btn:hover {
  background: var(--p-content-hover-background, rgba(128, 128, 128, 0.12));
}
</style>
