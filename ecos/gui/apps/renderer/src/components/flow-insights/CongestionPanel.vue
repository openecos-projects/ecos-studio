<template>
  <div class="insight-module">
    <div v-if="!tiles.length" class="insight-empty">
      Waiting for congestion &amp; density maps (place / CTS)…
    </div>
    <template v-else>
      <section v-if="comparisonSeries.length" class="congestion-compare">
        <header class="congestion-group-header">
          <h3>EGR overflow by step</h3>
          <span class="congestion-count">place → later steps</span>
        </header>
        <FlowTrendChart
          label="EGR overflow total and max by step"
          :categories="comparisonCategories"
          :series="comparisonSeries"
          left-unit="total"
          right-unit="max"
          height="180px"
        />
      </section>
      <div v-for="group in stepGroups" :key="group.step" class="congestion-group">
        <header class="congestion-group-header">
          <h3>{{ group.label }}</h3>
          <span class="congestion-count">{{ group.tiles.length }} maps</span>
        </header>
        <div class="congestion-grid">
          <button
            v-for="tile in group.tiles"
            :key="tile.id"
            type="button"
            class="congestion-tile"
            :class="{ 'is-hot': hasOverflow(tile) }"
            :title="tileTitle(tile)"
            @click="previewTile = tile"
          >
            <img :src="tileUrls.get(tile.pngPath)" :alt="`${group.label} ${tile.label}`" />
            <span class="congestion-tile-copy">
              <strong>{{ tile.label }}</strong>
              <small>
                <template v-if="tile.stats">
                  max {{ tile.stats.max }} · Σ{{ compact(tile.stats.total) }} ·
                  {{ compact(tile.stats.hotspotCount) }} cells
                </template>
                <template v-else>no grid data</template>
              </small>
            </span>
            <span class="congestion-badge" :class="hasOverflow(tile) ? 'is-hot' : 'is-clean'">
              {{ hasOverflow(tile) ? 'overflow' : 'clean' }}
            </span>
          </button>
        </div>
      </div>
    </template>

    <Dialog
      :visible="previewTile !== null"
      modal
      :header="previewTile ? `${previewTile.step.key} · ${previewTile.label}` : ''"
      :style="{ width: 'min(760px, calc(100vw - 32px))' }"
      :draggable="false"
      @update:visible="previewTile = null"
    >
      <div v-if="previewTile" class="congestion-preview">
        <img :src="tileUrls.get(previewTile.pngPath)" :alt="previewTile.label" />
        <dl v-if="previewTile.stats" class="congestion-preview-stats">
          <div>
            <dt>Max overflow / density</dt>
            <dd>{{ previewTile.stats.max }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{{ compact(previewTile.stats.total) }}</dd>
          </div>
          <div>
            <dt>Hotspot cells</dt>
            <dd>{{ compact(previewTile.stats.hotspotCount) }}</dd>
          </div>
        </dl>
        <p class="congestion-preview-path">{{ previewTile.pngPath }}</p>
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import {
  buildCongestionComparisonModel,
  type CongestionMapTileModel,
} from './flowInsightsData'

const props = defineProps<{
  tiles: CongestionMapTileModel[]
  tileUrls: Map<string, string>
}>()

const previewTile = ref<CongestionMapTileModel | null>(null)

const comparison = computed(() => buildCongestionComparisonModel(props.tiles))
const comparisonCategories = computed(() => comparison.value.map((point) => point.stepKey))
const comparisonSeries = computed<FlowTrendSeries[]>(() => {
  if (comparison.value.length < 2) return []
  return [
    {
      id: 'egr-total',
      label: 'Overflow total',
      type: 'line',
      values: comparison.value.map((point) => point.total),
      unit: 'count',
      color: '#ef4444',
    },
    {
      id: 'egr-max',
      label: 'Overflow max',
      type: 'line',
      values: comparison.value.map((point) => point.max),
      unit: 'count',
      color: '#f59e0b',
      yAxisIndex: 1,
    },
  ]
})

const stepGroups = computed(() => {
  const groups: Array<{ step: string; label: string; tiles: CongestionMapTileModel[] }> = []
  for (const tile of props.tiles) {
    const group = groups.find((item) => item.step === tile.step.name)
    if (group) group.tiles.push(tile)
    else groups.push({ step: tile.step.name, label: tile.step.key, tiles: [tile] })
  }
  return groups
})

function hasOverflow(tile: CongestionMapTileModel): boolean {
  return tile.mapKind !== 'density' && (tile.stats?.total ?? 0) > 0
}

function tileTitle(tile: CongestionMapTileModel): string {
  const stats = tile.stats
    ? ` · max ${tile.stats.max}, total ${tile.stats.total}, ${tile.stats.hotspotCount} hotspot cells`
    : ''
  return `${tile.step.name} ${tile.label}${stats}`
}

function compact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}
</script>

<style scoped>
.insight-module {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.insight-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 12px;
  justify-content: center;
  min-height: 160px;
}

.congestion-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.congestion-group-header {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.congestion-group-header h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.congestion-count {
  color: var(--text-secondary);
  font-size: 10px;
}

.congestion-compare {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.congestion-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}

.congestion-tile {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  position: relative;
  text-align: left;
}

.congestion-tile:hover,
.congestion-tile:focus-visible {
  border-color: color-mix(in srgb, var(--accent-color, #3b82f6) 62%, var(--border-color));
}

.congestion-tile.is-hot {
  border-color: color-mix(in srgb, var(--warn-color) 55%, var(--border-color));
}

.congestion-tile img {
  aspect-ratio: 1 / 1;
  display: block;
  object-fit: contain;
  width: 100%;
}

.congestion-tile-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
}

.congestion-tile-copy strong {
  color: var(--text-primary);
  font-size: 11px;
}

.congestion-tile-copy small {
  color: var(--text-secondary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.congestion-badge {
  border-radius: 999px;
  font-size: 8px;
  padding: 2px 6px;
  position: absolute;
  right: 6px;
  top: 6px;
}

.congestion-badge.is-hot {
  background: color-mix(in srgb, var(--warn-color) 82%, black);
  color: #fff;
}

.congestion-badge.is-clean {
  background: color-mix(in srgb, var(--success-color) 82%, black);
  color: #fff;
}

.congestion-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.congestion-preview img {
  background: #0b1220;
  border-radius: 8px;
  max-height: 60vh;
  object-fit: contain;
  width: 100%;
}

.congestion-preview-stats {
  display: grid;
  gap: 6px 16px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.congestion-preview-stats div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.congestion-preview-stats dt {
  color: var(--text-secondary);
  font-size: 10px;
}

.congestion-preview-stats dd {
  color: var(--text-primary);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  margin: 0;
}

.congestion-preview-path {
  color: var(--text-secondary);
  font-size: 9px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
