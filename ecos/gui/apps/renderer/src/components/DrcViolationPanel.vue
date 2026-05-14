<script setup lang="ts">
import { computed } from 'vue'
import VirtualScroller from 'primevue/virtualscroller'
import { useLayoutState } from '@/composables/useLayoutState'

/** 与行高 padding + 字号一致，供虚拟滚动固定项高 */
const DRC_ROW_ITEM_SIZE = 28

const layoutState = useLayoutState()

const rows = computed(() => layoutState.drcViolations.value)
const count = computed(() => rows.value.length)
const ready = computed(() => layoutState.drcOverlayReady.value)

function formatCoord(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

/** 与标尺一致：显示坐标中心（EDA）；`tileDieWorldH` 来自 manifest，与 `worldToDisplay` 一致 */
function formatEdaCenter(v: (typeof rows.value)[number]): string {
  const h = layoutState.tileDieWorldH.value
  const wx = v.x + v.w / 2
  const wy = v.y + v.h / 2
  if (h <= 0) {
    return `${formatCoord(wx)}, ${formatCoord(wy)}`
  }
  const displayX = wx
  const displayY = h - wy
  return `${formatCoord(displayX)}, ${formatCoord(displayY)}`
}

function rowTitle(v: (typeof rows.value)[number]): string {
  const parts = [v.category, v.layerName, formatEdaCenter(v)]
  if (v.netSummary) parts.push(v.netSummary)
  return parts.join(' · ')
}

function onRowClick(index: number): void {
  layoutState.focusDrcViolationByIndex.value?.(index)
}
</script>

<template>
  <div class="drc-panel">
    <div class="panel-header">
      <div class="header-left">
        <i class="ri-error-warning-line text-amber-400/90" />
        <span>DRC</span>
        <span v-if="count" class="drc-count">{{ count }}</span>
      </div>
    </div>

    <div v-if="!ready && count === 0" class="empty-state">
      No violation data: Please confirm that the tile has been generated and the <code class="code-hint">drc.step.json</code> file exists.
    </div>

    <div v-else-if="ready && count === 0" class="empty-state">
      The current DRC result is empty (0 violations).
    </div>

    <div v-else class="drc-table-wrap">
      <div class="drc-table-head">
        <span class="col-idx">#</span>
        <span class="col-cat">Type</span>
        <span class="col-layer">Layer</span>
        <span class="col-pos">Center</span>
      </div>
      <div class="drc-table-body">
        <VirtualScroller
          :items="rows"
          :item-size="DRC_ROW_ITEM_SIZE"
          :num-tolerated-items="8"
          scroll-height="100%"
          class="drc-virtual-scroller"
        >
          <template #item="{ item, options }">
            <button
              type="button"
              class="drc-row"
              :title="rowTitle(item)"
              @click="onRowClick(options.index)"
            >
              <span class="col-idx">{{ options.index + 1 }}</span>
              <span class="col-cat">{{ item.category }}</span>
              <span class="col-layer">{{ item.layerName }}</span>
              <span class="col-pos mono">{{ formatEdaCenter(item) }}</span>
            </button>
          </template>
        </VirtualScroller>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drc-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.drc-count {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary, #666);
  text-transform: none;
  letter-spacing: 0;
}

.empty-state {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-tertiary, #666);
  font-size: 11px;
  line-height: 1.45;
  flex: 1;
  overflow-y: auto;
}

.code-hint {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-hover);
}

.drc-table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.drc-table-head {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 1.1fr);
  gap: 4px;
  padding: 4px 10px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary, #666);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.drc-table-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 2px 0 6px;
}

/* VirtualScroller 填满侧栏剩余高度 */
.drc-virtual-scroller {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.drc-virtual-scroller :deep(.p-virtualscroller) {
  height: 100%;
}

.drc-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 1.1fr);
  gap: 4px;
  width: 100%;
  padding: 5px 10px;
  margin: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
  align-items: start;
}
.drc-row:hover {
  background: var(--bg-hover);
}

.col-idx {
  color: var(--text-tertiary, #666);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.col-cat,
.col-layer {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.col-pos {
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: ui-monospace, 'SF Mono', 'Fira Code', monospace;
}
</style>
