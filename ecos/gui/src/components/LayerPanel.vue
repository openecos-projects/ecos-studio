<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import type { LayerManagerPlugin, LayerPanelItem } from '@/applications/editor/plugins/LayerManagerPlugin'
import type { LayerTexturePattern } from '@/applications/editor/layout/LayerStyleManager'

interface Props {
  layerManager: LayerManagerPlugin | null
}

const props = defineProps<Props>()

const layers = ref<LayerPanelItem[]>([])
let unlisten: (() => void) | null = null

function refresh() {
  if (props.layerManager) {
    layers.value = props.layerManager.getLayerItems()
  }
}

watch(() => props.layerManager, (mgr) => {
  if (unlisten) { unlisten(); unlisten = null }
  if (mgr) {
    unlisten = mgr.onChange(() => refresh())
    refresh()
  }
}, { immediate: true })

onUnmounted(() => {
  if (unlisten) unlisten()
})

const toggleLayer = (id: number) => {
  props.layerManager?.toggleLayer(id)
}

const showAll = () => {
  props.layerManager?.showAllLayers()
}

const hideAll = () => {
  props.layerManager?.hideAllLayers()
}

const setAlpha = (id: number, value: number) => {
  props.layerManager?.setLayerAlpha(id, value / 100)
}

function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0')
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

const onColorChange = (id: number, event: Event) => {
  const target = event.target as HTMLInputElement
  props.layerManager?.setLayerColor(id, hexToNumber(target.value))
}

const texturePatterns: Array<{ value: LayerTexturePattern, label: string }> = [
  { value: 'diagonal', label: 'Diag' },
  { value: 'cross', label: 'Cross' },
  { value: 'dot', label: 'Dot' },
  { value: 'grid', label: 'Grid' },
]

const onFillModeChange = (id: number, enabled: boolean) => {
  props.layerManager?.setLayerFillMode(id, enabled ? 'texture' : 'solid')
}

const onTexturePatternChange = (id: number, event: Event) => {
  const target = event.target as HTMLSelectElement
  props.layerManager?.setLayerTexturePattern(id, target.value as LayerTexturePattern)
}

const onTextureScaleChange = (id: number, event: Event) => {
  const target = event.target as HTMLInputElement
  props.layerManager?.setLayerTextureScale(id, Number(target.value) / 100)
}

const onTextureAngleChange = (id: number, event: Event) => {
  const target = event.target as HTMLInputElement
  props.layerManager?.setLayerTextureAngle(id, Number(target.value))
}
</script>

<template>
  <div class="layer-panel">
    <div class="panel-header">
      <div class="flex items-center gap-1.5">
        <i class="ri-stack-line"></i>
        <span>Layers</span>
      </div>
      <div class="flex items-center gap-1">
        <button @click="showAll" class="header-btn" title="Show All">
          <i class="ri-eye-line text-xs"></i>
        </button>
        <button @click="hideAll" class="header-btn" title="Hide All">
          <i class="ri-eye-off-line text-xs"></i>
        </button>
      </div>
    </div>

    <div class="layer-list">
      <div v-for="layer in layers" :key="layer.id" class="layer-item" :class="{ disabled: !layer.hasData }">
        <div class="layer-item-main">
          <button
            class="vis-toggle"
            :class="{ visible: layer.visible && layer.hasData }"
            :disabled="!layer.hasData"
            @click="toggleLayer(layer.id)"
          >
            <i :class="layer.visible && layer.hasData ? 'ri-eye-line' : 'ri-eye-off-line'" class="text-xs"></i>
          </button>

          <input
            v-if="layer.hasData"
            type="color"
            :value="colorToHex(layer.fillColor)"
            @change="onColorChange(layer.id, $event)"
            class="color-swatch"
            :title="`${layer.name} color`"
          />
          <div v-else class="color-swatch-placeholder"></div>

          <span class="layer-name" :class="{ 'text-muted': !layer.hasData }">{{ layer.name }}</span>
          <span class="layer-id">{{ layer.id }}</span>

          <input
            v-if="layer.hasData"
            type="range"
            min="0"
            max="100"
            :value="Math.round(layer.fillAlpha * 100)"
            @input="setAlpha(layer.id, Number(($event.target as HTMLInputElement).value))"
            class="alpha-slider"
            :title="`Opacity: ${Math.round(layer.fillAlpha * 100)}%`"
          />
          <span v-else class="no-data-label">no data</span>
        </div>

        <div v-if="layer.hasData" class="texture-row">
          <label class="texture-toggle">
            <input
              type="checkbox"
              :checked="layer.fillMode === 'texture'"
              @change="onFillModeChange(layer.id, ($event.target as HTMLInputElement).checked)"
            />
            <span>Texture</span>
          </label>

          <select
            class="texture-select"
            :disabled="layer.fillMode !== 'texture'"
            :value="layer.texturePattern"
            @change="onTexturePatternChange(layer.id, $event)"
          >
            <option v-for="item in texturePatterns" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>

          <input
            class="texture-slider"
            type="range"
            min="20"
            max="300"
            :disabled="layer.fillMode !== 'texture'"
            :value="Math.round(layer.textureScale * 100)"
            @input="onTextureScaleChange(layer.id, $event)"
            :title="`Scale: ${layer.textureScale.toFixed(2)}x`"
          />

          <input
            class="texture-angle"
            type="number"
            min="0"
            max="360"
            :disabled="layer.fillMode !== 'texture'"
            :value="Math.round(layer.textureAngle)"
            @input="onTextureAngleChange(layer.id, $event)"
            title="Texture angle"
          />
        </div>
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

.header-btn {
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--text-secondary);
  transition: all 0.15s;
}
.header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.layer-list {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.layer-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px 10px;
  transition: background 0.1s;
}

.layer-item-main {
  display: flex;
  align-items: center;
  gap: 6px;
}
.layer-item:hover:not(.disabled) {
  background: var(--bg-hover);
}
.layer-item.disabled {
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
  transition: all 0.15s;
}
.vis-toggle:not(:disabled):hover {
  background: var(--bg-hover);
}
.vis-toggle.visible {
  color: var(--accent-color);
}

.color-swatch {
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-color);
  border-radius: 2px;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  -webkit-appearance: none;
  appearance: none;
}
.color-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.color-swatch::-webkit-color-swatch { border: none; border-radius: 1px; }

.color-swatch-placeholder {
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-color);
  border-radius: 2px;
  background: var(--bg-primary);
  flex-shrink: 0;
  opacity: 0.3;
}

.layer-name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
}
.layer-name.text-muted {
  color: var(--text-tertiary, #555);
}

.layer-id {
  color: var(--text-tertiary, #555);
  font-size: 10px;
  width: 18px;
  text-align: right;
  flex-shrink: 0;
}

.alpha-slider {
  width: 48px;
  height: 4px;
  flex-shrink: 0;
  accent-color: var(--accent-color);
  cursor: pointer;
}

.no-data-label {
  color: var(--text-tertiary, #555);
  font-size: 10px;
  font-style: italic;
  white-space: nowrap;
}

.texture-row {
  display: grid;
  grid-template-columns: auto 1fr 1fr 52px;
  gap: 6px;
  align-items: center;
  padding-left: 28px;
}

.texture-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary);
}

.texture-select {
  height: 22px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 10px;
  padding: 0 6px;
}

.texture-slider {
  height: 4px;
  accent-color: var(--accent-color);
}

.texture-angle {
  width: 52px;
  height: 22px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 10px;
  padding: 0 4px;
}
</style>
