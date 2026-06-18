<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutState } from '@/composables/useLayoutState'
import {
  getViewJsonDisplayModeLabel,
  type ViewJsonDisplayPreset,
  type ViewJsonObjectDisplayMode,
} from '@/applications/editor/view-json/displayPolicy'

const layoutState = useLayoutState()

const layers = computed(() => layoutState.tileLayers.value)
const actions = computed(() => layoutState.tileLayerActions.value)
const objectKinds = computed(() => layoutState.tileObjectKinds.value)
const objectKindActions = computed(() => layoutState.tileObjectKindActions.value)
const displayPreset = computed(() => layoutState.viewJsonDisplayPreset.value)
const displayPresetActions = computed(() => layoutState.viewJsonDisplayPresetActions.value)
const displayPresets: Array<{ key: ViewJsonDisplayPreset; label: string }> = [
  { key: 'engineering', label: 'Eng' },
  { key: 'floorplan', label: 'Floor' },
  { key: 'placement', label: 'Place' },
  { key: 'routing', label: 'Route' },
  { key: 'power', label: 'PG' },
  { key: 'debug', label: 'Debug' },
]

const visibleCount = computed(() => layers.value.filter(l => l.visible).length)
const visibleObjectKindCount = computed(() => objectKinds.value.filter(item => item.visible).length)

function toggle(id: number): void {
  actions.value?.toggleLayer(id)
}

function toggleObjectKind(kind: (typeof objectKinds.value)[number]['kind']): void {
  objectKindActions.value?.toggleObjectKind(kind)
}

function showAll(): void {
  actions.value?.showAll()
}

function hideAll(): void {
  actions.value?.hideAll()
}

function showAllObjectKinds(): void {
  objectKindActions.value?.showAll()
}

function hideAllObjectKinds(): void {
  objectKindActions.value?.hideAll()
}

function setDisplayPreset(preset: ViewJsonDisplayPreset): void {
  displayPresetActions.value?.setPreset(preset)
}

function displayModeLabel(mode: ViewJsonObjectDisplayMode): string {
  return getViewJsonDisplayModeLabel(mode)
}

function objectKindVisibilityTitle(item: (typeof objectKinds.value)[number]): string {
  if (!item.userVisible) return 'Hidden manually'
  if (!item.presetVisible) return 'Hidden by display preset'
  return 'Visible'
}
</script>

<template>
  <div class="layer-panel">
    <div class="panel-header">
      <div class="header-left">
        <i class="ri-stack-line"></i>
        <span class="header-en">Layers</span>
        <span v-if="objectKinds.length || layers.length" class="layer-count">
          {{ visibleObjectKindCount + visibleCount }}/{{ objectKinds.length + layers.length }}
        </span>
      </div>
      <div v-if="objectKinds.length || layers.length" class="header-actions">
        <button
          @click="showAllObjectKinds(); showAll()"
          class="header-btn"
          title="Show All"
        >
          <i class="ri-eye-line text-xs"></i>
        </button>
        <button
          @click="hideAllObjectKinds(); hideAll()"
          class="header-btn"
          title="Hide All"
        >
          <i class="ri-eye-off-line text-xs"></i>
        </button>
      </div>
    </div>

    <div v-if="objectKinds.length > 0 || layers.length > 0" class="layer-list">
      <section class="panel-section preset-section">
        <div class="section-header">
          <span>Display Preset</span>
          <span>{{ displayPreset }}</span>
        </div>
        <div class="preset-grid">
          <button
            v-for="preset in displayPresets"
            :key="preset.key"
            class="preset-btn"
            :class="{ active: displayPreset === preset.key }"
            @click="setDisplayPreset(preset.key)"
          >
            {{ preset.label }}
          </button>
        </div>
      </section>

      <section v-if="objectKinds.length > 0" class="panel-section">
        <div class="section-header">
          <span>Object Kinds</span>
          <span>{{ visibleObjectKindCount }}/{{ objectKinds.length }}</span>
        </div>

        <div
          v-for="item in objectKinds"
          :key="item.kind"
          class="layer-item"
          :class="{ hidden: !item.visible, 'preset-hidden': item.userVisible && !item.presetVisible }"
          :title="objectKindVisibilityTitle(item)"
          @click="toggleObjectKind(item.kind)"
        >
          <button
            class="vis-toggle"
            :class="{ visible: item.visible }"
            :title="objectKindVisibilityTitle(item)"
            @click.stop="toggleObjectKind(item.kind)"
          >
            <i :class="item.visible ? 'ri-eye-line' : 'ri-eye-off-line'" class="text-xs"></i>
          </button>

          <div
            class="kind-swatch"
            :style="{
              backgroundColor: item.color,
              opacity: item.visible ? 0.75 : 0.2,
            }"
          ></div>
          <span class="layer-name">{{ item.label }}</span>
          <span class="mode-badge" :class="`mode-${item.displayMode}`">
            {{ displayModeLabel(item.displayMode) }}
          </span>
          <span class="item-count">{{ item.count.toLocaleString() }}</span>
        </div>
      </section>

      <section v-if="layers.length > 0" class="panel-section">
        <div class="section-header">
          <span>Process Layers</span>
          <span>{{ visibleCount }}/{{ layers.length }}</span>
        </div>

        <div
          v-for="layer in layers"
          :key="layer.id"
          class="layer-item"
          :class="{ hidden: !layer.visible }"
          @click="toggle(layer.id)"
        >
          <button
            class="vis-toggle"
            :class="{ visible: layer.visible }"
            @click.stop="toggle(layer.id)"
          >
            <i :class="layer.visible ? 'ri-eye-line' : 'ri-eye-off-line'" class="text-xs"></i>
          </button>

          <div
            class="color-swatch"
            :style="{
              backgroundColor: layer.color,
              opacity: layer.visible ? layer.alpha : 0.2,
            }"
          ></div>

          <span class="layer-name">{{ layer.name }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.header-en {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary, #666);
  text-transform: none;
  letter-spacing: 0;
}

.layer-count {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary, #666);
  text-transform: none;
  letter-spacing: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.header-btn {
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--text-secondary);
  transition: background-color 0.15s, color 0.15s;
}
.header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.empty-state {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-tertiary, #666);
  font-size: 12px;
}

.layer-list {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.panel-section {
  padding: 2px 0 8px;
}

.preset-section {
  border-bottom: 1px solid var(--border-color);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px 10px 8px;
}

.preset-btn {
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 11px;
  font-weight: 600;
}
.preset-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.preset-btn.active {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px 4px;
  color: var(--text-tertiary, #666);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;
}
.layer-item:hover {
  background: var(--bg-hover);
}
.layer-item.hidden {
  opacity: 0.45;
}
.layer-item.preset-hidden {
  opacity: 0.55;
}
.layer-item.preset-hidden .mode-badge {
  border-style: dashed;
}

.vis-toggle {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: background-color 0.15s, color 0.15s;
}
.vis-toggle:hover {
  background: var(--bg-hover);
}
.vis-toggle.visible {
  color: var(--accent-color);
}

.color-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.kind-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.layer-name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.3px;
}

.item-count {
  color: var(--text-tertiary, #666);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10px;
}

.mode-badge {
  width: 28px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1px solid var(--border-color);
  color: var(--text-tertiary, #666);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}
.mode-overview,
.mode-outline {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}
.mode-detail {
  color: var(--text-secondary);
}
.mode-deferred {
  color: #b7791f;
  border-color: color-mix(in srgb, #b7791f 45%, var(--border-color));
}
.mode-hidden {
  opacity: 0.55;
}

.layer-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--text-tertiary, #555);
  flex-shrink: 0;
  transition: color 0.15s, background-color 0.15s;
}

.expand-btn {
  width: 18px;
  height: 18px;
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.expand-btn:hover {
  color: var(--text-primary);
}
.expand-btn.expanded {
  transform: rotate(180deg);
}

.pattern-controls {
  padding: 4px 10px 8px 44px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ctrl-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ctrl-label {
  width: 48px;
  font-size: 10px;
  width: 28px;
  text-align: right;
}

.layer-zorder {
  color: var(--text-tertiary, #555);
  font-size: 10px;
  width: 22px;
  text-align: right;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
</style>
