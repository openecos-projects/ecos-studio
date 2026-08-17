<template>
  <div class="insight-module">
    <div v-if="!model" class="insight-empty">Waiting for DRC statistics…</div>
    <template v-else>
      <div class="drc-hero-row">
        <div
          class="drc-hero"
          :class="isClean ? 'is-clean' : 'is-dirty'"
          :title="heroTitle"
        >
          <strong class="drc-count">{{ displayDrcCount }}</strong>
          <span class="drc-status">
            {{ isClean ? 'CLEAN · all layers pass' : 'violations detected' }}
          </span>
        </div>
        <div class="drc-related">
          <div
            class="drc-related-card"
            :class="toneClass(related.routeDrViolations)"
          >
            <span>Route DR</span>
            <strong>{{ formatCount(related.routeDrViolations) }}</strong>
          </div>
          <div
            class="drc-related-card"
            :class="toneClass(related.routeLaOverflow)"
          >
            <span>LA overflow</span>
            <strong>{{ formatCount(related.routeLaOverflow) }}</strong>
          </div>
        </div>
      </div>

      <section class="drc-card">
        <header class="drc-subheader">
          <h3>{{ chartMode === 'pie' ? 'Violation Share' : 'Violations by Layer' }}</h3>
          <div class="drc-mode">
            <span class="drc-hint">{{ selectedTypeName ? humanize(selectedTypeName) : `${model.layerColumns.length} layers` }}</span>
            <button
              type="button"
              class="drc-chip"
              :class="{ 'is-active': chartMode === 'bar' }"
              @click="chartMode = 'bar'"
            >
              Bars
            </button>
            <button
              type="button"
              class="drc-chip"
              :class="{ 'is-active': chartMode === 'pie' }"
              @click="chartMode = 'pie'"
            >
              Pie
            </button>
          </div>
        </header>
        <FlowTrendChart
          :label="chartMode === 'pie' ? 'DRC violation share' : 'DRC violations by layer'"
          :categories="chartCategories"
          :series="layerSeries"
          :mode="chartMode === 'pie' ? 'pie' : 'cartesian'"
          left-unit="count"
          :y-max="isClean && chartMode === 'bar' ? 1 : undefined"
          height="220px"
        />
        <p v-if="isClean" class="drc-clean-baseline">
          <i class="ri-checkbox-circle-line" aria-hidden="true" />
          <span>All layers clean</span>
        </p>
      </section>

      <section class="drc-card" v-if="model.types.length">
        <header class="drc-subheader">
          <h3>Violations by Type</h3>
        </header>
        <ul class="drc-type-list">
          <li
            v-for="type in model.types"
            :key="type.name"
            :class="{ 'is-active': selectedTypeName === type.name }"
            @click="toggleType(type.name)"
          >
            <strong class="drc-type-name" :title="type.name">{{ humanize(type.name) }}</strong>
            <span class="drc-type-bar" aria-hidden="true">
              <span :style="{ width: `${typeShare(type.total)}%` }" />
            </span>
            <span class="drc-type-count">{{ type.total }}</span>
            <span class="drc-type-share">{{ typeShare(type.total).toFixed(1) }}%</span>
            <span class="drc-type-layer">{{ type.maxLayer ? `main: ${type.maxLayer}` : '' }}</span>
          </li>
        </ul>
      </section>

      <section class="drc-card">
        <header class="drc-subheader">
          <h3>Layer × Type Matrix</h3>
          <label class="drc-toggle">
            <input v-model="nonZeroOnly" type="checkbox" />
            Non-zero only
          </label>
        </header>
        <div class="drc-matrix-scroll">
          <table class="drc-matrix">
            <thead>
              <tr>
                <th class="drc-type-col">Type</th>
                <th v-for="layer in visibleLayers" :key="layer">{{ layer }}</th>
                <th>{{ model.totalColumn }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="type in visibleTypes" :key="type.name">
                <th class="drc-type-col" :title="type.name">{{ humanize(type.name) }}</th>
                <td
                  v-for="layer in visibleLayers"
                  :key="layer"
                  :class="{ 'is-hot': type.values[layerIndexOf(layer)] > 0 }"
                >
                  {{ type.values[layerIndexOf(layer)] || '·' }}
                </td>
                <td class="drc-row-total">{{ type.total || '·' }}</td>
              </tr>
              <tr class="drc-total-row">
                <th class="drc-type-col">Total</th>
                <td v-for="layer in visibleLayers" :key="layer">
                  {{ model.totalByLayer[layerIndexOf(layer)] || '·' }}
                </td>
                <td>{{ model.totalCount }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import type { DrcLayerTypeMatrix, DrcRelatedMetrics } from './flowInsightsData'
import { buildDrcRelatedMetrics } from './flowInsightsData'

const props = defineProps<{
  model: DrcLayerTypeMatrix | null
  related?: DrcRelatedMetrics | null
}>()

const nonZeroOnly = ref(false)
const selectedTypeName = ref<string | null>(null)
const chartMode = ref<'bar' | 'pie'>('bar')

const related = computed(() => props.related ?? buildDrcRelatedMetrics({}))
const displayDrcCount = computed(
  () => related.value.drcCount ?? props.model?.totalCount ?? 0,
)
const isClean = computed(() => displayDrcCount.value === 0)

const chartCategories = computed(() => {
  if (!props.model) return []
  if (chartMode.value === 'pie' && !selectedTypeName.value) {
    return props.model.types.map((type) => humanize(type.name))
  }
  return props.model.layerColumns
})

const layerSeries = computed<FlowTrendSeries[]>(() => {
  if (!props.model) return []
  if (chartMode.value === 'pie' && !selectedTypeName.value) {
    return [
      {
        id: 'drc-by-type-pie',
        label: 'Violations',
        type: 'bar',
        values: props.model.types.map((type) => type.total),
        unit: 'count',
      },
    ]
  }
  const types = selectedTypeName.value
    ? props.model.types.filter((type) => type.name === selectedTypeName.value)
    : props.model.types
  if (types.length > 0 && (types.length > 1 || selectedTypeName.value)) {
    return types.map((type) => ({
      id: `drc-type-${type.name}`,
      label: type.name,
      type: 'bar' as const,
      values: type.values,
      unit: 'count',
    }))
  }
  return [
    {
      id: 'drc-by-layer',
      label: 'Violations',
      type: 'bar',
      values: props.model.totalByLayer,
      unit: 'count',
    },
  ]
})

const visibleLayers = computed(() => {
  const layers = props.model?.layerColumns ?? []
  if (!nonZeroOnly.value) return layers
  return layers.filter(
    (_, index) => (props.model?.totalByLayer[index] ?? 0) > 0,
  )
})

const visibleTypes = computed(() => {
  const types = props.model?.types ?? []
  if (!nonZeroOnly.value) return types
  return types.filter((type) => type.total > 0)
})

function toggleType(name: string): void {
  selectedTypeName.value = selectedTypeName.value === name ? null : name
}

const heroTitle = computed(() => {
  if (!related.value.drcStepName) return 'DRC step unavailable'
  return isClean.value ? `${related.value.drcStepName} is clean` : `${related.value.drcStepName} violations`
})

function formatCount(value: number | null): string {
  return value === null ? '—' : String(value)
}

function toneClass(value: number | null): string {
  if (value === null) return ''
  return value === 0 ? 'is-clean' : 'is-dirty'
}

function layerIndexOf(layer: string): number {
  return props.model?.layerColumns.indexOf(layer) ?? -1
}

function typeShare(total: number): number {
  const all = props.model?.totalCount ?? 0
  if (!all) return 0
  return (total / all) * 100
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
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

.drc-hero-row {
  align-items: stretch;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1.2fr) minmax(160px, 0.8fr);
}

.drc-hero {
  align-items: center;
  border-radius: 10px;
  display: flex;
  gap: 14px;
  padding: 12px 18px;
  text-align: left;
  width: 100%;
}

.drc-related {
  display: grid;
  gap: 8px;
}

.drc-related-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  text-align: left;
}

.drc-related-card span {
  color: var(--text-secondary);
  font-size: 10px;
}

.drc-related-card strong {
  color: var(--text-primary);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.drc-related-card.is-clean strong {
  color: var(--success-color);
}

.drc-related-card.is-dirty strong {
  color: var(--danger-color);
}

@media (max-width: 720px) {
  .drc-hero-row {
    grid-template-columns: 1fr;
  }
}

.drc-hero.is-clean {
  background: color-mix(in srgb, var(--success-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--success-color) 45%, var(--border-color));
}

.drc-hero.is-dirty {
  background: color-mix(in srgb, var(--danger-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger-color) 45%, var(--border-color));
}

.drc-count {
  color: var(--text-primary);
  font-size: 30px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.drc-hero.is-clean .drc-count {
  color: var(--success-color);
}

.drc-hero.is-dirty .drc-count {
  color: var(--danger-color);
}

.drc-status {
  color: var(--text-secondary);
  font-size: 11px;
}

.drc-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.drc-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.drc-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.drc-hint {
  color: var(--text-secondary);
  font-size: 9px;
}

.drc-mode {
  align-items: center;
  display: inline-flex;
  gap: 4px;
}

.drc-chip {
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 8px;
}

.drc-chip.is-active {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-color, #3b82f6) 62%, var(--border-color));
  color: var(--text-primary);
}

.drc-clean-baseline {
  align-items: center;
  color: var(--success-color);
  display: flex;
  font-size: 11px;
  gap: 6px;
  justify-content: center;
  margin: 0;
}

.drc-type-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  padding: 0;
}

.drc-type-list li {
  align-items: center;
  border-radius: 6px;
  cursor: pointer;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(90px, 1.2fr) minmax(60px, 2fr) 40px 44px minmax(70px, 0.8fr);
  padding: 2px 4px;
}

.drc-type-list li.is-active {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 14%, transparent);
}

.drc-type-name {
  color: var(--text-primary);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drc-type-bar {
  background: color-mix(in srgb, var(--border-color) 60%, transparent);
  border-radius: 4px;
  display: block;
  height: 6px;
  overflow: hidden;
}

.drc-type-bar span {
  background: var(--danger-color);
  display: block;
  height: 100%;
}

.drc-type-count,
.drc-type-share {
  color: var(--text-primary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.drc-type-share {
  color: var(--text-secondary);
}

.drc-type-layer {
  color: var(--text-secondary);
  font-size: 9px;
  text-align: right;
}

.drc-toggle {
  align-items: center;
  color: var(--text-secondary);
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
}

.drc-matrix-scroll {
  overflow-x: auto;
}

.drc-matrix {
  border-collapse: collapse;
  font-size: 10px;
  min-width: 100%;
}

.drc-matrix th,
.drc-matrix td {
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 3px 6px;
  text-align: right;
  white-space: nowrap;
}

.drc-matrix thead th {
  color: var(--text-secondary);
  font-weight: 600;
}

.drc-type-col {
  background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
  color: var(--text-secondary);
  font-weight: 600;
  left: 0;
  position: sticky;
  text-align: left;
  z-index: 1;
}

.drc-matrix td.is-hot {
  background: color-mix(in srgb, var(--danger-color) 16%, transparent);
  color: var(--danger-color);
  font-weight: 700;
}

.drc-row-total,
.drc-total-row td,
.drc-total-row th {
  font-weight: 700;
}

.drc-total-row {
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
}
</style>
