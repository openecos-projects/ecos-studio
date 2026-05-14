<script setup lang="ts">
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import { useParameters } from '@/composables/useParameters'

const {
  config,
  isLoading,
  isSaving,
  error,
  hasChanges,
  saveParameters,
  resetParameters,
  refreshParameters,
  layerOptions,
  isLayerInRange
} = useParameters()

const utilizationPercent = computed(() => Math.round(config.core.utilization * 100))
const densityPercent = computed(() => Math.round(config.targetDensity * 100))
const overflowPercent = computed(() => Math.round(config.targetOverflow * 100))

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

</script>

<template>
  <div class="config-view">
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

    <main class="content-container">
      <div class="content-grid">
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
            <div class="field">
              <label>PDK Root</label>
              <InputText v-model="config.pdkRoot" size="small" placeholder="Absolute path to PDK" />
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
              <label>Area</label>
              <InputNumber v-model="config.die.area" size="small" suffix=" μm²" :minFractionDigits="0"
                :maxFractionDigits="6" />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <i class="ri-shield-check-line c-orange"></i>
            <span>Constraints</span>
          </div>
          <div class="card-body">
            <div class="field-row">
              <div class="field">
                <label>Max Fanout</label>
                <InputNumber v-model="config.maxFanout" size="small" :min="1" />
              </div>
              <div class="field">
                <label>Global right padding</label>
                <InputNumber v-model="config.globalRightPadding" size="small" :min="0" />
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label>Cell padding X</label>
                <InputNumber v-model="config.cellPaddingX" size="small" :min="0" />
              </div>
              <div class="field">
                <label>Routability optimization</label>
                <Checkbox v-model="config.routabilityOptFlag" :binary="true" />
              </div>
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
              <label>Area</label>
              <InputNumber v-model="config.core.area" size="small" suffix=" μm²" :minFractionDigits="0"
                :maxFractionDigits="6" />
            </div>
            <div class="field">
              <label>Bounding Box</label>
              <InputText v-model="config.core.boundingBox" size="small" placeholder="(x1 , y1) (x2 , y2)" />
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

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
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

.card-head i:first-child {
  font-size: 14px;
}

.card-body {
  padding: 12px;
}

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

@media (max-width: 1400px) {
  .content-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .content-grid {
    grid-template-columns: 1fr;
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
