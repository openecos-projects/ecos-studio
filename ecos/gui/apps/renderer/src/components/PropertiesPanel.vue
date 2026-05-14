<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutState } from '@/composables/useLayoutState'
import { GLOBAL_SHAPE_TYPE } from '@/applications/editor/tile/manifest'

const layoutState = useLayoutState()

const sel = computed(() => layoutState.tileSelection.value)
const isEmpty = computed(() => !sel.value)
const isInstance = computed(() => sel.value?.type === 'instance')
const isSegment = computed(() => sel.value?.type === 'segment')

const ORIENT_NAMES = ['N', 'S', 'E', 'W', 'FN', 'FS', 'FE', 'FW'] as const
const GLOBAL_TYPE_NAMES: Record<number, string> = {
  [GLOBAL_SHAPE_TYPE.POWER_STRIPE]:  'Power Stripe',
  [GLOBAL_SHAPE_TYPE.GROUND_STRIPE]: 'Ground Stripe',
  [GLOBAL_SHAPE_TYPE.IO_PIN]:        'I/O Pin',
  [GLOBAL_SHAPE_TYPE.BLOCKAGE]:      'Blockage',
}

const orientLabel = computed(() => {
  const o = sel.value?.orient
  return o != null ? (ORIENT_NAMES[o] ?? String(o)) : null
})

const globalTypeLabel = computed(() => {
  const t = sel.value?.globalType
  return t != null ? (GLOBAL_TYPE_NAMES[t] ?? 'Unknown') : null
})

const DIRECTION_NAMES: Record<number, string> = { 0: 'Horizontal', 1: 'Vertical', 2: 'Mixed' }
const directionLabel = computed(() => {
  const d = sel.value?.direction
  return d != null ? (DIRECTION_NAMES[d] ?? String(d)) : null
})

function formatDbu(dbu: number): string {
  const d = layoutState.tileDbuPerMicron.value
  return (dbu / d).toFixed(3)
}

function handleClear(): void {
  layoutState.tileActions.value?.clearSelection()
}

function handleFitToView(): void {
  layoutState.tileActions.value?.fitToView()
}
</script>

<template>
  <div class="properties-panel">
    <div class="panel-header">
      <i class="ri-information-line"></i>
      <span>Properties</span>
    </div>

    <div v-if="isEmpty" class="empty-state">
      No element selected
    </div>

    <!-- Instance -->
    <div v-else-if="sel && isInstance" class="properties-content">
      <div class="prop-row">
        <span class="prop-label">Type</span>
        <span class="prop-value">
          <span class="type-badge instance">Instance</span>
        </span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Cell ID</span>
        <span class="prop-value font-mono">{{ sel.cellId }}</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Instance ID</span>
        <span class="prop-value font-mono">{{ sel.instanceId }}</span>
      </div>
      <div v-if="sel.layerName" class="prop-row">
        <span class="prop-label">Hit Layer</span>
        <span class="prop-value">{{ sel.layerName }}</span>
      </div>
      <div v-if="orientLabel" class="prop-row">
        <span class="prop-label">Orient</span>
        <span class="prop-value font-mono">{{ orientLabel }}</span>
      </div>

      <div class="prop-section">
        <div class="section-title">Position &amp; Size</div>
        <div class="prop-row compact">
          <span class="prop-label">Origin</span>
          <span class="prop-value font-mono">({{ sel.originX }}, {{ sel.originY }})</span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Width</span>
          <span class="prop-value font-mono">{{ sel.bboxW }} <span class="unit">({{ formatDbu(sel.bboxW) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Height</span>
          <span class="prop-value font-mono">{{ sel.bboxH }} <span class="unit">({{ formatDbu(sel.bboxH) }} μm)</span></span>
        </div>
      </div>

      <div class="prop-actions">
        <button class="action-btn fit" @click="handleFitToView">Fit to View</button>
        <button class="action-btn clear" @click="handleClear">Clear</button>
      </div>
    </div>

    <!-- Routing Segment -->
    <div v-else-if="sel && isSegment" class="properties-content">
      <div class="prop-row">
        <span class="prop-label">Type</span>
        <span class="prop-value">
          <span class="type-badge segment">Wire Segment</span>
        </span>
      </div>
      <div v-if="sel.layerName" class="prop-row">
        <span class="prop-label">Layer</span>
        <span class="prop-value">{{ sel.layerName }}</span>
      </div>
      <div v-if="directionLabel" class="prop-row">
        <span class="prop-label">Direction</span>
        <span class="prop-value">{{ directionLabel }}</span>
      </div>
      <div v-if="sel.wireWidth" class="prop-row">
        <span class="prop-label">Wire Width</span>
        <span class="prop-value font-mono">{{ sel.wireWidth }} <span class="unit">({{ formatDbu(sel.wireWidth) }} μm)</span></span>
      </div>

      <div class="prop-section">
        <div class="section-title">Position &amp; Size</div>
        <div class="prop-row compact">
          <span class="prop-label">X</span>
          <span class="prop-value font-mono">{{ sel.bboxX }} <span class="unit">({{ formatDbu(sel.bboxX) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Y</span>
          <span class="prop-value font-mono">{{ sel.bboxY }} <span class="unit">({{ formatDbu(sel.bboxY) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Width</span>
          <span class="prop-value font-mono">{{ sel.bboxW }} <span class="unit">({{ formatDbu(sel.bboxW) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Height</span>
          <span class="prop-value font-mono">{{ sel.bboxH }} <span class="unit">({{ formatDbu(sel.bboxH) }} μm)</span></span>
        </div>
      </div>

      <div class="prop-actions">
        <button class="action-btn fit" @click="handleFitToView">Fit to View</button>
        <button class="action-btn clear" @click="handleClear">Clear</button>
      </div>
    </div>

    <!-- Global Shape -->
    <div v-else-if="sel" class="properties-content">
      <div class="prop-row">
        <span class="prop-label">Type</span>
        <span class="prop-value">
          <span class="type-badge global">Global Shape</span>
        </span>
      </div>
      <div v-if="sel.netName" class="prop-row">
        <span class="prop-label">Net</span>
        <span class="prop-value net-name">{{ sel.netName }}</span>
      </div>
      <div v-if="globalTypeLabel" class="prop-row">
        <span class="prop-label">Shape Type</span>
        <span class="prop-value">{{ globalTypeLabel }}</span>
      </div>
      <div v-if="sel.layerName" class="prop-row">
        <span class="prop-label">Layer</span>
        <span class="prop-value">{{ sel.layerName }}</span>
      </div>

      <div class="prop-section">
        <div class="section-title">Position &amp; Size</div>
        <div class="prop-row compact">
          <span class="prop-label">X</span>
          <span class="prop-value font-mono">{{ sel.bboxX }} <span class="unit">({{ formatDbu(sel.bboxX) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Y</span>
          <span class="prop-value font-mono">{{ sel.bboxY }} <span class="unit">({{ formatDbu(sel.bboxY) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Width</span>
          <span class="prop-value font-mono">{{ sel.bboxW }} <span class="unit">({{ formatDbu(sel.bboxW) }} μm)</span></span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Height</span>
          <span class="prop-value font-mono">{{ sel.bboxH }} <span class="unit">({{ formatDbu(sel.bboxH) }} μm)</span></span>
        </div>
      </div>

      <div class="prop-actions">
        <button class="action-btn fit" @click="handleFitToView">Fit to View</button>
        <button class="action-btn clear" @click="handleClear">Clear</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.properties-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.empty-state {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-tertiary, #666);
  font-size: 12px;
}

.properties-content {
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}

.prop-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 12px;
  gap: 8px;
}

.prop-row.compact {
  padding: 2px 12px;
}

.prop-label {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.prop-value {
  color: var(--text-primary);
  font-size: 12px;
  text-align: right;
  word-break: break-all;
}

.prop-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.section-title {
  padding: 2px 12px 4px;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.type-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}

.type-badge.instance { background: rgba(68, 68, 255, 0.2); color: #6699ff; }
.type-badge.segment  { background: rgba(255, 136, 0, 0.2); color: #ff9933; }
.type-badge.global   { background: rgba(0, 191, 255, 0.2); color: #00bfff; }

.net-name {
  color: #67e8f9;
  font-weight: 600;
}

.unit {
  color: var(--text-tertiary, #888);
  font-size: 10px;
}

.font-mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.prop-actions {
  margin-top: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 6px;
}

.action-btn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

/* Light：深色字 + 可辨边框；Clear 勿用白半透明（在浅底上几乎看不见） */
.action-btn.fit {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-primary));
  color: #0d9488;
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
}
.action-btn.fit:hover {
  background: color-mix(in srgb, var(--accent-color) 28%, var(--bg-primary));
}

.action-btn.clear {
  background: color-mix(in srgb, var(--text-primary) 6%, var(--bg-secondary));
  color: var(--text-primary);
  border-color: var(--border-color);
}
.action-btn.clear:hover {
  background: color-mix(in srgb, var(--text-primary) 10%, var(--bg-secondary));
}

:global(.dark) .action-btn.fit {
  background: rgba(0, 150, 200, 0.3);
  color: #7dd3fc;
  border-color: transparent;
}
:global(.dark) .action-btn.fit:hover {
  background: rgba(0, 150, 200, 0.5);
}

:global(.dark) .action-btn.clear {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  border-color: transparent;
}
:global(.dark) .action-btn.clear:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
