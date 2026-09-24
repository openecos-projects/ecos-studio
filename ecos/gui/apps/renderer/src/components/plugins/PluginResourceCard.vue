<template>
  <div class="plugin-card" :style="{ '--row-accent': row.accent }">
    <div class="plugin-card-row">
      <span class="resource-avatar">{{ row.icon }}</span>

      <div class="plugin-card-main">
        <span class="plugin-card-title">
          <strong :title="row.name">{{ row.name }}</strong>
          <small :title="metaText">{{ metaText }}</small>
        </span>
        <p
          v-if="row.description"
          class="plugin-card-description"
          :title="row.descriptionTitle || undefined"
        >
          {{ row.description }}
        </p>
        <div v-if="row.flowTags.length || row.dependencyLabel" class="plugin-card-tags">
          <span v-if="row.flowTags.length" class="resource-flow-tags">
            <b v-for="tag in row.flowTags.slice(0, 4)" :key="tag">{{ tag }}</b>
          </span>
          <span v-if="row.dependencyLabel" class="resource-dependency">
            <i class="ri-node-tree" aria-hidden="true"></i>
            <span>{{ row.dependencyLabel }}</span>
          </span>
        </div>
      </div>

      <div class="plugin-card-side">
        <b
          class="status-pill"
          :class="row.statusKind"
          :title="row.statusTitle || undefined"
        >
          <span>{{ row.statusText }}</span>
        </b>
        <span
          v-if="row.progressPercent !== null"
          class="mini-progress"
          role="progressbar"
          :style="{ '--progress': row.progressPercent / 100 }"
          :aria-valuenow="row.progressPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${row.name} installation progress`"
        >
          <span></span>
        </span>
        <span class="plugin-card-actions">
          <button
            v-if="homepageUrl"
            type="button"
            class="row-action-btn icon-only info"
            data-title="Homepage"
            aria-label="Open homepage"
            @click.stop="emit('homepage')"
          >
            <i class="ri-external-link-line" aria-hidden="true"></i>
          </button>
          <button
            v-for="action in actions"
            :key="action.id"
            type="button"
            class="row-action-btn"
            :class="[action.tone, { 'icon-only': action.iconOnly }]"
            :data-title="action.iconOnly ? action.label : undefined"
            :aria-label="action.iconOnly ? action.label : undefined"
            :disabled="action.disabled"
            @click.stop="emit('action', action.id)"
          >
            <i :class="action.icon" aria-hidden="true"></i>
            <span v-if="!action.iconOnly">{{ action.label }}</span>
          </button>
        </span>
      </div>
    </div>

    <!-- Slot for future notices (e.g. dependency conflicts). -->
    <slot name="notice"></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ResourceRow } from '@/views/pluginToolsRows'
import {
  cardActionsForRow,
  cardMetaText,
  homepageUrlFor,
} from '@/views/pluginResourceCards'
import type { PluginCardActionId } from '@/views/pluginResourceCards'

const props = defineProps<{
  row: ResourceRow
  importing: boolean
}>()

const emit = defineEmits<{
  action: [id: PluginCardActionId]
  homepage: []
}>()

const actions = computed(() =>
  cardActionsForRow(props.row, { importing: props.importing }),
)
const metaText = computed(() => cardMetaText(props.row))
const homepageUrl = computed(() => homepageUrlFor(props.row))
</script>

<style scoped>
.plugin-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
  transition: border-color 0.15s ease;
}

.plugin-card:hover {
  border-color: color-mix(in srgb, var(--accent-color) 36%, var(--border-color));
}

.plugin-card-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
}

.resource-avatar {
  display: grid;
  width: 32px;
  height: 32px;
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
  flex: 0 0 auto;
}

.plugin-card-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.plugin-card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.plugin-card-title strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
}

.plugin-card-title small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
}

.plugin-card-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.plugin-card-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 7px;
}

.resource-flow-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.resource-flow-tags b {
  min-height: 18px;
  padding: 2px 5px;
  border-radius: 5px;
  line-height: 1.2;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 11%, transparent);
  font-size: 10px;
  font-weight: 700;
}

.resource-dependency {
  display: flex;
  align-items: center;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 10px;
  gap: 4px;
}

.resource-dependency i {
  flex: 0 0 auto;
  color: var(--accent-color);
  font-size: 12px;
}

.resource-dependency span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-card-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding-top: 2px;
}

/* ---- Pills ---- */
.status-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill.installed {
  color: var(--success-color);
  background: var(--success-bg);
}

.status-pill.available {
  color: var(--text-secondary);
  background: var(--bg-secondary);
}

.status-pill.update {
  color: var(--info-color);
  background: var(--info-bg);
}

.status-pill.installing {
  font-size: 10px;
  font-weight: 700;
  padding: 0 7px;
  color: var(--info-color);
  background: var(--info-bg);
}

.status-pill.error {
  color: var(--danger-color);
  background: var(--danger-bg);
}

.mini-progress {
  --progress: 0;
  display: block;
  position: relative;
  width: 62px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--info-color) 16%, var(--bg-secondary));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--info-color) 10%, transparent);
}

.mini-progress span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--info-color),
    color-mix(in srgb, var(--info-color) 70%, var(--accent-text))
  );
  box-shadow: 0 0 10px color-mix(in srgb, var(--info-color) 34%, transparent);
  transform: scaleX(var(--progress, 0));
  transform-origin: left center;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

/* ---- Card actions ---- */
.plugin-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
}

.row-action-btn.icon-only {
  width: 26px;
  padding: 0;
  font-size: 13px;
}

/* ---- Custom tooltip ---- */
.row-action-btn[data-title] {
  position: relative;
}

.row-action-btn[data-title]::after {
  content: attr(data-title);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) scale(0.96);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.row-action-btn[data-title]::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%) scale(0.96);
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid var(--border-color);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
  z-index: 10;
}

.row-action-btn[data-title]:not(:disabled):hover::after,
.row-action-btn[data-title]:not(:disabled):hover::before {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.row-action-btn.primary {
  color: var(--accent-text);
  background: var(--accent-color);
}

.row-action-btn.primary:not(:disabled):hover {
  opacity: 0.9;
}

.row-action-btn.danger-outlined {
  color: var(--danger-color);
  background: transparent;
  border: 1px solid var(--danger-color);
}

.row-action-btn.danger-outlined:not(:disabled):hover {
  background: var(--danger-bg);
}

.row-action-btn.info {
  color: var(--info-color);
  background: var(--info-bg);
}

.row-action-btn.info:not(:disabled):hover {
  opacity: 0.85;
}

.row-action-btn:disabled {
  cursor: default;
  opacity: 0.65;
}

.row-action-btn.danger {
  color: var(--danger-color);
  background: var(--danger-bg);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
