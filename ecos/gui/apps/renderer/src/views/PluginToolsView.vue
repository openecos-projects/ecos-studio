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
              <input
                :value="searchInput"
                type="text"
                placeholder="Search"
                aria-label="Search resources"
                @input="searchInput = ($event.target as HTMLInputElement).value"
              />
            </label>

            <div class="resource-tabs" role="tablist" aria-label="Resource status filters">
              <button
                v-for="tab in tabItems"
                :key="tab.id"
                type="button"
                :class="{ active: statusFilter === tab.id }"
                @click="statusFilter = tab.id"
              >
                <i :class="tab.icon" aria-hidden="true"></i>
                {{ tab.label }}
                <span v-if="tab.badge">{{ tab.badge }}</span>
              </button>
            </div>
          </div>

          <div class="manager-table-meta">
            <strong>{{ filteredRows.length }} Resources</strong>
            <div class="manager-table-actions">
              <button
                type="button"
                :disabled="pluginStore.loading || importingPdk"
                @click="handleImportPdk"
              >
                <i
                  :class="importingPdk ? 'ri-loader-4-line spin' : 'ri-folder-add-line'"
                  aria-hidden="true"
                ></i>
                Import PDK
              </button>
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
                <span>Status</span>
                <span></span>
              </div>

              <div v-if="pluginStore.loading" class="resource-loading">
                <i class="ri-loader-4-line spin" aria-hidden="true"></i>
                Loading resources...
              </div>

              <template v-else>
                <div
                  v-for="row in filteredRows"
                  :key="row.id"
                  class="resource-row"
                  :class="{ selected: isSelected(row.id) }"
                  :style="{ '--row-accent': row.accent }"
                  role="button"
                  tabindex="0"
                  @keydown.enter.prevent="toggleResource(row.id)"
                  @keydown.space.prevent="toggleResource(row.id)"
                >
                  <span
                    class="resource-check"
                    :class="{ checked: isSelected(row.id) }"
                    @click.stop="toggleResource(row.id)"
                  >
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
                  <span>
                    <b class="status-pill" :class="row.statusKind">{{ row.statusText }}</b>
                    <span
                      v-if="row.progressPercent !== null"
                      class="mini-progress"
                      role="progressbar"
                      :style="{ '--progress': row.progressPercent / 100 }"
                      :aria-valuenow="row.progressPercent"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      :aria-label="`${row.name} installation progress`"
                    >
                      <span></span>
                    </span>
                    <span v-if="rowError(row)" class="row-error-msg">{{ rowError(row) }}</span>
                  </span>

                  <span class="row-actions">
                    <template
                      v-if="
                        rowActionForStatus(row.resource) !== 'none' ||
                        (
                          row.statusKind !== 'installing' &&
                          (row.actions.includes('activate') || row.actions.includes('validate'))
                        )
                      "
                    >
                      <button
                        v-if="rowActionForStatus(row.resource) === 'install' && row.statusKind !== 'error'"
                        type="button"
                        class="row-action-btn icon-only primary"
                        data-title="Install"
                        @click.stop="handleRowInstall(row)"
                      >
                        <i class="ri-download-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="rowActionForStatus(row.resource) === 'update' && row.statusKind !== 'error'"
                        type="button"
                        class="row-action-btn icon-only info"
                        data-title="Update"
                        @click.stop="handleRowInstall(row)"
                      >
                        <i class="ri-refresh-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="rowActionForStatus(row.resource) === 'cancel'"
                        type="button"
                        class="row-action-btn icon-only danger"
                        data-title="Cancel"
                        @click.stop="handleRowCancel(row)"
                      >
                        <i class="ri-close-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="row.statusKind === 'error'"
                        type="button"
                        class="row-action-btn icon-only danger"
                        data-title="Retry"
                        @click.stop="handleRowInstall(row)"
                      >
                        <i class="ri-restart-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="row.statusKind !== 'installing' && row.actions.includes('activate')"
                        type="button"
                        class="row-action-btn icon-only primary"
                        data-title="Activate"
                        @click.stop="handlePdkActivate(row)"
                      >
                        <i class="ri-check-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="row.statusKind !== 'installing' && row.actions.includes('validate')"
                        type="button"
                        class="row-action-btn icon-only info"
                        data-title="Validate"
                        @click.stop="handlePdkValidate(row)"
                      >
                        <i class="ri-shield-check-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-if="['uninstall', 'remove_reference'].includes(rowActionForStatus(row.resource))"
                        type="button"
                        class="row-action-btn icon-only danger-outlined"
                        :data-title="rowActionForStatus(row.resource) === 'remove_reference' ? 'Remove' : 'Uninstall'"
                        @click.stop="handleRowUninstall(row)"
                      >
                        <i
                          :class="rowActionForStatus(row.resource) === 'remove_reference' ? 'ri-link-unlink' : 'ri-delete-bin-line'"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </template>
                  </span>
                </div>
              </template>

              <div v-if="!pluginStore.loading && filteredRows.length === 0" class="resource-empty">
                <i class="ri-search-2-line" aria-hidden="true"></i>
                <strong>No resources found</strong>
                <p>Try adjusting your search or filters.</p>
                <button type="button" class="clear-filters-btn" @click="clearFilters">
                  <i class="ri-close-circle-line" aria-hidden="true"></i>
                  Clear all filters
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside class="selected-panel" aria-label="Selected resources">
          <h2>Selected Resources <span>({{ selectedResources.length }})</span></h2>

          <div class="selected-list">
            <div v-if="selectedResources.length === 0" class="selected-empty">
              <i class="ri-checkbox-multiple-line" aria-hidden="true"></i>
              <span>No resources selected</span>
              <small>Click rows in the table to select resources for batch operations.</small>
            </div>

            <div
              v-for="row in selectedResources"
              :key="row.id"
              class="selected-item"
              :style="{ '--row-accent': row.accent }"
            >
              <span class="resource-avatar compact">{{ row.icon }}</span>
              <span class="selected-item-body">
                <strong>{{ row.name }}</strong>
                <small class="selected-item-meta" :title="resolveInstallPath(row)">
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

          <p class="manager-note">
            <i class="ri-information-line" aria-hidden="true"></i>
            Updates will replace the existing installed versions.
          </p>

          <div class="selected-actions">
            <button
              type="button"
              class="download-button"
              :disabled="downloadableSelectedResources.length === 0"
              @click="downloadSelected"
            >
              <i class="ri-download-line" aria-hidden="true"></i>
              <span>
                Download
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
import { usePluginStore } from '@/stores/pluginStore'
import { usePdkManager } from '@/composables/usePdkManager'
import { getOptionalDesktopApi, hasDesktopApi, waitForDesktopApi } from '@/platform/desktop'
import {
  primaryActionForRow,
  resourceToRow,
  resolveRowInstallPath,
  rowActionForStatus,
  runBatchDownload,
  runPrimaryAction,
} from './pluginToolsRows'
import type { ResourceRow } from './pluginToolsRows'

type CategoryFilter = 'all' | 'tools' | 'pdks' | 'installed'
type StatusFilter = 'all' | 'available' | 'installed' | 'updates'

const router = useRouter()
const pluginStore = usePluginStore()
const { importPdk } = usePdkManager()

const searchQuery = ref('')
const searchInput = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(searchInput, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchQuery.value = val
  }, 200)
})

const categoryFilter = ref<CategoryFilter>('all')
const statusFilter = ref<StatusFilter>('all')
const selectedResourceIds = ref<Set<string>>(new Set())
const importingPdk = ref(false)

const resourceRows = computed<ResourceRow[]>(() => {
  return pluginStore.resources.map((resource) => {
    return resourceToRow(resource, pluginStore.resourceProgress[resource.id])
  })
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

const downloadableSelectedResources = computed(() => {
  return selectedResources.value.filter((row) => primaryActionForRow(row) !== null)
})

const totalSizeMb = computed(() => {
  return downloadableSelectedResources.value.reduce((sum, row) => sum + row.sizeMb, 0)
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
    icon: 'ri-tools-line',
    count: resourceRows.value.filter((row) => row.type === 'tool').length,
  },
  {
    id: 'pdks' as const,
    label: 'PDKs',
    icon: 'ri-cpu-line',
    count: resourceRows.value.filter((row) => row.type === 'pdk').length,
  },
  {
    id: 'installed' as const,
    label: 'Installed',
    icon: 'ri-checkbox-circle-line',
    count: installedCount.value,
  },
])

const tabItems = computed(() => [
  { id: 'all' as const, label: 'All', icon: 'ri-apps-line', badge: 0 },
  {
    id: 'available' as const,
    label: 'Available',
    icon: 'ri-download-line',
    badge: resourceRows.value.filter((row) => row.statusKind === 'available').length,
  },
  { id: 'installed' as const, label: 'Installed', icon: 'ri-check-line', badge: installedCount.value },
  { id: 'updates' as const, label: 'Updates', icon: 'ri-arrow-up-circle-line', badge: updatesCount.value },
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
  void pluginStore.fetchTools()
})

onUnmounted(() => {
  pluginStore.cleanup()
})

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

function clearFilters(): void {
  searchQuery.value = ''
  categoryFilter.value = 'all'
  statusFilter.value = 'all'
}

function rowError(row: ResourceRow): string | undefined {
  return pluginStore.resourceErrors[row.id] || row.resource.error || undefined
}

async function handleRowInstall(row: ResourceRow): Promise<void> {
  await runPrimaryAction(row, pluginStore)
}

async function handleRowCancel(row: ResourceRow): Promise<void> {
  await pluginStore.cancelResource(row.id)
}

async function handleImportPdk(): Promise<void> {
  if (importingPdk.value) {
    return
  }

  importingPdk.value = true
  try {
    const imported = await importPdk()
    if (imported) {
      await pluginStore.fetchTools({ silent: true })
    }
  } finally {
    importingPdk.value = false
  }
}

async function handlePdkActivate(row: ResourceRow): Promise<void> {
  if (row.resource) {
    await pluginStore.activatePdk(row.resource.id)
  }
}

async function handlePdkValidate(row: ResourceRow): Promise<void> {
  if (row.resource) {
    await pluginStore.validatePdk(row.resource.id)
  }
}

async function handleRowUninstall(row: ResourceRow): Promise<void> {
  const action = rowActionForStatus(row.resource)
  const isDestructive = action === 'uninstall'
  const confirmMsg = isDestructive
    ? `Are you sure you want to uninstall "${row.name}"? This action cannot be undone.`
    : `Remove reference to "${row.name}"?`
  if (!confirm(confirmMsg)) return

  if (action === 'remove_reference') {
    await pluginStore.removePdkReference(row.id)
    return
  }
  await pluginStore.uninstallResource(row.id)
}

async function downloadSelected(): Promise<void> {
  await runBatchDownload(downloadableSelectedResources.value, pluginStore)
}

function resolveInstallPath(row: ResourceRow): string {
  return resolveRowInstallPath(row)
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
  const docsUrl = 'https://github.com/openecos-projects/ecos-studio/blob/main/ecos/docs/user-guide.md'
  try {
    if (hasDesktopApi()) {
      const desktopApi = getOptionalDesktopApi() ?? await waitForDesktopApi()
      await desktopApi.system.openExternal(docsUrl)
      return
    }
    window.open(docsUrl, '_blank', 'noopener,noreferrer')
  } catch (error) {
    console.error('Failed to open documentation:', error)
  }
}
</script>

<style scoped>
/* ---- Layout ---- */
.resource-manager-view {
  --success-color: #2f9f6f;
  --success-bg: color-mix(in srgb, var(--success-color) 14%, transparent);
  --info-color: var(--accent-color);
  --info-bg: color-mix(in srgb, var(--info-color) 14%, transparent);
  --warn-color: #d99a2b;
  --warn-bg: color-mix(in srgb, var(--warn-color) 14%, transparent);
  --danger-color: #d85d5d;
  --danger-bg: color-mix(in srgb, var(--danger-color) 14%, transparent);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  overflow: hidden;
  isolation: isolate;
  color: var(--text-primary);
  background: var(--bg-secondary);
}

/* ---- Blurred background ---- */
.blurred-home {
  position: absolute;
  inset: 0;
  overflow: hidden;
  filter: blur(1.5px) brightness(0.82);
  transform: translateZ(0) scale(1.006);
  transform-origin: center;
  background:
    radial-gradient(circle at 50% 16%, color-mix(in srgb, var(--accent-color) 12%, transparent), transparent 28%),
    linear-gradient(color-mix(in srgb, var(--border-color) 50%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 50%, transparent) 1px, transparent 1px),
    var(--bg-secondary);
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
  color: var(--text-primary);
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 0;
}

.blurred-brand i {
  color: var(--accent-color);
  font-size: 64px;
  text-shadow: 0 18px 50px color-mix(in srgb, var(--accent-color) 22%, transparent);
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
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: 0 24px 90px rgba(15, 23, 42, 0.06);
}

.blurred-card {
  height: 170px;
  border-radius: 16px;
}

.blurred-card.is-active {
  border-color: color-mix(in srgb, var(--accent-color) 28%, transparent);
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

/* ---- Scrim ---- */
.manager-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(17, 24, 39, 0.32);
}

/* ---- Dialog ---- */
.manager-dialog {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: min(1280px, calc(100% - 96px));
  max-height: calc(100% - 64px);
  min-height: 620px;
  margin: 0 auto;
  padding: 36px 38px 38px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
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
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.manager-close:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

/* ---- Header ---- */
.manager-header {
  flex: 0 0 auto;
  padding-right: 42px;
  margin-bottom: 28px;
}

.manager-header h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: 0;
}

.manager-header p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

/* ---- Grid ---- */
.manager-grid {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 240px;
  gap: 12px;
  min-height: 0;
  flex: 1 1 auto;
}

.manager-sidebar,
.manager-table-panel,
.selected-panel {
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

/* ---- Sidebar ---- */
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
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
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
  color: var(--text-secondary);
  background: var(--bg-secondary);
  font-size: 11px;
  font-weight: 700;
}

.resource-nav-item.active {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.resource-nav-item.active b {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
}

.manager-help {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.help-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.manager-help strong {
  display: block;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 750;
}

.manager-help p {
  margin: 3px 0 12px;
  color: var(--text-secondary);
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
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

/* ---- Table panel ---- */
.manager-table-panel {
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.manager-toolbar {
  display: grid;
  grid-template-columns: minmax(120px, 160px) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.resource-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 14px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
}

.resource-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  background: transparent;
  font-size: 13px;
}

.resource-search input::placeholder {
  color: color-mix(in srgb, var(--text-secondary) 60%, transparent);
}

.resource-search:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 16%, transparent);
}

.resource-tabs {
  justify-self: end;
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
}

.resource-tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  color: var(--text-secondary);
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
  background: var(--border-color);
}

.resource-tabs button.active {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 46%, transparent);
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
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  font-size: 11px;
}

.manager-table-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.manager-table-actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.manager-table-meta strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.manager-table-meta button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  color: var(--accent-color);
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
  color: var(--danger-color);
  background: var(--danger-bg);
  font-size: 12px;
}

/* ---- Table ---- */
.resource-table-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1;
}

.resource-table {
  width: 100%;
}

.resource-table-head,
.resource-row {
  display: grid;
  grid-template-columns: 32px minmax(180px, 2fr) 72px 68px 110px 90px;
  align-items: center;
  gap: 0;
}

.resource-table-head {
  height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.resource-row {
  width: 100%;
  min-height: 56px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.resource-row:hover {
  background: color-mix(in srgb, var(--accent-color) 4%, transparent);
}

.resource-row:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: -2px;
}

.resource-row.selected {
  background: color-mix(in srgb, var(--accent-color) 7%, transparent);
}

.resource-check {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--accent-text);
  background: var(--bg-primary);
  font-size: 12px;
}

.resource-check.checked {
  border-color: var(--accent-color);
  background: var(--accent-color);
}

.resource-name-cell {
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

.resource-copy strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-copy small {
  display: block;
  overflow: hidden;
  max-width: 260px;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-muted {
  color: var(--text-secondary);
  font-size: 12px;
}

/* ---- Pills ---- */
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}

.status-pill.installed {
  color: var(--success-color);
  background: var(--success-bg);
}

.status-pill.available {
  color: var(--text-secondary);
  background: var(--bg-secondary);
}

.status-pill.update {
  color: var(--info-color);
  background: var(--info-bg);
}

.status-pill.installing {
  color: var(--text-secondary);
  background: transparent;
  padding: 0;
}

.status-pill.error {
  color: var(--danger-color);
  background: var(--danger-bg);
}

.mini-progress {
  --progress: 0;
  display: block;
  position: relative;
  width: 62px;
  height: 4px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--info-color) 16%, var(--bg-secondary));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--info-color) 10%, transparent);
}

.mini-progress span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--info-color),
    color-mix(in srgb, var(--info-color) 70%, var(--accent-text))
  );
  box-shadow: 0 0 10px color-mix(in srgb, var(--info-color) 34%, transparent);
  transform: scaleX(var(--progress, 0));
  transform-origin: left center;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.row-error-msg {
  display: block;
  margin-top: 4px;
  color: var(--danger-color);
  font-size: 11px;
  line-height: 1.3;
}

/* ---- Row actions ---- */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.row-action-btn.icon-only {
  width: 26px;
  padding: 0;
  font-size: 13px;
}

/* ---- Custom tooltip ---- */
.row-action-btn[data-title] {
  position: relative;
}

.row-action-btn[data-title]::after {
  content: attr(data-title);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) scale(0.96);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.row-action-btn[data-title]::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%) scale(0.96);
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid var(--border-color);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 10;
}

.row-action-btn[data-title]:hover::after,
.row-action-btn[data-title]:hover::before {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.row-action-btn.primary {
  color: var(--accent-text);
  background: var(--accent-color);
}

.row-action-btn.primary:hover {
  opacity: 0.9;
}

.row-action-btn.danger-outlined {
  color: var(--danger-color);
  background: transparent;
  border: 1px solid var(--danger-color);
}

.row-action-btn.danger-outlined:hover {
  background: var(--danger-bg);
}

.row-action-btn.info {
  color: var(--info-color);
  background: var(--info-bg);
}

.row-action-btn.info:hover {
  opacity: 0.85;
}

.row-action-btn.warn {
  color: var(--warn-color);
  background: var(--warn-bg);
}

.row-action-btn.warn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.row-action-btn.danger {
  color: var(--danger-color);
  background: var(--danger-bg);
}

/* ---- Loading / Empty ---- */
.resource-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 13px;
}

.resource-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}

.resource-empty i {
  font-size: 28px;
  opacity: 0.35;
  margin-bottom: 4px;
}

.resource-empty strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 650;
}

.resource-empty p {
  margin: 0;
  font-size: 12px;
}

.clear-filters-btn {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
  transition: background 0.15s ease;
}

.clear-filters-btn i {
  font-size: 15px;
  line-height: 1;
  position: relative;
  top: 1px;
}

.clear-filters-btn:hover {
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

/* ---- Selected panel ---- */
.selected-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 16px 12px;
}

.selected-panel h2 {
  margin: 0 0 16px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 750;
}

.selected-panel h2 span {
  color: var(--text-secondary);
  font-weight: 650;
}

.selected-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  overflow: auto;
  min-height: 160px;
}

.selected-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  gap: 6px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
  padding: 16px;
}

.selected-empty i {
  font-size: 28px;
  opacity: 0.35;
}

.selected-empty small {
  font-size: 11px;
  opacity: 0.7;
  max-width: 180px;
}

.selected-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 0;
}

.selected-item-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.selected-item strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-item-meta {
  display: block;
  overflow: hidden;
  max-width: 260px;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-item-meta b {
  padding: 2px 5px;
  border-radius: 5px;
  color: var(--info-color);
  background: var(--info-bg);
  font-size: 10px;
  font-style: normal;
}

.selected-item em {
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
  margin-top: 2px;
}

.selected-item button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.selected-item button:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

/* ---- Total size ---- */
.total-size {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px -16px 0;
  padding: 16px;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 13px;
}

.total-size span {
  color: var(--text-secondary);
  font-weight: 650;
}

.total-size strong {
  font-size: 14px;
  font-weight: 800;
}

/* ---- Note & actions ---- */
.manager-note {
  display: grid;
  grid-template-columns: 20px 1fr;
  align-items: start;
  gap: 10px;
  margin-top: 12px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  color: color-mix(in srgb, var(--text-primary) 50%, transparent);
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  font-size: 12px;
  line-height: 1.45;
}

.manager-note i {
  color: var(--accent-color);
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  color: var(--accent-text);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-color) 85%, white), var(--accent-color));
}

.download-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.download-button i {
  position: absolute;
  left: 14px;
  font-size: 16px;
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
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 13px;
  transition: background 0.15s ease;
}

.cancel-button:hover {
  background: var(--bg-secondary);
}

/* ---- Animation ---- */
.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- Dark mode overrides ---- */
:global(.dark) .manager-scrim {
  background: rgba(0, 0, 0, 0.4);
}

:global(.dark) .manager-dialog {
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.4);
}

:global(.dark) .blurred-card,
:global(.dark) .blurred-lines div {
  border-color: color-mix(in srgb, var(--border-color) 60%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
}

:global(.dark) .blurred-card.is-active {
  border-color: color-mix(in srgb, var(--accent-color) 35%, transparent);
}

:global(.dark) .blurred-home {
  background:
    radial-gradient(circle at 50% 16%, color-mix(in srgb, var(--accent-color) 14%, transparent), transparent 28%),
    linear-gradient(color-mix(in srgb, var(--border-color) 40%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 40%, transparent) 1px, transparent 1px),
    var(--bg-primary);
  background-size: auto, 52px 52px, 52px 52px, auto;
}

:global(.dark) .blurred-brand {
  color: var(--text-primary);
}

:global(.dark) .selected-empty {
  border-color: color-mix(in srgb, var(--border-color) 60%, transparent);
}

/* ---- Responsive ---- */
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
    grid-template-rows: auto 1fr;
  }

  .manager-sidebar {
    flex-direction: row;
    gap: 16px;
  }

  .resource-nav {
    flex: 1;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .manager-help {
    width: 220px;
    flex-shrink: 0;
  }

  .selected-panel {
    max-height: 320px;
  }

  .selected-list {
    max-height: 120px;
  }
}

@media (max-width: 767px) {
  .manager-dialog {
    width: calc(100% - 24px);
    padding: 24px 18px;
    margin: 24px auto;
    min-height: calc(100vh - 48px);
  }

  .manager-sidebar {
    flex-direction: column;
  }

  .resource-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .manager-close {
    top: 24px;
    right: 18px;
  }
}
</style>
