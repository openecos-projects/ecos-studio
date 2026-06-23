<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutState } from '@/composables/useLayoutState'

const layoutState = useLayoutState()

const layers = computed(() => layoutState.tileLayers.value)
const actions = computed(() => layoutState.tileLayerActions.value)

const visibleCount = computed(() => layers.value.filter(l => l.visible).length)

function toggle(id: number): void {
  actions.value?.toggleLayer(id)
}

function showAll(): void {
  actions.value?.showAll()
}

function hideAll(): void {
  actions.value?.hideAll()
}
</script>

<template>
  <div class="layer-panel">
    <div class="panel-header">
      <div class="header-left">
        <i class="ri-stack-line"></i>
        <span class="header-en">Layers</span>
        <span v-if="layers.length" class="layer-count">{{ visibleCount }}/{{ layers.length }}</span>
      </div>
      <div v-if="layers.length > 0" class="header-actions">
        <button @click="showAll" class="header-btn" title="Show All">
          <i class="ri-eye-line text-xs"></i>
        </button>
        <button @click="hideAll" class="header-btn" title="Hide All">
          <i class="ri-eye-off-line text-xs"></i>
        </button>
      </div>
    </div>

    <div v-if="layers.length > 0" class="layer-list">
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

.layer-name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.3px;
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
