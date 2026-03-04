<script setup lang="ts">
import { reactive, computed } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import { useParameters } from '@/composables/useParameters'

// 从 parameters.json 加载配置参数
const {
  config,
  isLoading,
  isSaving,
  error,
  hasChanges,
  saveParameters,
  resetParameters,
  refreshParameters,
  // 动态选项
  layerOptions,
  directionOptions,
  layersList,
  // 默认值工厂函数
  getDefaultTrack,
  getDefaultPdnIO,
  getDefaultGlobalConnect,
  getDefaultStripe,
  getDefaultConnectLayers
} = useParameters()

const utilizationPercent = computed(() => Math.round(config.core.utilization * 100))
const densityPercent = computed(() => Math.round(config.targetDensity * 100))
const overflowPercent = computed(() => Math.round(config.targetOverflow * 100))

const isLayerInRange = (layer: string): boolean => {
  const layers = layersList.value
  const bottomIndex = layers.indexOf(config.bottomLayer)
  const topIndex = layers.indexOf(config.topLayer)
  const currentIndex = layers.indexOf(layer)
  return currentIndex >= bottomIndex && currentIndex <= topIndex
}

// CRUD
const addTrack = () => config.floorplan.tracks.push(getDefaultTrack())
const removeTrack = (i: number) => config.floorplan.tracks.splice(i, 1)
const addPdnIO = () => config.pdn.io.push(getDefaultPdnIO())
const removePdnIO = (i: number) => config.pdn.io.splice(i, 1)
const addGlobalConnect = () => config.pdn.globalConnect.push(getDefaultGlobalConnect())
const removeGlobalConnect = (i: number) => config.pdn.globalConnect.splice(i, 1)
const addStripe = () => config.pdn.stripe.push(getDefaultStripe())
const removeStripe = (i: number) => config.pdn.stripe.splice(i, 1)
const addConnectLayer = () => config.pdn.connectLayers.push(getDefaultConnectLayers())
const removeConnectLayer = (i: number) => config.pdn.connectLayers.splice(i, 1)

const saveConfig = async () => {
  const success = await saveParameters()
  if (success) {
    console.log('Configuration saved successfully')
  } else {
    console.error('Failed to save configuration')
  }
}

const resetConfig = () => {
  resetParameters()
  console.log('Configuration reset to last saved state')
}

// 展开/折叠状态
const expandedSections = reactive({
  tracks: true,
  pdnIo: true,
  globalConnect: true,
  stripe: true,
  connectLayers: true
})

const toggleSection = (key: keyof typeof expandedSections) => {
  expandedSections[key] = !expandedSections[key]
}
</script>

<template>
  <div class="config-view">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <i class="ri-cpu-line"></i>
        <span class="title">{{ config.design || 'Untitled' }}</span>
        <span v-if="hasChanges" class="unsaved-indicator">*</span>
        <span class="divider">/</span>
        <span class="subtitle">Configuration</span>
        <span v-if="isLoading" class="loading-indicator">
          <i class="ri-loader-4-line spin"></i>
          Loading...
        </span>
        <span v-if="error" class="error-indicator" :title="error">
          <i class="ri-error-warning-line"></i>
        </span>
      </div>
      <div class="topbar-right">
        <button class="btn-text" @click="refreshParameters" :disabled="isLoading">
          <i class="ri-refresh-line"></i>
          Reload
        </button>
        <button class="btn-text" @click="resetConfig" :disabled="!hasChanges || isLoading">
          <i class="ri-arrow-go-back-line"></i>
          Reset
        </button>
        <button class="btn-primary" @click="saveConfig" :disabled="!hasChanges || isSaving">
          <i :class="isSaving ? 'ri-loader-4-line spin' : 'ri-save-line'"></i>
          {{ isSaving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </header>

    <!-- Grid 布局内容 -->
    <main class="content-container">
      <div class="content-grid">
        <!-- 第一行：基础配置 -->
        <section class="card">
          <div class="card-head">
            <i class="ri-cpu-line c-indigo"></i>
            <span>Design</span>
          </div>
          <div class="card-body">
            <div class="field-row">
              <div class="field">
                <label>Name</label>
                <InputText v-model="config.design" size="small" />
              </div>
              <div class="field">
                <label>PDK</label>
                <InputText v-model="config.pdk" size="small" />
              </div>
            </div>
            <div class="field">
              <label>Top Module</label>
              <InputText v-model="config.topModule" size="small" />
            </div>
            <div class="field-row">
              <div class="field">
                <label>Clock</label>
                <InputText v-model="config.clock" size="small" />
              </div>
              <div class="field">
                <label>Target Freq (MHz)</label>
                <InputNumber v-model="config.frequencyMax" size="small" />
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <i class="ri-artboard-2-line c-purple"></i>
            <span>Die</span>
          </div>
          <div class="card-body">
            <div class="field-row">
              <div class="field">
                <label>Width</label>
                <InputNumber v-model="config.die.Size[0]" size="small" suffix=" μm" />
              </div>
              <div class="field">
                <label>Height</label>
                <InputNumber v-model="config.die.Size[1]" size="small" suffix=" μm" />
              </div>
            </div>
            <div class="field">
              <label>Bounding Box</label>
              <InputText v-model="config.die.boundingBox" size="small" placeholder="x1 y1 x2 y2" />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <i class="ri-shield-check-line c-orange"></i>
            <span>Constraints</span>
          </div>
          <div class="card-body">
            <div class="field">
              <label>Max Fanout</label>
              <InputNumber v-model="config.maxFanout" size="small" :min="1" />
            </div>
            <div class="field">
              <div class="label-row">
                <label>Target Density</label>
                <span class="tag green">{{ densityPercent }}%</span>
              </div>
              <input type="range" v-model.number="config.targetDensity" min="0" max="1" step="0.01" class="green" />
            </div>
            <div class="field">
              <div class="label-row">
                <label>Target Overflow</label>
                <span class="tag orange">{{ overflowPercent }}%</span>
              </div>
              <input type="range" v-model.number="config.targetOverflow" min="0" max="1" step="0.01" class="orange" />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <i class="ri-settings-3-line c-cyan"></i>
            <span>Floorplan</span>
          </div>
          <div class="card-body">
            <div class="field-row">
              <div class="field">
                <label>Tap Distance</label>
                <InputNumber v-model="config.floorplan.tapDistance" size="small" suffix=" μm" />
              </div>
              <div class="field">
                <label>Pin Layer</label>
                <Select v-model="config.floorplan.autoPlacePin.layer" :options="layerOptions" optionLabel="label"
                  optionValue="value" size="small" />
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label>Pin Width</label>
                <InputNumber v-model="config.floorplan.autoPlacePin.width" size="small" suffix=" nm" />
              </div>
              <div class="field">
                <label>Pin Height</label>
                <InputNumber v-model="config.floorplan.autoPlacePin.height" size="small" suffix=" nm" />
              </div>
            </div>
          </div>
        </section>

        <!-- 第二行 -->
        <section class="card">
          <div class="card-head">
            <i class="ri-box-3-line c-green"></i>
            <span>Core</span>
          </div>
          <div class="card-body">
            <div class="field-row">
              <div class="field">
                <label>Width</label>
                <InputNumber v-model="config.core.Size[0]" size="small" suffix=" μm" />
              </div>
              <div class="field">
                <label>Height</label>
                <InputNumber v-model="config.core.Size[1]" size="small" suffix=" μm" />
              </div>
            </div>
            <div class="field">
              <label>Bounding Box</label>
              <InputText v-model="config.core.boundingBox" size="small" placeholder="x1 y1 x2 y2" />
            </div>
            <div class="field">
              <div class="label-row">
                <label>Utilization</label>
                <span class="tag blue">{{ utilizationPercent }}%</span>
              </div>
              <input type="range" v-model.number="config.core.utilization" min="0" max="1" step="0.01" />
            </div>
            <div class="field-row">
              <div class="field">
                <label>Aspect Ratio</label>
                <InputNumber v-model="config.core.aspectRatio" size="small" :min="0.1" :step="0.1" />
              </div>
              <div class="field">
                <label>Margin X</label>
                <InputNumber v-model="config.core.margin[0]" size="small" suffix=" μm" />
              </div>
              <div class="field">
                <label>Margin Y</label>
                <InputNumber v-model="config.core.margin[1]" size="small" suffix=" μm" />
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <i class="ri-stack-line c-cyan"></i>
            <span>Routing Layers</span>
          </div>
          <div class="card-body">
            <div class="layer-list">
              <div v-for="l in layerOptions" :key="l.value" class="layer-item"
                :class="{ active: isLayerInRange(l.value) }">
                {{ l.label }}
              </div>
            </div>
            <div class="field-row" style="margin-top: 12px;">
              <div class="field">
                <label>Bottom</label>
                <Select v-model="config.bottomLayer" :options="layerOptions" optionLabel="label" optionValue="value"
                  size="small" />
              </div>
              <div class="field">
                <label>Top</label>
                <Select v-model="config.topLayer" :options="layerOptions" optionLabel="label" optionValue="value"
                  size="small" />
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <i class="ri-flashlight-line c-yellow"></i>
            <span>PDN Grid</span>
          </div>
          <div class="card-body">
            <div class="field-row">
              <div class="field">
                <label>Layer</label>
                <Select v-model="config.pdn.grid.layer" :options="layerOptions" optionLabel="label" optionValue="value"
                  size="small" />
              </div>
              <div class="field">
                <label>Width (μm)</label>
                <InputNumber v-model="config.pdn.grid.width" size="small" :minFractionDigits="2" />
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label>Power Net</label>
                <InputText v-model="config.pdn.grid.powerNet" size="small" />
              </div>
              <div class="field">
                <label>Ground Net</label>
                <InputText v-model="config.pdn.grid.groundNet" size="small" />
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head clickable" @click="toggleSection('connectLayers')">
            <i class="ri-stack-line c-yellow"></i>
            <span>Layer Connections</span>
            <span class="count">{{ config.pdn.connectLayers.length }}</span>
            <i :class="expandedSections.connectLayers ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"
              class="toggle"></i>
          </div>
          <div v-show="expandedSections.connectLayers" class="card-body compact">
            <div class="connect-list">
              <div v-for="(c, i) in config.pdn.connectLayers" :key="i" class="connect-row">
                <Select v-model="c.layers[0]" :options="layerOptions" optionLabel="label" optionValue="value"
                  size="small" />
                <i class="ri-arrow-left-right-line"></i>
                <Select v-model="c.layers[1]" :options="layerOptions" optionLabel="label" optionValue="value"
                  size="small" />
                <button class="btn-icon danger" @click="removeConnectLayer(i)">
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
            </div>
            <button class="btn-add" @click="addConnectLayer"><i class="ri-add-line"></i> Add</button>
          </div>
        </section>

        <!-- 第三行：PDN IO 和 Global Connect -->
        <section class="card">
          <div class="card-head clickable" @click="toggleSection('pdnIo')">
            <i class="ri-plug-line c-yellow"></i>
            <span>PDN IO</span>
            <span class="count">{{ config.pdn.io.length }}</span>
            <i :class="expandedSections.pdnIo ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" class="toggle"></i>
          </div>
          <div v-show="expandedSections.pdnIo" class="card-body compact">
            <table class="mini-table">
              <thead>
                <tr>
                  <th>Net</th>
                  <th>Direction</th>
                  <th>Power</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(io, i) in config.pdn.io" :key="i">
                  <td>
                    <InputText v-model="io.netName" size="small" />
                  </td>
                  <td><Select v-model="io.direction" :options="directionOptions" optionLabel="label" optionValue="value"
                      size="small" /></td>
                  <td class="center">
                    <Checkbox v-model="io.isPower" :binary="true" />
                  </td>
                  <td><button class="btn-icon danger" @click="removePdnIO(i)"><i
                        class="ri-delete-bin-line"></i></button></td>
                </tr>
              </tbody>
            </table>
            <button class="btn-add" @click="addPdnIO"><i class="ri-add-line"></i> Add</button>
          </div>
        </section>

        <section class="card span-2">
          <div class="card-head clickable" @click="toggleSection('globalConnect')">
            <i class="ri-links-line c-yellow"></i>
            <span>Global Connect</span>
            <span class="count">{{ config.pdn.globalConnect.length }}</span>
            <i :class="expandedSections.globalConnect ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"
              class="toggle"></i>
          </div>
          <div v-show="expandedSections.globalConnect" class="card-body compact">
            <table class="mini-table">
              <thead>
                <tr>
                  <th>Net</th>
                  <th>Instance Pin</th>
                  <th>Power</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(gc, i) in config.pdn.globalConnect" :key="i">
                  <td>
                    <InputText v-model="gc.netName" size="small" />
                  </td>
                  <td>
                    <InputText v-model="gc.instancePinName" size="small" />
                  </td>
                  <td class="center">
                    <Checkbox v-model="gc.isPower" :binary="true" />
                  </td>
                  <td><button class="btn-icon danger" @click="removeGlobalConnect(i)"><i
                        class="ri-delete-bin-line"></i></button></td>
                </tr>
              </tbody>
            </table>
            <button class="btn-add" @click="addGlobalConnect"><i class="ri-add-line"></i> Add</button>
          </div>
        </section>

        <!-- 最后：Tracks 和 PDN Stripe（全宽） -->
        <section class="card full-width">
          <div class="card-head clickable" @click="toggleSection('tracks')">
            <i class="ri-grid-line c-cyan"></i>
            <span>Tracks</span>
            <span class="count">{{ config.floorplan.tracks.length }}</span>
            <i :class="expandedSections.tracks ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" class="toggle"></i>
          </div>
          <div v-show="expandedSections.tracks" class="card-body compact">
            <table class="mini-table table-fixed">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>X Start</th>
                  <th>X Step</th>
                  <th>Y Start</th>
                  <th>Y Step</th>
                  <th class="col-action"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(t, i) in config.floorplan.tracks" :key="i">
                  <td><Select v-model="t.layer" :options="layerOptions" optionLabel="label" optionValue="value"
                      size="small" /></td>
                  <td>
                    <InputNumber v-model="t.xStart" size="small" />
                  </td>
                  <td>
                    <InputNumber v-model="t.xStep" size="small" />
                  </td>
                  <td>
                    <InputNumber v-model="t.yStart" size="small" />
                  </td>
                  <td>
                    <InputNumber v-model="t.yStep" size="small" />
                  </td>
                  <td class="col-action"><button class="btn-icon danger" @click="removeTrack(i)"><i
                        class="ri-delete-bin-line"></i></button></td>
                </tr>
              </tbody>
            </table>
            <button class="btn-add" @click="addTrack"><i class="ri-add-line"></i> Add</button>
          </div>
        </section>

        <section class="card full-width">
          <div class="card-head clickable" @click="toggleSection('stripe')">
            <i class="ri-layout-column-line c-yellow"></i>
            <span>PDN Stripe</span>
            <span class="count">{{ config.pdn.stripe.length }}</span>
            <i :class="expandedSections.stripe ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" class="toggle"></i>
          </div>
          <div v-show="expandedSections.stripe" class="card-body compact">
            <table class="mini-table table-fixed">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Power Net</th>
                  <th>Ground Net</th>
                  <th>Width</th>
                  <th>Pitch</th>
                  <th>Offset</th>
                  <th class="col-action"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in config.pdn.stripe" :key="i">
                  <td><Select v-model="s.layer" :options="layerOptions" optionLabel="label" optionValue="value"
                      size="small" /></td>
                  <td>
                    <InputText v-model="s.powerNet" size="small" />
                  </td>
                  <td>
                    <InputText v-model="s.groundNet" size="small" />
                  </td>
                  <td>
                    <InputNumber v-model="s.width" size="small" :minFractionDigits="1" />
                  </td>
                  <td>
                    <InputNumber v-model="s.pitch" size="small" />
                  </td>
                  <td>
                    <InputNumber v-model="s.offset" size="small" :minFractionDigits="1" />
                  </td>
                  <td class="col-action"><button class="btn-icon danger" @click="removeStripe(i)"><i
                        class="ri-delete-bin-line"></i></button></td>
                </tr>
              </tbody>
            </table>
            <button class="btn-add" @click="addStripe"><i class="ri-add-line"></i> Add</button>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.config-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* 顶栏 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.topbar-left i {
  font-size: 18px;
  color: #6366f1;
}

.topbar-left .title {
  font-weight: 600;
  font-family: 'Fira Code', monospace;
}

.topbar-left .divider {
  color: var(--text-secondary);
}

.topbar-left .subtitle {
  color: var(--text-secondary);
}

.topbar-left .unsaved-indicator {
  color: #f59e0b;
  font-weight: 600;
  margin-left: -4px;
}

.topbar-left .loading-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  margin-left: 8px;
}

.topbar-left .error-indicator {
  color: #ef4444;
  cursor: help;
  margin-left: 8px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.spin {
  animation: spin 1s linear infinite;
}

.topbar-right {
  display: flex;
  gap: 8px;
}

.btn-text {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.btn-text:hover:not(:disabled) {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.btn-text:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: none;
  background: #6366f1;
  color: white;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Grid 布局容器 */
.content-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  max-width: 1600px;
  margin: 0 auto;
}

/* 卡片 */
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.card.span-2 {
  grid-column: span 2;
}

.card.full-width {
  grid-column: 1 / -1;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
}

.card-head.clickable {
  cursor: pointer;
  transition: background 0.15s;
}

.card-head.clickable:hover {
  background: var(--bg-primary);
}

.card-head i:first-child {
  font-size: 14px;
}

.card-head .count {
  margin-left: auto;
  padding: 2px 6px;
  background: var(--bg-primary);
  border-radius: 4px;
  font-size: 10px;
  color: var(--text-secondary);
}

.card-head .toggle {
  color: var(--text-secondary);
  font-size: 16px;
}

.card-body {
  padding: 12px;
}

.card-body.compact {
  padding: 8px;
}

/* 颜色类 */
.c-indigo {
  color: #6366f1;
}

.c-purple {
  color: #8b5cf6;
}

.c-green {
  color: #10b981;
}

.c-orange {
  color: #f59e0b;
}

.c-cyan {
  color: #06b6d4;
}

.c-yellow {
  color: #eab308;
}

/* 表单 */
.field {
  margin-bottom: 10px;
}

.field:last-child {
  margin-bottom: 0;
}

.field label {
  display: block;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.label-row label {
  margin-bottom: 0;
}

.field-row {
  display: flex;
  gap: 10px;
}

.field-row .field {
  flex: 1;
  min-width: 0;
}

/* Tag */
.tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
}

.tag.blue {
  background: rgba(99, 102, 241, 0.15);
  color: #6366f1;
}

.tag.green {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.tag.orange {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

/* Range Slider */
input[type="range"] {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border-color);
  border-radius: 2px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #6366f1;
  cursor: pointer;
}

input[type="range"].green::-webkit-slider-thumb {
  background: #10b981;
}

input[type="range"].orange::-webkit-slider-thumb {
  background: #f59e0b;
}

/* Layer List */
.layer-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.layer-item {
  padding: 4px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 11px;
  font-family: 'Fira Code', monospace;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.layer-item.active {
  background: rgba(6, 182, 212, 0.1);
  border-color: #06b6d4;
  color: #06b6d4;
}

/* Mini Table */
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.mini-table.table-fixed {
  table-layout: fixed;
}

.mini-table.table-fixed th,
.mini-table.table-fixed td {
  width: 16%;
}

.mini-table.table-fixed th.col-action,
.mini-table.table-fixed td.col-action {
  width: 4%;
  text-align: center;
}

.mini-table th {
  text-align: left;
  padding: 6px 4px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border-color);
}

.mini-table td {
  padding: 4px;
  vertical-align: middle;
}

.mini-table td.center {
  text-align: center;
}

.mini-table :deep(.p-inputtext),
.mini-table :deep(.p-inputnumber),
.mini-table :deep(.p-select) {
  width: 100%;
}

/* Buttons */
.btn-icon {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.btn-icon.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.btn-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  padding: 6px;
  margin-top: 8px;
  border: 1px dashed var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-add:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.05);
}

/* Connect List */
.connect-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.connect-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-primary);
  border-radius: 4px;
}

.connect-row :deep(.p-select) {
  flex: 1;
}

.connect-row>i {
  color: var(--text-secondary);
  font-size: 12px;
}

/* Input overrides */
:deep(.p-inputtext),
:deep(.p-inputnumber-input),
:deep(.p-select) {
  background: var(--bg-primary);
  border-color: var(--border-color);
  font-size: 12px;
}

.field :deep(.p-inputtext),
.field :deep(.p-inputnumber),
.field :deep(.p-select) {
  width: 100%;
}

:deep(.p-inputtext:focus),
:deep(.p-inputnumber-input:focus) {
  border-color: #6366f1;
  box-shadow: none;
}

/* Responsive */
@media (max-width: 1400px) {
  .content-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .card.span-2 {
    grid-column: span 2;
  }
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .card.span-2 {
    grid-column: span 2;
  }
}

@media (max-width: 768px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .card.span-2,
  .card.full-width {
    grid-column: span 1;
  }

  .topbar {
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }

  .topbar-right {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
