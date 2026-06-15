<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { useWorkspace } from '@/composables/useWorkspace'
import { loadTechLibrary } from '@/applications/editor/tech-library/loader'
import type {
  TechCellMaster,
  TechLayer,
  TechLibraryData,
  TechSite,
  TechViaMaster,
} from '@/applications/editor/tech-library/types'
import TechPreviewCanvas from '@/components/TechPreviewCanvas.vue'

type TechSection = 'overview' | 'layers' | 'sites' | 'vias' | 'cells'
type SelectableTech = TechLayer | TechSite | TechViaMaster | TechCellMaster | null

interface TechSectionConfig {
  id: TechSection
  label: string
  shortLabel: string
  icon: string
}

const sections: TechSectionConfig[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: 'ri-dashboard-3-line' },
  { id: 'layers', label: 'Layers', shortLabel: 'Layers', icon: 'ri-stack-line' },
  { id: 'sites', label: 'Sites', shortLabel: 'Sites', icon: 'ri-grid-line' },
  { id: 'vias', label: 'Via Masters', shortLabel: 'Vias', icon: 'ri-node-tree' },
  { id: 'cells', label: 'Cell Masters', shortLabel: 'Cells', icon: 'ri-layout-grid-2-line' },
]

const { currentProject, resourceVersions } = useWorkspace()
const activeSection = ref<TechSection>('overview')
const search = ref('')
const techData = ref<TechLibraryData | null>(null)
const selected = ref<SelectableTech>(null)
const isLoading = ref(false)
const error = ref('')

function itemName(item: SelectableTech): string {
  return item && 'name' in item ? item.name : ''
}

function matchesSearch(item: SelectableTech): boolean {
  const query = search.value.trim().toLowerCase()
  if (!query) return true
  return itemName(item).toLowerCase().includes(query)
}

function sectionCount(section: TechSection): number | null {
  const data = techData.value
  if (!data) return null
  switch (section) {
    case 'layers':
      return data.summary.layerCount
    case 'sites':
      return data.summary.siteCount
    case 'vias':
      return data.summary.viaCount
    case 'cells':
      return data.summary.cellMasterCount
    default:
      return null
  }
}

const activeSectionConfig = computed(() =>
  sections.find((section) => section.id === activeSection.value) ?? sections[0],
)
const resourceSections = computed(() =>
  sections.filter((section) => section.id !== 'overview'),
)

const activeRows = computed(() => {
  const data = techData.value
  if (!data) return []
  switch (activeSection.value) {
    case 'layers':
      return data.layers.filter(matchesSearch)
    case 'sites':
      return data.sites.filter(matchesSearch)
    case 'vias':
      return data.vias.filter(matchesSearch)
    case 'cells':
      return data.cellMasters.filter(matchesSearch)
    default:
      return []
  }
})

const selectedVia = computed(() =>
  activeSection.value === 'vias' ? selected.value as TechViaMaster | null : null,
)
const selectedCell = computed(() =>
  activeSection.value === 'cells' ? selected.value as TechCellMaster | null : null,
)
const previewMode = computed<'cell' | 'via' | 'empty'>(() => {
  if (selectedCell.value) return 'cell'
  if (selectedVia.value) return 'via'
  return 'empty'
})
const hasPreview = computed(() =>
  activeSection.value === 'vias' || activeSection.value === 'cells',
)
const detailEmptyText = computed(() => {
  switch (activeSection.value) {
    case 'layers':
      return 'Select a layer to inspect routing attributes.'
    case 'sites':
      return 'Select a site to inspect placement properties.'
    case 'vias':
      return 'Select a via master to inspect geometry.'
    case 'cells':
      return 'Select a cell master to inspect geometry.'
    default:
      return 'Select a row to inspect properties.'
  }
})

const sourceLabel = computed(() => {
  const root = techData.value?.summary.packageRoot
  if (!root) return 'No package'
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts.slice(-4).join('/')
})

const tableHeader = computed(() => {
  switch (activeSection.value) {
    case 'layers':
      return ['ID', 'Name', 'Type', 'Direction']
    case 'sites':
      return ['ID', 'Name', 'Class', 'Size']
    case 'vias':
      return ['ID', 'Name', 'Type', 'Cuts']
    case 'cells':
      return ['ID', 'Name', 'Site', 'Footprint']
    default:
      return []
  }
})

const overviewRows = computed(() => {
  const data = techData.value
  if (!data) return []
  return [
    ['Design', data.summary.design || 'Unknown'],
    ['PDK', data.summary.pdk || 'Unknown'],
    ['Package root', data.summary.packageRoot],
    ['Source', 'iEDA view package tech files'],
  ]
})

const detailRows = computed(() => {
  const item = selected.value
  if (!item) return []
  if (activeSection.value === 'layers') {
    const layer = item as TechLayer
    return [
      ['ID', String(layer.id)],
      ['Name', layer.name],
      ['Type', layer.type],
      ['Order', String(layer.order)],
      ['Direction', layer.direction || 'none'],
    ]
  }
  if (activeSection.value === 'sites') {
    const site = item as TechSite
    return [
      ['ID', String(site.id)],
      ['Name', site.name],
      ['Class', site.class],
      ['Size', site.size.join(' x ')],
      ['Orient', site.orient],
      ['Symmetry', site.symmetry.length ? site.symmetry.join(', ') : 'none'],
    ]
  }
  if (activeSection.value === 'vias') {
    const via = item as TechViaMaster
    return [
      ['ID', String(via.id)],
      ['Name', via.name],
      ['Type', via.type],
      ['Default', via.is_default ? 'yes' : 'no'],
      ['Cut array', `${via.cut_rows} x ${via.cut_cols}`],
      ['Layer shapes', String(via.shapes.length)],
    ]
  }
  const cell = item as TechCellMaster
  return [
    ['ID', String(cell.id)],
    ['Name', cell.name],
    ['Type', cell.type],
    ['Site', cell.site],
    ['Origin', cell.origin.join(', ')],
    ['Size', cell.size.join(' x ')],
    ['Pins', String(cell.pins.length)],
    ['Obs layers', String(cell.obs.length)],
  ]
})

function rowCells(row: Exclude<SelectableTech, null>): [string, string, string, string] {
  if (activeSection.value === 'layers') {
    const layer = row as TechLayer
    return [String(layer.id), layer.name, layer.type, layer.direction || 'none']
  }
  if (activeSection.value === 'sites') {
    const site = row as TechSite
    return [String(site.id), site.name, site.class, site.size.join(' x ')]
  }
  if (activeSection.value === 'vias') {
    const via = row as TechViaMaster
    return [String(via.id), via.name, via.type, `${via.cut_rows} x ${via.cut_cols}`]
  }
  const cell = row as TechCellMaster
  return [String(cell.id), cell.name, cell.site, cell.size.join(' x ')]
}

function selectFirstVisibleRow(): void {
  selected.value = activeSection.value === 'overview' ? null : activeRows.value[0] as SelectableTech ?? null
}

function setSection(section: TechSection): void {
  activeSection.value = section
  search.value = ''
  selected.value = null
}

async function loadTech(): Promise<void> {
  const projectPath = currentProject.value?.path
  if (!projectPath) {
    techData.value = null
    error.value = 'Open a workspace to inspect its Tech Library.'
    return
  }

  isLoading.value = true
  error.value = ''
  try {
    const index = await getWorkspaceResourceIndexApi()
    techData.value = await loadTechLibrary(index, { projectPath })
    selectFirstVisibleRow()
  } catch (err) {
    techData.value = null
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
  }
}

watch(activeSection, selectFirstVisibleRow)
watch(search, selectFirstVisibleRow)
watch(
  () => [currentProject.value?.path, resourceVersions.value.all, resourceVersions.value.home] as const,
  () => void loadTech(),
)

onMounted(() => {
  void loadTech()
})
</script>

<template>
  <div class="tech-library-view">
    <header class="tech-topbar">
      <div class="title-block">
        <h1>Tech Library</h1>
        <div class="source-pill" :title="techData?.summary.packageRoot || ''">
          <i class="ri-database-2-line"></i>
          <span>{{ techData ? sourceLabel : 'Workspace tech package' }}</span>
        </div>
      </div>
      <button class="reload-button" type="button" :disabled="isLoading" @click="loadTech">
        <i :class="isLoading ? 'ri-loader-4-line spin' : 'ri-refresh-line'"></i>
        <span>Reload</span>
      </button>
    </header>

    <main
      v-if="techData"
      class="tech-workbench"
      :class="{ overview: activeSection === 'overview' }"
    >
      <aside class="tech-nav" aria-label="Tech Library sections">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          class="nav-item"
          :class="{ active: activeSection === section.id }"
          @click="setSection(section.id)"
        >
          <span class="nav-label">
            <i :class="section.icon"></i>
            <span>{{ section.label }}</span>
          </span>
          <span v-if="sectionCount(section.id) !== null" class="count-badge">
            {{ sectionCount(section.id) }}
          </span>
        </button>
      </aside>

      <section class="tech-main">
        <div class="summary-bar">
          <div class="summary-source">
            <span class="summary-label">PDK</span>
            <strong>{{ techData.summary.pdk || 'Unknown' }}</strong>
            <span>{{ techData.summary.design || 'Unknown design' }}</span>
          </div>
          <div class="summary-metrics" aria-label="Tech resource counts">
            <div>
              <span>Layers</span>
              <strong>{{ techData.summary.layerCount }}</strong>
            </div>
            <div>
              <span>Sites</span>
              <strong>{{ techData.summary.siteCount }}</strong>
            </div>
            <div>
              <span>Vias</span>
              <strong>{{ techData.summary.viaCount }}</strong>
            </div>
            <div>
              <span>Cells</span>
              <strong>{{ techData.summary.cellMasterCount }}</strong>
            </div>
          </div>
        </div>

        <div v-if="activeSection === 'overview'" class="overview-panel">
          <section class="package-summary">
            <div class="panel-heading">
              <i class="ri-file-list-3-line"></i>
              <div>
                <h2>Package Summary</h2>
                <p>Workspace-level technology data loaded from the view package.</p>
              </div>
            </div>
            <dl class="overview-list">
              <div v-for="[key, value] in overviewRows" :key="key">
                <dt>{{ key }}</dt>
                <dd :class="{ selectable: key === 'Package root' }">{{ value }}</dd>
              </div>
            </dl>
          </section>

          <section class="resource-summary" aria-label="Tech Library resources">
            <div class="resource-summary-header">
              <span>Resources</span>
              <strong>4 groups</strong>
            </div>
            <button
              v-for="section in resourceSections"
              :key="section.id"
              type="button"
              class="resource-row"
              @click="setSection(section.id)"
            >
              <span class="resource-name">
                <i :class="section.icon"></i>
                <span>{{ section.label }}</span>
              </span>
              <strong>{{ sectionCount(section.id) }}</strong>
              <i class="ri-arrow-right-s-line"></i>
            </button>
          </section>
        </div>

        <template v-else>
          <div class="table-toolbar">
            <div class="section-title">
              <i :class="activeSectionConfig.icon"></i>
              <div>
                <h2>{{ activeSectionConfig.label }}</h2>
                <span>{{ activeRows.length }} shown</span>
              </div>
            </div>
            <label class="search-box">
              <i class="ri-search-line"></i>
              <input v-model="search" type="search" placeholder="Search by name" />
            </label>
          </div>

          <div class="data-table" role="grid" :aria-label="activeSectionConfig.label">
            <div class="data-table-header" role="row">
              <span v-for="column in tableHeader" :key="column" role="columnheader">{{ column }}</span>
            </div>
            <div v-if="activeRows.length" class="data-table-body" role="rowgroup">
              <button
                v-for="row in activeRows"
                :key="`${activeSection}-${'id' in row ? row.id : itemName(row)}`"
                type="button"
                class="data-row"
                :class="{ selected: selected === row }"
                role="row"
                :aria-selected="selected === row"
                @click="selected = row"
              >
                <span
                  v-for="(cell, index) in rowCells(row)"
                  :key="`${index}-${cell}`"
                  :class="index === 0 ? 'row-id' : index === 1 ? 'row-name' : 'row-meta'"
                  role="gridcell"
                >
                  {{ cell }}
                </span>
              </button>
            </div>
            <div v-else class="table-empty">
              <i class="ri-search-eye-line"></i>
              <span>No {{ activeSectionConfig.shortLabel.toLowerCase() }} match this search.</span>
            </div>
          </div>
        </template>
      </section>

      <aside
        v-if="activeSection !== 'overview'"
        class="tech-inspector"
        :class="{ fieldsOnly: !hasPreview }"
      >
        <section v-if="hasPreview" class="preview-panel">
          <div class="inspector-heading">
            <div>
              <span>Preview</span>
              <strong>{{ selected ? itemName(selected) : 'No selection' }}</strong>
            </div>
            <span class="mode-chip">{{ previewMode }}</span>
          </div>
          <TechPreviewCanvas
            :mode="previewMode"
            :cell="selectedCell"
            :via="selectedVia"
            :layers="techData.layers"
          />
        </section>

        <section class="inspector-fields">
          <div class="inspector-heading">
            <div>
              <span>Inspector</span>
              <strong>{{ activeSectionConfig.label }}</strong>
            </div>
          </div>
          <dl v-if="detailRows.length" class="detail-list">
            <div v-for="[key, value] in detailRows" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <p v-else class="detail-empty">{{ detailEmptyText }}</p>
        </section>
      </aside>
    </main>

    <main v-else class="empty-state">
      <i :class="isLoading ? 'ri-loader-4-line spin' : 'ri-database-2-line'"></i>
      <h2>{{ isLoading ? 'Loading Tech Library' : 'No Tech Library Available' }}</h2>
      <p>{{ error || 'Expected a view package such as gcd_view or place_dreamplace/output/gcd_place_view.' }}</p>
    </main>
  </div>
</template>

<style scoped>
.tech-library-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.tech-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 62px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary));
}

.title-block {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
}

h1,
h2 {
  margin: 0;
  letter-spacing: 0;
}

h1 {
  font-size: 20px;
  font-weight: 760;
}

h2 {
  font-size: 15px;
  font-weight: 760;
}

.source-pill,
.reload-button,
.mode-chip {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.source-pill {
  display: inline-flex;
  min-width: 0;
  max-width: min(520px, 48vw);
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.source-pill span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-pill i {
  color: var(--accent-color);
}

.reload-button,
.nav-item,
.data-row,
.resource-row {
  border: 0;
  font: inherit;
}

.reload-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  cursor: pointer;
}

.reload-button:hover {
  border-color: color-mix(in srgb, var(--accent-color) 48%, var(--border-color));
}

.reload-button:active,
.nav-item:active,
.data-row:active,
.resource-row:active {
  transform: translateY(1px);
}

.reload-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.reload-button:focus-visible,
.nav-item:focus-visible,
.data-row:focus-visible,
.resource-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 58%, transparent);
  outline-offset: -2px;
}

.tech-workbench {
  display: grid;
  grid-template-columns: 196px minmax(420px, 1fr) 390px;
  min-height: 0;
  flex: 1;
}

.tech-workbench.overview {
  grid-template-columns: 196px minmax(620px, 1fr);
}

.tech-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-right: 1px solid var(--border-color);
  background: var(--bg-sidebar);
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background 140ms ease, color 140ms ease;
}

.nav-item:hover {
  background: color-mix(in srgb, var(--bg-primary) 72%, var(--bg-secondary));
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 32%, var(--border-color));
}

.nav-label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.nav-label span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-item.active i {
  color: var(--accent-color);
}

.count-badge {
  min-width: 30px;
  max-width: 58px;
  overflow: hidden;
  text-align: right;
  color: var(--text-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tech-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.summary-bar {
  display: grid;
  grid-template-columns: minmax(210px, 0.95fr) minmax(320px, 1.55fr);
  min-height: 72px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.summary-source {
  display: grid;
  align-content: center;
  gap: 2px;
  padding: 12px 16px;
  border-right: 1px solid var(--border-color);
}

.summary-label,
.summary-metrics span,
.inspector-heading span,
dt {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.summary-source strong {
  font-size: 18px;
}

.summary-source > span:last-child {
  color: var(--text-secondary);
  font-size: 12px;
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.summary-metrics div {
  display: grid;
  align-content: center;
  gap: 3px;
  padding: 12px 14px;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}

.summary-metrics div:last-child {
  border-right: 0;
}

.summary-metrics strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.overview-panel {
  display: grid;
  grid-template-columns: minmax(320px, 1.1fr) minmax(260px, 0.9fr);
  gap: 16px;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.package-summary,
.inspector-fields,
.preview-panel {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.package-summary {
  min-width: 0;
  padding: 16px;
}

.panel-heading,
.inspector-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading {
  justify-content: flex-start;
  margin-bottom: 18px;
}

.panel-heading i {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--accent-color) 30%, var(--border-color));
  border-radius: 8px;
  color: var(--accent-color);
}

.panel-heading p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.overview-list,
.detail-list {
  display: grid;
  gap: 0;
  margin: 0;
}

.overview-list div,
.detail-list div {
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  padding: 9px 0;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}

dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.resource-summary {
  display: grid;
  align-content: start;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.resource-summary-header,
.resource-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(42px, auto) 20px;
  align-items: center;
  gap: 12px;
}

.resource-summary-header {
  min-height: 40px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-color);
}

.resource-summary-header span {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.resource-summary-header strong {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 560;
}

.resource-row {
  display: grid;
  min-height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.resource-row:last-child {
  border-bottom: 0;
}

.resource-row:hover {
  background: color-mix(in srgb, var(--accent-color) 7%, transparent);
}

.resource-name {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.resource-name i {
  color: var(--accent-color);
  font-size: 16px;
}

.resource-name span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 620;
}

.resource-row strong {
  text-align: right;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.resource-row > i:last-child {
  color: var(--text-secondary);
  justify-self: end;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}

.section-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.section-title i {
  color: var(--accent-color);
  font-size: 18px;
}

.section-title span {
  color: var(--text-secondary);
  font-size: 12px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(300px, 48%);
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.search-box:focus-within {
  border-color: color-mix(in srgb, var(--accent-color) 56%, var(--border-color));
}

.search-box input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
}

.data-table {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.data-table-header,
.data-row {
  display: grid;
  grid-template-columns: 70px minmax(180px, 1.2fr) minmax(110px, 0.7fr) minmax(120px, 0.8fr);
  align-items: center;
  gap: 12px;
}

.data-table-header {
  min-height: 32px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 82%, var(--bg-primary));
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.data-table-body {
  min-height: 0;
  overflow: auto;
}

.data-row {
  width: 100%;
  min-height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 64%, transparent);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, box-shadow 120ms ease;
}

.data-row:hover {
  background: color-mix(in srgb, var(--accent-color) 7%, transparent);
}

.data-row.selected {
  background: color-mix(in srgb, var(--accent-color) 11%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 44%, var(--border-color));
}

.row-id {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.row-name,
.row-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-name {
  font-weight: 680;
}

.row-meta {
  color: var(--text-secondary);
  font-size: 12px;
}

.table-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.tech-inspector {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 12px;
  border-left: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary));
}

.tech-inspector.fieldsOnly {
  background: var(--bg-primary);
}

.preview-panel,
.inspector-fields {
  min-width: 0;
  padding: 12px;
}

.preview-panel {
  display: grid;
  gap: 10px;
}

.inspector-heading strong {
  display: block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.mode-chip {
  padding: 3px 7px;
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: capitalize;
}

.inspector-fields {
  display: grid;
  gap: 12px;
}

.detail-empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  text-align: center;
  padding: 24px;
}

.empty-state i {
  color: var(--accent-color);
  font-size: 34px;
}

.empty-state h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
}

.empty-state p {
  max-width: 520px;
  margin: 0;
  font-size: 13px;
}

.selectable {
  user-select: text;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@media (max-width: 1180px) {
  .tech-workbench {
    grid-template-columns: 172px minmax(360px, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(280px, 38%);
  }

  .tech-workbench.overview {
    grid-template-rows: minmax(0, 1fr);
  }

  .tech-nav {
    grid-row: 1 / 3;
  }

  .tech-workbench.overview .tech-nav {
    grid-row: 1;
  }

  .tech-inspector {
    grid-column: 2;
    flex-direction: row;
    border-top: 1px solid var(--border-color);
    border-left: 0;
  }

  .preview-panel,
  .inspector-fields {
    flex: 1 1 0;
  }
}

@media (max-width: 820px) {
  .tech-topbar,
  .table-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .title-block {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .source-pill,
  .search-box {
    width: 100%;
    max-width: none;
  }

  .tech-workbench {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .tech-workbench.overview {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .tech-nav {
    grid-row: auto;
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .nav-item {
    flex: 0 0 auto;
  }

  .summary-bar,
  .overview-panel {
    grid-template-columns: 1fr;
  }

  .data-table-header,
  .data-row {
    grid-template-columns: 54px minmax(150px, 1fr) minmax(112px, 0.7fr) minmax(112px, 0.7fr);
  }

  .tech-inspector {
    grid-column: auto;
    flex-direction: column;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
