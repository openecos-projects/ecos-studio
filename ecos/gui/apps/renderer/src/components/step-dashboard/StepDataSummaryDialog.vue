<template>
  <Dialog
    :visible="visible"
    class="data-summary-dialog"
    modal
    maximizable
    :header="header"
    :style="{ width: 'min(960px, calc(100vw - 40px))' }"
    :content-style="{ height: 'min(66vh, 620px)', overflow: 'hidden' }"
    :draggable="false"
    @update:visible="onVisibleUpdate"
  >
    <div v-if="railItems.length" class="data-summary">
      <nav class="data-summary-rail" aria-label="Data snapshot categories">
        <header>
          <i class="ri-dashboard-2-line" aria-hidden="true" />
          <h3>Snapshots</h3>
          <span>{{ railItems.length }}</span>
        </header>
        <ul>
          <li v-for="item in railItems" :key="item.id">
            <button
              type="button"
              :aria-current="item.id === activeRail?.id"
              :class="{ 'is-active': item.id === activeRail?.id }"
              @click="activeId = item.id"
            >
              <i :class="item.icon" aria-hidden="true" />
              <span :title="item.label">{{ item.label }}</span>
              <strong>{{ item.badge }}</strong>
            </button>
          </li>
        </ul>
      </nav>

      <section v-if="designStatisActive && designStatis" class="data-summary-pane">
        <header class="data-summary-pane-header">
          <div>
            <i class="ri-table-line" aria-hidden="true" />
            <h3>Design Statis</h3>
          </div>
          <span class="data-summary-total">
            {{ designStatis.rowCount }}
            <small>metrics</small>
          </span>
        </header>

        <div class="data-summary-pane-body data-summary-pane-body--table">
          <section
            v-for="group in designStatis.groups"
            :key="group.id"
            class="design-statis-group"
          >
            <header>
              <div>
                <i class="ri-list-check-2" aria-hidden="true" />
                <h4>{{ group.label }}</h4>
              </div>
              <span>{{ group.rows.length }} metrics</span>
            </header>
            <table class="design-statis-table">
              <tbody>
                <tr v-for="row in group.rows" :key="row.id">
                  <th scope="row" :title="row.label">{{ row.label }}</th>
                  <td>{{ row.value }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </section>

      <section v-else-if="activeModel" class="data-summary-pane">
        <header class="data-summary-pane-header">
          <div>
            <i :class="activeModel.icon" aria-hidden="true" />
            <h3>{{ activeModel.label }}</h3>
          </div>
          <span class="data-summary-total">
            {{ formatDashboardValue(activeModel.total, activeModel.unit) }}
            <small>total</small>
          </span>
        </header>

        <div class="data-summary-pane-body">
          <template v-if="activeModel.kind === 'composition'">
            <div class="data-summary-chart-card">
              <div
                class="data-summary-composition-bar"
                :aria-label="`${activeModel.label} composition`"
                role="img"
              >
                <span
                  v-for="row in activeModel.chartRows"
                  :key="row.id"
                  :class="`snapshot-slot ${row.slotClass}`"
                  :style="{ width: `${row.percentValue}%` }"
                />
              </div>
            </div>
            <div class="data-summary-rows">
              <header>
                <div>
                  <i class="ri-list-check-2" aria-hidden="true" />
                  <h4>Composition</h4>
                </div>
                <span>{{ activeModel.rows.length }} parts</span>
              </header>
              <ul>
                <li v-for="row in activeModel.rows" :key="row.id" class="has-swatch">
                  <i :class="`snapshot-slot ${row.slotClass}`" aria-hidden="true" />
                  <strong :title="row.label">{{ row.label }}</strong>
                  <span>{{ formatDashboardValue(row.value, activeModel.unit) }}</span>
                  <small>{{ row.percentLabel }}</small>
                </li>
              </ul>
            </div>
          </template>

          <template v-else>
            <div class="data-summary-chart-card">
              <StepSnapshotBars
                v-if="activeModel.chartRows.length"
                :label="`${activeModel.label} distribution`"
                :rows="activeModel.chartRows"
                :unit="barUnit"
                height="100%"
              />
              <div v-else class="data-summary-chart-empty">
                <i class="ri-bar-chart-horizontal-line" aria-hidden="true" />
                <span>No non-zero bins</span>
              </div>
            </div>
            <div class="data-summary-rows">
              <header>
                <div>
                  <i class="ri-list-check-2" aria-hidden="true" />
                  <h4>Distribution</h4>
                </div>
                <span>{{ activeModel.rows.length }} bins</span>
              </header>
              <ul>
                <li v-for="row in activeModel.rows" :key="row.id">
                  <strong :title="row.label">{{ row.label }}</strong>
                  <span>{{ formatDashboardValue(row.value, activeModel.unit) }}</span>
                  <small>{{ row.percentLabel }}</small>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </section>
    </div>
    <p v-else class="data-summary-empty">{{ emptyHint }}</p>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import type {
  StepDashboardFloorplanSnapshot,
  StepDesignStatis,
} from './stepDashboardData'
import { formatDashboardValue } from './stepDashboardData'
import { buildStepSnapshotViewModels } from './stepSnapshotSummary'
import StepSnapshotBars from './StepSnapshotBars.vue'

const DESIGN_STATIS_ID = 'design-statis'

const props = withDefaults(
  defineProps<{
    visible: boolean
    header: string
    snapshots: StepDashboardFloorplanSnapshot[]
    /** Metric table (Design Layout / Design Statis) from this step's db.json feature. */
    designStatis?: StepDesignStatis | null
    /** Snapshot the dialog should focus on when it opens; null picks the first. */
    focusId?: string | null
    emptyHint?: string
  }>(),
  {
    designStatis: null,
    focusId: null,
    emptyHint: 'No data snapshot is available for this step.',
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const models = computed(() => buildStepSnapshotViewModels(props.snapshots))

interface RailItem {
  id: string
  icon: string
  label: string
  badge: string
}

/** Design Statis leads the rail, above Instance Area and the other snapshots. */
const railItems = computed<RailItem[]>(() => {
  const items: RailItem[] = []
  if (props.designStatis) {
    items.push({
      id: DESIGN_STATIS_ID,
      icon: 'ri-table-line',
      label: 'Design Statis',
      badge: `${props.designStatis.rowCount}`,
    })
  }
  for (const model of models.value) {
    items.push({
      id: model.id,
      icon: model.icon,
      label: model.label,
      badge: formatDashboardValue(model.total, model.unit),
    })
  }
  return items
})

const activeId = ref<string | null>(null)
const activeModel = computed(
  () => models.value.find((model) => model.id === activeId.value) ?? null,
)
const designStatisActive = computed(
  () => activeId.value === DESIGN_STATIS_ID && !!props.designStatis,
)
const activeRail = computed(
  () =>
    railItems.value.find((item) => item.id === activeId.value) ??
    railItems.value[0] ??
    null,
)
/** formatDashboardValue already appends count/um² style units to values. */
const barUnit = computed(() =>
  activeModel.value?.unit === 'count' ? '' : (activeModel.value?.unit ?? ''),
)

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    const focused =
      props.focusId && railItems.value.some((item) => item.id === props.focusId)
    activeId.value = focused ? props.focusId : (railItems.value[0]?.id ?? null)
  },
  { immediate: true },
)

function onVisibleUpdate(value: boolean): void {
  emit('update:visible', value)
}
</script>

<style scoped>
.data-summary {
  display: grid;
  grid-template-columns: minmax(168px, 210px) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.data-summary-rail {
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.data-summary-rail > header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  color: var(--text-secondary);
  display: flex;
  flex: 0 0 auto;
  font-size: 12px;
  gap: 6px;
  min-height: 34px;
  padding: 6px 9px;
}
.data-summary-rail > header i {
  color: var(--accent-color);
  font-size: 13px;
}
.data-summary-rail > header h3 {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  margin: 0;
}
.data-summary-rail > header span {
  margin-left: auto;
}
.data-summary-rail ul {
  display: grid;
  gap: 3px;
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
.data-summary-rail button {
  align-items: center;
  background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  padding: 5px 7px;
  text-align: left;
  width: 100%;
}
.data-summary-rail button:hover {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  color: var(--text-primary);
}
.data-summary-rail button:focus-visible {
  outline: 1px solid var(--accent-color);
  outline-offset: -2px;
}
.data-summary-rail button.is-active {
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent-color) 55%, transparent);
  color: var(--text-primary);
}
.data-summary-rail button i {
  color: var(--accent-color);
  font-size: 13px;
}
.data-summary-rail button span {
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-summary-rail button strong {
  color: var(--text-primary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.data-summary-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.data-summary-pane-header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  justify-content: space-between;
  min-height: 36px;
  padding: 6px 10px;
}
.data-summary-pane-header > div {
  align-items: center;
  display: flex;
  gap: 6px;
  min-width: 0;
}
.data-summary-pane-header i {
  color: var(--accent-color);
  font-size: 14px;
}
.data-summary-pane-header h3 {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-summary-total {
  align-items: baseline;
  color: var(--text-primary);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 700;
  gap: 4px;
}
.data-summary-total small {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 400;
}

.data-summary-pane-body {
  display: grid;
  flex: 1;
  grid-template-rows: minmax(140px, 1fr) minmax(0, 1.1fr);
  min-height: 0;
  min-width: 0;
}
.data-summary-chart-card {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 12px 14px;
}
.data-summary-composition-bar {
  align-items: stretch;
  display: flex;
  gap: 2px;
  height: 18px;
  max-width: 640px;
  min-width: 0;
  width: 100%;
}
.data-summary-composition-bar > span {
  border-radius: 3px;
  display: block;
  min-width: 0;
}
.data-summary-composition-bar > span:first-child {
  border-radius: 3px 0 0 3px;
}
.data-summary-composition-bar > span:last-child {
  border-radius: 0 3px 3px 0;
}
.data-summary-composition-bar > span:only-child {
  border-radius: 3px;
}
.data-summary-chart-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 12px;
  gap: 5px;
  justify-content: center;
}
.data-summary-chart-empty i {
  font-size: 18px;
  opacity: 0.6;
}

/* Design Statis metric tables (Design Layout / Design Statis from db.json) */
.data-summary-pane-body--table {
  display: flex;
  flex-direction: column;
  grid-template-rows: none;
  overflow-y: auto;
}
.design-statis-group {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.design-statis-group + .design-statis-group {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}
.design-statis-group > header {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  min-height: 32px;
  padding: 5px 10px;
}
.design-statis-group > header > div {
  align-items: center;
  display: flex;
  gap: 6px;
  min-width: 0;
}
.design-statis-group > header i {
  color: var(--accent-color);
  font-size: 13px;
}
.design-statis-group h4 {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  margin: 0;
}
.design-statis-group > header > span {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.design-statis-table {
  border-collapse: collapse;
  margin: 0 10px 10px;
  min-width: 0;
  table-layout: fixed;
  width: calc(100% - 20px);
}
.design-statis-table tr {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}
.design-statis-table tr:first-child {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}
.design-statis-table th {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 400;
  overflow: hidden;
  padding: 4px 8px 4px 0;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 62%;
}
.design-statis-table td {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  padding: 4px 0 4px 8px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-summary-rows {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.data-summary-rows > header {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  min-height: 32px;
  padding: 5px 10px;
}
.data-summary-rows > header > div {
  align-items: center;
  display: flex;
  gap: 6px;
  min-width: 0;
}
.data-summary-rows > header i {
  color: var(--accent-color);
  font-size: 13px;
}
.data-summary-rows h4 {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  margin: 0;
}
.data-summary-rows > header > span {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.data-summary-rows ul {
  display: grid;
  flex: 1;
  gap: 4px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
}
.data-summary-rows li {
  align-items: center;
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-width: 0;
  padding: 5px 7px;
}
.data-summary-rows li.has-swatch {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
}
.data-summary-rows li > i.snapshot-slot {
  border-radius: 2px;
  display: block;
  height: 8px;
  width: 8px;
}
.data-summary-rows li strong {
  color: var(--text-primary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-summary-rows li > span {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.data-summary-rows li small {
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.data-summary-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}

@media (max-width: 720px) {
  .data-summary {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .data-summary-rail {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
    max-height: 168px;
  }
  .data-summary-rows ul {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.data-summary-dialog.p-dialog-maximized {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  width: 100vw;
}
.data-summary-dialog.p-dialog-maximized .p-dialog-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: auto !important;
  max-height: none !important;
  min-height: 0;
  overflow: hidden;
}
.data-summary-dialog.p-dialog-maximized .p-dialog-content > * {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
