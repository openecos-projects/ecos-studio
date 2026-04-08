<template>
  <div class="resource-manager-view">
    <div class="blurred-home" aria-hidden="true">
      <div class="blurred-brand">
        <i class="ri-cpu-line"></i>
        <span>ECOS Studio</span>
      </div>
      <div class="blurred-cards">
        <div class="blurred-card"></div>
        <div class="blurred-card"></div>
        <div class="blurred-card is-active"></div>
      </div>
      <div class="blurred-lines">
        <div></div>
        <div></div>
        <div></div>
      </div>
    </div>

    <div class="manager-scrim" aria-hidden="true"></div>

    <section class="manager-dialog" aria-labelledby="resource-manager-title">
      <button type="button" class="manager-close" aria-label="Close resource manager" @click="goHome">
        <i class="ri-close-line" aria-hidden="true"></i>
      </button>

      <header class="manager-header">
        <h1 id="resource-manager-title">Resource Manager</h1>
        <p>Discover, install, and manage EDA tools and PDKs</p>
      </header>

      <div class="manager-grid">
        <aside class="manager-sidebar" aria-label="Resource categories">
          <nav class="resource-nav">
            <button
              v-for="item in sidebarItems"
              :key="item.id"
              type="button"
              class="resource-nav-item"
              :class="{ active: categoryFilter === item.id }"
              @click="categoryFilter = item.id"
            >
              <i :class="item.icon" aria-hidden="true"></i>
              <span>{{ item.label }}</span>
              <b>{{ item.count }}</b>
            </button>
          </nav>

          <div class="manager-help">
            <div class="help-icon">
              <i class="ri-question-line" aria-hidden="true"></i>
            </div>
            <div>
              <strong>Need help?</strong>
              <p>Learn how to add and manage resources.</p>
            </div>
            <button type="button" @click="openDocs">
              View Documentation
              <i class="ri-external-link-line" aria-hidden="true"></i>
            </button>
          </div>
        </aside>

        <main class="manager-table-panel">
          <div class="manager-toolbar">
            <label class="resource-search">
              <i class="ri-search-line" aria-hidden="true"></i>
              <input v-model="searchQuery" type="text" placeholder="Search resources..." />
            </label>

            <div class="resource-tabs" role="tablist" aria-label="Resource status filters">
              <button
                v-for="tab in tabItems"
                :key="tab.id"
                type="button"
                :class="{ active: statusFilter === tab.id }"
                @click="statusFilter = tab.id"
              >
                {{ tab.label }}
                <span v-if="tab.badge">{{ tab.badge }}</span>
              </button>
            </div>
          </div>

          <div class="manager-table-meta">
            <strong>{{ filteredRows.length }} Resources</strong>
            <button
              type="button"
              :disabled="pluginStore.refreshing"
              @click="pluginStore.refresh()"
            >
              <i
                :class="pluginStore.refreshing ? 'ri-loader-4-line spin' : 'ri-refresh-line'"
                aria-hidden="true"
              ></i>
              Refresh
            </button>
          </div>

          <div v-if="pluginStore.error" class="resource-error">
            {{ pluginStore.error }}
          </div>

          <div class="resource-table-scroll">
            <div class="resource-table">
              <div class="resource-table-head">
                <span></span>
                <span>Name</span>
                <span>Version</span>
                <span>Size</span>
                <span>Platform</span>
                <span>Status</span>
                <span></span>
              </div>

              <div v-if="pluginStore.loading" class="resource-loading">
                <i class="ri-loader-4-line spin" aria-hidden="true"></i>
                Loading resources...
              </div>

              <template v-else>
                <button
                  v-for="row in filteredRows"
                  :key="row.id"
                  type="button"
                  class="resource-row"
                  :class="{ selected: isSelected(row.id) }"
                  :style="{ '--row-accent': row.accent }"
                  @click="toggleResource(row.id)"
                >
                  <span class="resource-check" :class="{ checked: isSelected(row.id) }">
                    <i v-if="isSelected(row.id)" class="ri-check-line" aria-hidden="true"></i>
                  </span>

                  <span class="resource-name-cell">
                    <span class="resource-avatar">{{ row.icon }}</span>
                    <span class="resource-copy">
                      <strong>{{ row.name }}</strong>
                      <small>{{ row.description }}</small>
                    </span>
                  </span>

                  <span class="resource-muted">{{ row.version }}</span>
                  <span class="resource-muted">{{ row.sizeLabel }}</span>
                  <span><b class="platform-pill">{{ row.platform }}</b></span>
                  <span>
                    <b class="status-pill" :class="row.statusKind">{{ row.statusText }}</b>
                    <span v-if="row.progressPercent !== null" class="mini-progress">
                      <span :style="{ width: `${row.progressPercent}%` }"></span>
                    </span>
                  </span>
                  <span class="row-menu">
                    <i class="ri-more-2-fill" aria-hidden="true"></i>
                  </span>
                </button>
              </template>

              <div v-if="!pluginStore.loading && filteredRows.length === 0" class="resource-empty">
                No resources match the current filters.
              </div>
            </div>
          </div>

          <footer class="table-footer">
            <span>Showing {{ filteredRows.length === 0 ? 0 : 1 }} to {{ filteredRows.length }} of {{ resourceRows.length }} resources</span>
            <div class="pager">
              <button type="button" disabled><i class="ri-arrow-left-s-line" aria-hidden="true"></i></button>
              <button type="button" class="active">1</button>
              <button type="button" disabled><i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>
            </div>
          </footer>
        </main>

        <aside class="selected-panel" aria-label="Selected resources">
          <h2>Selected Resources <span>({{ selectedResources.length }})</span></h2>

          <div class="selected-list">
            <div v-if="selectedResources.length === 0" class="selected-empty">
              Select resources from the table.
            </div>

            <div
              v-for="row in selectedResources"
              :key="row.id"
              class="selected-item"
              :style="{ '--row-accent': row.accent }"
            >
              <span class="resource-avatar compact">{{ row.icon }}</span>
              <span>
                <strong>{{ row.name }}</strong>
                <small>
                  <b v-if="row.statusKind === 'update'">Update</b>
                  <span v-else-if="row.statusKind === 'installing'">{{ row.statusText }}</span>
                  <span v-else>{{ row.version }}</span>
                </small>
              </span>
              <em>{{ row.sizeLabel }}</em>
              <button type="button" aria-label="Remove selected resource" @click.stop="removeSelected(row.id)">
                <i class="ri-close-line" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <div class="total-size">
            <span>Estimated Total Size</span>
            <strong>{{ totalSizeText }}</strong>
          </div>

          <div class="install-location">
            <span>Install Location</span>
            <div>
              <i class="ri-folder-line" aria-hidden="true"></i>
              <code>~/.ecos/tools</code>
              <button type="button">Change</button>
            </div>
          </div>

          <p class="manager-note">
            <i class="ri-information-line" aria-hidden="true"></i>
            Updates will replace the existing installed versions.
          </p>

          <div class="selected-actions">
            <button
              type="button"
              class="download-button"
              :disabled="selectedResources.length === 0"
              @click="downloadSelected"
            >
              <i class="ri-download-line" aria-hidden="true"></i>
              <span>
                Download Selected ({{ selectedResources.length }})
                <small>{{ totalSizeText }}</small>
              </span>
            </button>
            <button type="button" class="cancel-button" @click="goHome">Cancel</button>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { usePluginStore } from '@/stores/pluginStore'
import { usePdkManager } from '@/composables/usePdkManager'
import type { ToolInfo, ToolStatus } from '@/api/plugin'

type CategoryFilter = 'all' | 'tools' | 'pdks' | 'installed'
type StatusFilter = 'all' | 'available' | 'installed' | 'updates'
type ResourceType = 'tool' | 'pdk'
type StatusKind = 'available' | 'installed' | 'update' | 'installing' | 'error'

interface ResourceRow {
  id: string
  type: ResourceType
  name: string
  description: string
  version: string
  sizeLabel: string
  sizeMb: number
  platform: string
  statusText: string
  statusKind: StatusKind
  icon: string
  accent: string
  progressPercent: number | null
  tool?: ToolInfo
}

interface ResourceMeta {
  icon: string
  accent: string
  sizeMb: number
  sizeLabel: string
}

const router = useRouter()
const pluginStore = usePluginStore()
const { importedPdks, loadPdks, importPdk } = usePdkManager()

const searchQuery = ref('')
const categoryFilter = ref<CategoryFilter>('all')
const statusFilter = ref<StatusFilter>('all')
const selectedResourceIds = ref<Set<string>>(new Set())

const toolMeta: Record<string, ResourceMeta> = {
  openroad: { icon: 'O', accent: '#79c142', sizeMb: 245, sizeLabel: '245 MB' },
  yosys: { icon: 'Y', accent: '#63666d', sizeMb: 68, sizeLabel: '68 MB' },
  klayout: { icon: 'K', accent: '#d99427', sizeMb: 132, sizeLabel: '132 MB' },
  magic: { icon: 'M', accent: '#6b7078', sizeMb: 54, sizeLabel: '54 MB' },
  netgen: { icon: 'N', accent: '#607d8b', sizeMb: 42, sizeLabel: '42 MB' },
  verilator: { icon: 'V', accent: '#4b87c5', sizeMb: 96, sizeLabel: '96 MB' },
  iverilog: { icon: 'I', accent: '#4f7f75', sizeMb: 44, sizeLabel: '44 MB' },
}

const pdkCatalog = [
  {
    key: 'sky130',
    name: 'Sky130',
    description: 'SkyWater 130nm PDK',
    version: 'v0.9.1',
    sizeMb: 1147,
    sizeLabel: '1.12 GB',
    icon: 'S',
    accent: '#6b7078',
  },
  {
    key: 'gf180',
    name: 'GF180',
    description: 'GlobalFoundries 180nm PDK',
    version: 'v1.8.0',
    sizeMb: 2406,
    sizeLabel: '2.35 GB',
    icon: 'G',
    accent: '#6b7078',
  },
  {
    key: 'ics55',
    name: 'ics55',
    description: 'Integrated Circuit Systems 55nm PDK',
    version: 'v1.01',
    sizeMb: 412,
    sizeLabel: '412 MB',
    icon: 'ics55',
    accent: '#6b7078',
  },
]

const resourceRows = computed<ResourceRow[]>(() => {
  const toolRows = pluginStore.tools.map((tool) => {
    const meta = metadataForTool(tool)
    const progress = pluginStore.installProgress[tool.name]
    const progressPercent = progress
      ? Math.max(0, Math.min(100, Math.round((progress.progress || 0) * 100)))
      : null
    const mappedStatus = mapToolStatus(tool.status, progressPercent)

    return {
      id: `tool:${tool.name}`,
      type: 'tool' as const,
      name: tool.display_name || tool.name,
      description: tool.description,
      version: versionLabel(tool),
      sizeLabel: meta.sizeLabel,
      sizeMb: meta.sizeMb,
      platform: 'Linux',
      statusText: mappedStatus.text,
      statusKind: mappedStatus.kind,
      icon: meta.icon,
      accent: meta.accent,
      progressPercent,
      tool,
    }
  })

  const knownPdkRows = pdkCatalog.map((pdk) => {
    const installed = importedPdks.value.some((item) => {
      const key = `${item.pdkId || ''} ${item.name || ''}`.toLowerCase()
      return key.includes(pdk.key)
    })

    return {
      id: `pdk:${pdk.key}`,
      type: 'pdk' as const,
      name: pdk.name,
      description: pdk.description,
      version: pdk.version,
      sizeLabel: pdk.sizeLabel,
      sizeMb: pdk.sizeMb,
      platform: 'Linux',
      statusText: installed ? 'Installed' : 'Available',
      statusKind: installed ? 'installed' as const : 'available' as const,
      icon: pdk.icon,
      accent: pdk.accent,
      progressPercent: null,
    }
  })

  const catalogKeys = new Set(pdkCatalog.map((pdk) => pdk.key))
  const customPdkRows = importedPdks.value
    .filter((pdk) => {
      const key = `${pdk.pdkId || ''} ${pdk.name || ''}`.toLowerCase()
      return !Array.from(catalogKeys).some((catalogKey) => key.includes(catalogKey))
    })
    .map((pdk) => ({
      id: `pdk:custom:${pdk.id}`,
      type: 'pdk' as const,
      name: pdk.name,
      description: pdk.description || 'Imported process design kit',
      version: pdk.techNode || 'Local',
      sizeLabel: 'Local',
      sizeMb: 0,
      platform: 'Local',
      statusText: 'Installed',
      statusKind: 'installed' as const,
      icon: pdk.name.slice(0, 5),
      accent: '#6b7078',
      progressPercent: null,
    }))

  return [...toolRows, ...knownPdkRows, ...customPdkRows]
})

const filteredRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()

  return resourceRows.value.filter((row) => {
    if (categoryFilter.value === 'tools' && row.type !== 'tool') return false
    if (categoryFilter.value === 'pdks' && row.type !== 'pdk') return false
    if (categoryFilter.value === 'installed' && !isInstalledLike(row)) return false

    if (statusFilter.value === 'available' && row.statusKind !== 'available') return false
    if (statusFilter.value === 'installed' && !isInstalledLike(row)) return false
    if (statusFilter.value === 'updates' && row.statusKind !== 'update') return false

    if (!q) return true
    return `${row.name} ${row.description} ${row.version}`.toLowerCase().includes(q)
  })
})

const selectedResources = computed(() => {
  const selected = selectedResourceIds.value
  return resourceRows.value.filter((row) => selected.has(row.id))
})

const totalSizeMb = computed(() => {
  return selectedResources.value.reduce((sum, row) => sum + row.sizeMb, 0)
})

const totalSizeText = computed(() => formatSize(totalSizeMb.value))

const updatesCount = computed(() => resourceRows.value.filter((row) => row.statusKind === 'update').length)
const installedCount = computed(() => resourceRows.value.filter(isInstalledLike).length)

const sidebarItems = computed(() => [
  {
    id: 'all' as const,
    label: 'All Resources',
    icon: 'ri-apps-2-line',
    count: resourceRows.value.length,
  },
  {
    id: 'tools' as const,
    label: 'EDA Tools',
    icon: 'ri-record-circle-line',
    count: resourceRows.value.filter((row) => row.type === 'tool').length,
  },
  {
    id: 'pdks' as const,
    label: 'PDKs',
    icon: 'ri-record-circle-line',
    count: resourceRows.value.filter((row) => row.type === 'pdk').length,
  },
  {
    id: 'installed' as const,
    label: 'Installed',
    icon: 'ri-checkbox-line',
    count: installedCount.value,
  },
])

const tabItems = computed(() => [
  { id: 'all' as const, label: 'All', badge: 0 },
  {
    id: 'available' as const,
    label: 'Available',
    badge: resourceRows.value.filter((row) => row.statusKind === 'available').length,
  },
  { id: 'installed' as const, label: 'Installed', badge: installedCount.value },
  { id: 'updates' as const, label: 'Updates', badge: updatesCount.value },
])

watch(
  resourceRows,
  (rows) => {
    const rowIds = new Set(rows.map((row) => row.id))
    const nextSelected = new Set([...selectedResourceIds.value].filter((id) => rowIds.has(id)))

    if (nextSelected.size === 0) {
      const defaults = rows
        .filter((row) => row.statusKind === 'update' || row.statusKind === 'installing')
        .slice(0, 2)
      defaults.forEach((row) => nextSelected.add(row.id))
    }

    selectedResourceIds.value = nextSelected
  },
  { immediate: true },
)

onMounted(() => {
  void Promise.all([pluginStore.fetchTools(), loadPdks()])
})

onUnmounted(() => {
  pluginStore.cleanup()
})

function metadataForTool(tool: ToolInfo): ResourceMeta {
  const haystack = `${tool.name} ${tool.display_name}`.toLowerCase()
  const match = Object.keys(toolMeta).find((key) => haystack.includes(key))
  if (match) return toolMeta[match]

  const label = (tool.display_name || tool.name || '?').slice(0, 1).toUpperCase()
  return { icon: label, accent: '#68707d', sizeMb: 128, sizeLabel: '128 MB' }
}

function versionLabel(tool: ToolInfo): string {
  const version = tool.installed_version || tool.available_versions[0]
  if (!version) return '-'
  return `v${String(version).replace(/^v/i, '')}`
}

function mapToolStatus(status: ToolStatus, progressPercent: number | null): { kind: StatusKind; text: string } {
  switch (status) {
    case 'installed':
      return { kind: 'installed', text: 'Installed' }
    case 'update_available':
      return { kind: 'update', text: 'Update' }
    case 'installing':
      return {
        kind: 'installing',
        text: progressPercent !== null ? `Downloading ${progressPercent}%` : 'Installing',
      }
    case 'uninstalling':
      return { kind: 'installing', text: 'Removing' }
    case 'error':
      return { kind: 'error', text: 'Error' }
    default:
      return { kind: 'available', text: 'Available' }
  }
}

function isInstalledLike(row: ResourceRow): boolean {
  return row.statusKind === 'installed' || row.statusKind === 'update'
}

function isSelected(id: string): boolean {
  return selectedResourceIds.value.has(id)
}

function toggleResource(id: string): void {
  const next = new Set(selectedResourceIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedResourceIds.value = next
}

function removeSelected(id: string): void {
  const next = new Set(selectedResourceIds.value)
  next.delete(id)
  selectedResourceIds.value = next
}

async function downloadSelected(): Promise<void> {
  const rows = selectedResources.value
  const toolRows = rows.filter((row) => row.type === 'tool' && row.tool)
  const installable = toolRows.filter((row) => {
    return row.statusKind === 'available' || row.statusKind === 'update' || row.statusKind === 'error'
  })

  if (installable.length > 0) {
    await Promise.all(installable.map((row) => pluginStore.install(row.tool!.name)))
    return
  }

  if (rows.some((row) => row.type === 'pdk' && row.statusKind === 'available')) {
    await importPdk()
  }
}

function formatSize(sizeMb: number): string {
  if (sizeMb <= 0) return '0 MB'
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(2)} GB`
  return `${Math.round(sizeMb)} MB`
}

function goHome(): void {
  router.push('/')
}

async function openDocs(): Promise<void> {
  try {
    await shellOpen('https://github.com/openecos-projects/ecc/blob/main/docs/user-guide.md')
  } catch (error) {
    console.error('Failed to open documentation:', error)
  }
}
</script>

<style scoped>
.resource-manager-view {
  position: relative;
  min-height: 100%;
  overflow: auto;
  isolation: isolate;
  color: var(--text-primary);
  background: #eef2f1;
}

.blurred-home {
  position: absolute;
  inset: 0;
  overflow: hidden;
  filter: blur(2px);
  transform: scale(1.015);
  transform-origin: center;
  background:
    radial-gradient(circle at 50% 16%, rgba(0, 191, 165, 0.12), transparent 28%),
    linear-gradient(rgba(207, 216, 220, 0.5) 1px, transparent 1px),
    linear-gradient(90deg, rgba(207, 216, 220, 0.5) 1px, transparent 1px),
    #f7faf9;
  background-size: auto, 52px 52px, 52px 52px, auto;
}

.blurred-brand {
  position: absolute;
  top: 58px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 26px;
  transform: translateX(-50%);
  color: #111827;
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 0;
}

.blurred-brand i {
  color: var(--accent-color);
  font-size: 64px;
  text-shadow: 0 18px 50px rgba(0, 191, 165, 0.22);
}

.blurred-cards {
  position: absolute;
  top: 310px;
  left: 10%;
  right: 10%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.blurred-card,
.blurred-lines div {
  border: 1px solid rgba(203, 213, 225, 0.78);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 24px 90px rgba(15, 23, 42, 0.06);
}

.blurred-card {
  height: 170px;
  border-radius: 16px;
}

.blurred-card.is-active {
  border-color: rgba(0, 191, 165, 0.28);
}

.blurred-lines {
  position: absolute;
  top: 590px;
  left: 10%;
  right: 10%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 32px;
}

.blurred-lines div {
  height: 58px;
  border-radius: 12px;
}

.manager-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(17, 24, 39, 0.25);
  backdrop-filter: blur(5px);
}

.manager-dialog {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: min(1280px, calc(100% - 96px));
  height: min(760px, calc(100vh - 126px));
  min-height: 620px;
  margin: 116px auto 48px;
  padding: 36px 38px 38px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.92);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 34px 90px rgba(15, 23, 42, 0.24);
}

.manager-close {
  position: absolute;
  top: 38px;
  right: 38px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #475569;
  background: transparent;
  cursor: pointer;
  transition: color 0.16s ease, background 0.16s ease;
}

.manager-close:hover {
  color: #0f172a;
  background: rgba(15, 23, 42, 0.06);
}

.manager-header {
  flex: 0 0 auto;
  padding-right: 42px;
  margin-bottom: 28px;
}

.manager-header h1 {
  margin: 0;
  color: #111827;
  font-size: 23px;
  font-weight: 750;
  letter-spacing: 0;
}

.manager-header p {
  margin: 4px 0 0;
  color: #536176;
  font-size: 14px;
}

.manager-grid {
  display: grid;
  grid-template-columns: 225px minmax(0, 1fr) 260px;
  gap: 12px;
  min-height: 0;
  flex: 1 1 auto;
}

.manager-sidebar,
.manager-table-panel,
.selected-panel {
  min-height: 0;
  border: 1px solid #e4e9ef;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.78);
}

.manager-sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px;
}

.resource-nav {
  display: grid;
  gap: 10px;
}

.resource-nav-item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: #5b6679;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.16s ease, color 0.16s ease;
}

.resource-nav-item i {
  font-size: 16px;
}

.resource-nav-item b {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  color: #64748b;
  background: #f0f3f7;
  font-size: 11px;
  font-weight: 700;
}

.resource-nav-item.active {
  color: #009d8b;
  background: rgba(0, 191, 165, 0.12);
}

.resource-nav-item.active b {
  color: #009d8b;
  background: rgba(255, 255, 255, 0.82);
}

.manager-help {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 10px;
  padding: 16px;
  border: 1px solid #e3e9ef;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
}

.help-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  color: #00a997;
  background: rgba(0, 191, 165, 0.12);
}

.manager-help strong {
  display: block;
  color: #111827;
  font-size: 12px;
  font-weight: 750;
}

.manager-help p {
  margin: 3px 0 12px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.manager-help button {
  grid-column: 1 / -1;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  color: #00a997;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.manager-table-panel {
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.manager-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 264px) auto;
  align-items: center;
  gap: 16px;
  margin-bottom: 26px;
}

.resource-search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #dfe5eb;
  border-radius: 8px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.9);
}

.resource-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: #111827;
  background: transparent;
  font-size: 13px;
}

.resource-search input::placeholder {
  color: #94a3b8;
}

.resource-tabs {
  justify-self: end;
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 3px;
  border: 1px solid #dfe5eb;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
}

.resource-tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  color: #64748b;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}

.resource-tabs button + button::before {
  content: "";
  position: absolute;
  left: -1px;
  width: 1px;
  height: 14px;
  background: #e6ebf0;
}

.resource-tabs button.active {
  color: #00a997;
  background: rgba(0, 191, 165, 0.12);
  box-shadow: inset 0 0 0 1px rgba(0, 191, 165, 0.46);
}

.resource-tabs button.active::before,
.resource-tabs button.active + button::before {
  opacity: 0;
}

.resource-tabs span {
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  color: #009d8b;
  background: rgba(0, 191, 165, 0.16);
  font-size: 11px;
}

.manager-table-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.manager-table-meta strong {
  color: #111827;
  font-size: 13px;
  font-weight: 750;
}

.manager-table-meta button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  color: #00a997;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.manager-table-meta button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.resource-error {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #b42318;
  background: #fff1f1;
  font-size: 12px;
}

.resource-table-scroll {
  min-height: 0;
  overflow: auto;
}

.resource-table {
  min-width: 650px;
}

.resource-table-head,
.resource-row {
  display: grid;
  grid-template-columns: 32px minmax(210px, 1.55fr) 80px 78px 78px 144px 28px;
  align-items: center;
  gap: 0;
}

.resource-table-head {
  height: 34px;
  padding: 0 8px;
  border-bottom: 1px solid #dfe5eb;
  color: #64748b;
  font-size: 11px;
  font-weight: 750;
}

.resource-row {
  width: 100%;
  min-height: 62px;
  padding: 0 8px;
  border: 0;
  border-bottom: 1px solid #e7edf2;
  color: #1f2937;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.16s ease;
}

.resource-row:hover,
.resource-row.selected {
  background: rgba(0, 191, 165, 0.045);
}

.resource-check {
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: white;
  background: white;
  font-size: 13px;
}

.resource-check.checked {
  border-color: #00a997;
  background: #00bfa5;
}

.resource-name-cell,
.selected-item {
  display: flex;
  align-items: center;
  min-width: 0;
}

.resource-avatar {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: #fff;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--row-accent) 92%, white), color-mix(in srgb, var(--row-accent) 76%, black));
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.35), 0 6px 14px rgba(15, 23, 42, 0.12);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

.resource-avatar.compact {
  width: 34px;
  height: 34px;
}

.resource-copy {
  min-width: 0;
  margin-left: 12px;
}

.resource-copy strong,
.selected-item strong {
  display: block;
  overflow: hidden;
  color: #1f2937;
  font-size: 13px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-copy small,
.selected-item small {
  display: block;
  overflow: hidden;
  max-width: 260px;
  margin-top: 2px;
  color: #64748b;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-item small b {
  padding: 2px 5px;
  border-radius: 5px;
  color: #2376d9;
  background: #dbeafe;
  font-size: 10px;
  font-style: normal;
}

.resource-muted {
  color: #64748b;
  font-size: 12px;
}

.platform-pill,
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}

.platform-pill {
  color: #64748b;
  background: #f1f5f9;
}

.status-pill.installed {
  color: #00a083;
  background: rgba(0, 191, 165, 0.14);
}

.status-pill.available {
  color: #64748b;
  background: #f1f5f9;
}

.status-pill.update {
  color: #2376d9;
  background: #dbeafe;
}

.status-pill.installing {
  color: #475569;
  background: transparent;
  padding: 0;
}

.status-pill.error {
  color: #b42318;
  background: #ffe4e6;
}

.mini-progress {
  display: block;
  width: 62px;
  height: 4px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #dbeafe;
}

.mini-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2f8cf0;
}

.row-menu {
  color: #334155;
  text-align: center;
}

.resource-loading,
.resource-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 10px;
  color: #64748b;
  font-size: 13px;
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding-top: 14px;
  color: #64748b;
  font-size: 12px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pager button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid #dfe5eb;
  border-radius: 8px;
  color: #64748b;
  background: white;
}

.pager button.active {
  color: #00a997;
  border-color: rgba(0, 191, 165, 0.52);
  background: rgba(0, 191, 165, 0.08);
}

.selected-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 16px 14px;
}

.selected-panel h2 {
  margin: 0 0 20px;
  color: #111827;
  font-size: 15px;
  font-weight: 750;
}

.selected-panel h2 span {
  color: #64748b;
  font-weight: 650;
}

.selected-list {
  display: grid;
  gap: 14px;
  min-height: 116px;
}

.selected-empty {
  display: grid;
  min-height: 74px;
  place-items: center;
  border: 1px dashed #d7dee7;
  border-radius: 8px;
  color: #94a3b8;
  font-size: 12px;
}

.selected-item {
  gap: 12px;
}

.selected-item > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.selected-item em {
  color: #64748b;
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}

.selected-item button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: #64748b;
  background: transparent;
  cursor: pointer;
}

.selected-item button:hover {
  color: #0f172a;
  background: rgba(15, 23, 42, 0.06);
}

.total-size {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px -16px 0;
  padding: 16px;
  border-top: 1px solid #e7edf2;
  border-bottom: 1px solid #e7edf2;
  color: #1f2937;
  font-size: 13px;
}

.total-size span,
.install-location > span {
  color: #475569;
  font-weight: 650;
}

.total-size strong {
  font-size: 14px;
  font-weight: 800;
}

.install-location {
  padding: 16px 0 18px;
  color: #475569;
  font-size: 13px;
}

.install-location div {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
}

.install-location code {
  color: #475569;
  font-family: inherit;
  font-size: 12px;
}

.install-location button {
  border: 0;
  color: #00a997;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.manager-note {
  display: grid;
  grid-template-columns: 20px 1fr;
  align-items: start;
  gap: 10px;
  margin: 0;
  padding: 13px 14px;
  border-radius: 8px;
  color: #48616b;
  background: rgba(0, 191, 165, 0.16);
  font-size: 12px;
  line-height: 1.45;
}

.manager-note i {
  color: #00a997;
  font-size: 16px;
}

.selected-actions {
  display: grid;
  gap: 10px;
  margin-top: auto;
}

.download-button,
.cancel-button {
  width: 100%;
  min-height: 50px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 750;
}

.download-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 11px;
  border: 0;
  color: white;
  background: linear-gradient(180deg, #12c9b2 0%, #00ad98 100%);
  box-shadow: 0 12px 28px rgba(0, 191, 165, 0.26);
}

.download-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.download-button span {
  display: grid;
  gap: 1px;
  font-size: 13px;
}

.download-button small {
  font-size: 10px;
  font-weight: 750;
  opacity: 0.9;
}

.cancel-button {
  border: 1px solid #dfe5eb;
  color: #475569;
  background: white;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

:global(.dark) .resource-manager-view {
  background: #1f2328;
}

:global(.dark) .manager-scrim {
  background: rgba(0, 0, 0, 0.34);
}

:global(.dark) .manager-dialog,
:global(.dark) .manager-sidebar,
:global(.dark) .manager-table-panel,
:global(.dark) .selected-panel {
  border-color: rgba(255, 255, 255, 0.09);
  background: rgba(30, 33, 38, 0.94);
}

:global(.dark) .manager-header h1,
:global(.dark) .manager-table-meta strong,
:global(.dark) .resource-copy strong,
:global(.dark) .selected-item strong,
:global(.dark) .selected-panel h2 {
  color: #f8fafc;
}

:global(.dark) .manager-header p,
:global(.dark) .resource-muted,
:global(.dark) .resource-copy small,
:global(.dark) .selected-item small,
:global(.dark) .table-footer {
  color: #a7b0c0;
}

@media (max-width: 1120px) {
  .manager-dialog {
    width: min(980px, calc(100% - 40px));
    height: auto;
    min-height: calc(100vh - 96px);
    margin: 48px auto;
    overflow: visible;
  }

  .manager-grid {
    grid-template-columns: 1fr;
  }

  .manager-sidebar {
    flex-direction: row;
    gap: 16px;
  }

  .resource-nav {
    flex: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .manager-help {
    width: 240px;
  }
}

@media (max-width: 760px) {
  .manager-dialog {
    width: calc(100% - 24px);
    padding: 24px 18px;
  }

  .manager-sidebar {
    flex-direction: column;
  }

  .manager-help {
    width: auto;
  }

  .manager-toolbar {
    grid-template-columns: 1fr;
  }

  .resource-tabs {
    justify-self: stretch;
    overflow-x: auto;
  }
}
</style>
