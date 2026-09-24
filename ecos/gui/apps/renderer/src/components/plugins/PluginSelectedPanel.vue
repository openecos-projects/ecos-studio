<template>
  <aside class="selected-panel" aria-label="Selected resources">
    <h2>
      Selected Resources <span>({{ rows.length }})</span>
    </h2>

    <div class="selected-list">
      <div v-if="rows.length === 0" class="selected-empty">
        <i class="ri-checkbox-multiple-line" aria-hidden="true"></i>
        <span>No resources selected</span>
        <small
          >Select resources with the checkboxes to include them in batch
          operations.</small
        >
      </div>

      <div
        v-for="row in rows"
        :key="row.id"
        class="selected-item"
        :style="{ '--row-accent': row.accent }"
      >
        <span class="resource-avatar compact">{{ row.icon }}</span>
        <span class="selected-item-body">
          <strong>{{ row.name }}</strong>
          <small class="selected-item-meta" :title="resolveRowInstallPath(row)">
            <span>{{ selectedResourceMetaText(row) }}</span>
          </small>
          <span v-if="row.flowTags.length" class="selected-flow-tags">
            {{ row.flowTags.slice(0, 3).join(' / ') }}
          </span>
          <span v-if="row.missingRequires.length" class="selected-flow-tags dependency">
            +{{ row.missingRequires.length }} required
          </span>
        </span>
        <em>{{ row.sizeLabel }}</em>
        <button
          type="button"
          aria-label="Remove selected resource"
          @click.stop="emit('remove', row.id)"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="total-size">
      <span>Estimated Total Size</span>
      <strong>{{ totalSizeText }}</strong>
    </div>

    <p class="manager-note">
      <i class="ri-information-line" aria-hidden="true"></i>
      Updates apply to managed installs. Replace switches a local tool to the
      registry-managed version without deleting the original local directory.
    </p>

    <div class="selected-actions">
      <button
        type="button"
        class="download-button"
        :disabled="downloadDisabled"
        @click="emit('download')"
      >
        <i class="ri-download-line" aria-hidden="true"></i>
        <span>
          Download
          <small>{{ totalSizeText }}</small>
        </span>
      </button>
      <button type="button" class="cancel-button" @click="emit('cancel')">Cancel</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { resolveRowInstallPath, selectedResourceMetaText } from '@/views/pluginToolsRows'
import type { ResourceRow } from '@/views/pluginToolsRows'

defineProps<{
  rows: ResourceRow[]
  totalSizeText: string
  downloadDisabled: boolean
}>()

const emit = defineEmits<{
  remove: [id: string]
  download: []
  cancel: []
}>()
</script>

<style scoped>
.selected-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 16px 16px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.selected-panel h2 {
  margin: 0 0 16px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 750;
}

.selected-panel h2 span {
  color: var(--text-secondary);
  font-weight: 650;
}

.selected-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 0;
  overflow: auto;
  min-height: 0;
}

.selected-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  gap: 6px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
  padding: 16px;
}

.selected-empty i {
  font-size: 28px;
  opacity: 0.35;
}

.selected-empty small {
  font-size: 11px;
  opacity: 0.7;
  max-width: 180px;
}

.selected-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 0;
}

.resource-avatar {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: #fff;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--row-accent) 92%, white),
    color-mix(in srgb, var(--row-accent) 76%, black)
  );
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.35),
    0 6px 14px rgba(15, 23, 42, 0.12);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

.resource-avatar.compact {
  width: 34px;
  height: 34px;
}

.selected-item-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.selected-item strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-item-meta {
  display: block;
  overflow: hidden;
  max-width: 260px;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-flow-tags {
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  padding: 2px 5px;
  border-radius: 5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 11%, transparent);
  font-size: 10px;
  font-weight: 700;
}

.selected-flow-tags.dependency {
  color: var(--info-color);
  background: var(--info-bg);
}

.selected-item em {
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
  margin-top: 2px;
}

.selected-item button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.selected-item button:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

.total-size {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px -16px 0;
  padding: 16px;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 13px;
}

.total-size span {
  color: var(--text-secondary);
  font-weight: 650;
}

.total-size strong {
  font-size: 14px;
  font-weight: 800;
}

.manager-note {
  display: grid;
  grid-template-columns: 20px 1fr;
  align-items: start;
  gap: 10px;
  margin-top: 12px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  color: color-mix(in srgb, var(--text-primary) 50%, transparent);
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  font-size: 12px;
  line-height: 1.45;
}

.manager-note i {
  color: var(--accent-color);
  font-size: 16px;
}

.selected-actions {
  display: grid;
  gap: 10px;
  flex: 0 0 auto;
  margin-top: auto;
}

.download-button,
.cancel-button {
  width: 100%;
  min-height: 50px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 750;
}

.download-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  color: var(--accent-text);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-color) 85%, white),
    var(--accent-color)
  );
}

.download-button:disabled {
  cursor: default;
  opacity: 0.5;
}

.download-button i {
  position: absolute;
  left: 14px;
  font-size: 16px;
}

.download-button span {
  display: grid;
  gap: 1px;
  font-size: 13px;
}

.download-button small {
  font-size: 10px;
  font-weight: 750;
  opacity: 0.9;
}

.cancel-button {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 13px;
  transition: background 0.15s ease;
}

.cancel-button:hover {
  background: var(--bg-secondary);
}

:global(.dark) .selected-empty {
  border-color: color-mix(in srgb, var(--border-color) 60%, transparent);
}

@media (max-width: 1240px) {
  .selected-panel {
    flex: 0 0 auto;
    min-height: 220px;
    max-height: none;
  }

  .selected-list {
    max-height: 120px;
  }
}
</style>
