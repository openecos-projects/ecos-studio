<script setup lang="ts">
import { computed } from 'vue'
import type { LayoutGroup, LayoutDataStore } from '@/applications/editor/layout'
import { GroupType, formatMicron } from '@/applications/editor/layout'

interface Props {
  selectedGroups: LayoutGroup[]
  dataStore: LayoutDataStore | null
}

const props = defineProps<Props>()

const isSingle = computed(() => props.selectedGroups.length === 1)
const isMulti = computed(() => props.selectedGroups.length > 1)
const isEmpty = computed(() => props.selectedGroups.length === 0)

const singleGroup = computed(() =>
  isSingle.value ? props.selectedGroups[0] : null
)

const dbuPerMicron = computed(() => props.dataStore?.dbuPerMicron ?? 1000)

const groupLayerNames = computed(() => {
  if (!singleGroup.value || !props.dataStore) return []
  const layers = new Set<number>()
  for (const box of singleGroup.value.children) {
    layers.add(box.layer)
  }
  return Array.from(layers)
    .sort((a, b) => a - b)
    .map((id) => props.dataStore!.getLayerName(id))
})

const groupTypeLabel = computed(() => {
  if (!singleGroup.value) return ''
  switch (singleGroup.value.groupType) {
    case GroupType.Cell: return 'Cell'
    case GroupType.PowerNet: return 'Power Net'
    case GroupType.SignalNet: return 'Signal Net'
    default: return 'Unknown'
  }
})

const bboxInfo = computed(() => {
  if (!singleGroup.value) return null
  const b = singleGroup.value.bbox
  const d = dbuPerMicron.value
  return {
    x: b.x,
    y: b.y,
    w: b.width,
    h: b.height,
    xUm: formatMicron(b.x, d),
    yUm: formatMicron(b.y, d),
    wUm: formatMicron(b.width, d),
    hUm: formatMicron(b.height, d),
  }
})

// Multi-select stats
const multiStats = computed(() => {
  if (!isMulti.value) return null
  const counts = new Map<GroupType, number>()
  for (const g of props.selectedGroups) {
    counts.set(g.groupType, (counts.get(g.groupType) ?? 0) + 1)
  }
  return {
    total: props.selectedGroups.length,
    cells: counts.get(GroupType.Cell) ?? 0,
    powerNets: counts.get(GroupType.PowerNet) ?? 0,
    signalNets: counts.get(GroupType.SignalNet) ?? 0,
  }
})
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

    <!-- Single group -->
    <div v-else-if="isSingle && singleGroup" class="properties-content">
      <div class="prop-row">
        <span class="prop-label">Name</span>
        <span class="prop-value font-mono">{{ singleGroup.structName }}</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Type</span>
        <span class="prop-value">
          <span class="type-badge" :class="singleGroup.groupType.toLowerCase()">{{ groupTypeLabel }}</span>
        </span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Children</span>
        <span class="prop-value">{{ singleGroup.children.length }} boxes</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Layers</span>
        <span class="prop-value">{{ groupLayerNames.join(', ') }}</span>
      </div>

      <div v-if="bboxInfo" class="prop-section">
        <div class="section-title">Bounding Box</div>
        <div class="prop-row compact">
          <span class="prop-label">X</span>
          <span class="prop-value font-mono">{{ bboxInfo.x }} DBU ({{ bboxInfo.xUm }})</span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Y</span>
          <span class="prop-value font-mono">{{ bboxInfo.y }} DBU ({{ bboxInfo.yUm }})</span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Width</span>
          <span class="prop-value font-mono">{{ bboxInfo.w }} DBU ({{ bboxInfo.wUm }})</span>
        </div>
        <div class="prop-row compact">
          <span class="prop-label">Height</span>
          <span class="prop-value font-mono">{{ bboxInfo.h }} DBU ({{ bboxInfo.hUm }})</span>
        </div>
      </div>
    </div>

    <!-- Multi-select -->
    <div v-else-if="isMulti && multiStats" class="properties-content">
      <div class="prop-row">
        <span class="prop-label">Selected</span>
        <span class="prop-value">{{ multiStats.total }} groups</span>
      </div>
      <div v-if="multiStats.cells > 0" class="prop-row compact">
        <span class="prop-label">Cells</span>
        <span class="prop-value">{{ multiStats.cells }}</span>
      </div>
      <div v-if="multiStats.powerNets > 0" class="prop-row compact">
        <span class="prop-label">Power Nets</span>
        <span class="prop-value">{{ multiStats.powerNets }}</span>
      </div>
      <div v-if="multiStats.signalNets > 0" class="prop-row compact">
        <span class="prop-label">Signal Nets</span>
        <span class="prop-value">{{ multiStats.signalNets }}</span>
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

.type-badge.cell { background: rgba(68, 68, 255, 0.2); color: #6666ff; }
.type-badge.powernet { background: rgba(255, 68, 68, 0.2); color: #ff6666; }
.type-badge.signalnet { background: rgba(68, 255, 68, 0.2); color: #66ff66; }

.font-mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
}
</style>
