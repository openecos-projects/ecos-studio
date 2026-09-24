<template>
  <div class="resource-manager-view">
    <div class="manager-scrim" aria-hidden="true"></div>

    <section class="manager-dialog" aria-labelledby="resource-manager-title">
      <button
        type="button"
        class="manager-close"
        aria-label="Close resource manager"
        @click="goHome"
      >
        <i class="ri-close-line" aria-hidden="true"></i>
      </button>

      <header class="manager-header">
        <h1 id="resource-manager-title">Resource Manager</h1>
        <p>
          Manage frontend resources, EDA tools, compiler toolchains, PDKs, and MPC
          projects
        </p>
      </header>

      <CliInstallerCard />

      <div class="manager-grid">
        <PluginManagerSidebar
          :items="sidebarItems"
          :active="categoryFilter"
          @select="categoryFilter = $event"
          @docs="openDocs"
        />

        <main class="manager-table-panel">
          <PluginManagerToolbar
            v-model:search="searchQuery"
            :tabs="tabItems"
            :active-tab="statusFilter"
            :result-count="filteredRows.length"
            :refreshing="pluginStore.refreshing"
            @select-tab="statusFilter = $event"
            @refresh="pluginStore.refresh()"
          />

          <PluginFrontendReadiness
            v-if="categoryFilter === 'frontend'"
            :summary="frontendSummary"
          />

          <div
            v-if="managerErrorText"
            class="resource-error"
            :title="pluginStore.error ?? undefined"
          >
            {{ managerErrorText }}
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
                    <i
                      v-if="isSelected(row.id)"
                      class="ri-check-line"
                      aria-hidden="true"
                    ></i>
                  </span>

                  <span class="resource-name-cell">
                    <span class="resource-avatar">{{ row.icon }}</span>
                    <span class="resource-copy">
                      <strong>{{ row.name }}</strong>
                      <small :title="row.descriptionTitle || undefined">{{
                        row.description
                      }}</small>
                      <span v-if="row.flowTags.length" class="resource-flow-tags">
                        <b v-for="tag in row.flowTags.slice(0, 4)" :key="tag">{{
                          tag
                        }}</b>
                      </span>
                      <span v-if="row.dependencyLabel" class="resource-dependency">
                        <i class="ri-node-tree" aria-hidden="true"></i>
                        <span>{{ row.dependencyLabel }}</span>
                      </span>
                    </span>
                  </span>

                  <span class="resource-muted">{{ row.version }}</span>
                  <span class="resource-muted">{{ row.sizeLabel }}</span>
                  <span class="resource-status-cell">
                    <b
                      class="status-pill"
                      :class="row.statusKind"
                      :title="row.statusTitle || undefined"
                    >
                      <span>{{ row.statusText }}</span>
                    </b>
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
                  </span>

                  <span class="row-actions">
                    <template
                      v-if="
                        rowActionForStatus(row.resource) !== 'none' ||
                        removalActionForRow(row) !== null ||
                        canImportLocalResource(row) ||
                        (row.statusKind !== 'installing' &&
                          row.actions.includes('validate'))
                      "
                    >
                      <button
                        v-if="canImportLocalResource(row)"
                        type="button"
                        class="row-action-btn icon-only info"
                        data-title="Import Local"
                        :disabled="importingResourceIds.has(row.id)"
                        @click.stop="handleLocalImport(row)"
                      >
                        <i
                          :class="
                            importingResourceIds.has(row.id)
                              ? 'ri-loader-4-line spin'
                              : 'ri-folder-add-line'
                          "
                          aria-hidden="true"
                        ></i>
                      </button>
                      <button
                        v-if="
                          rowActionForStatus(row.resource) === 'install' &&
                          row.statusKind !== 'error'
                        "
                        type="button"
                        class="row-action-btn icon-only primary"
                        data-title="Install"
                        @click.stop="handleRowInstall(row)"
                      >
                        <i class="ri-download-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="
                          rowActionForStatus(row.resource) === 'update' &&
                          row.statusKind !== 'error'
                        "
                        type="button"
                        class="row-action-btn icon-only info"
                        data-title="Update"
                        @click.stop="handleRowInstall(row)"
                      >
                        <i class="ri-refresh-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-else-if="rowActionForStatus(row.resource) === 'replace'"
                        type="button"
                        class="row-action-btn icon-only info"
                        data-title="Replace"
                        @click.stop="handleRowInstall(row)"
                      >
                        <i class="ri-loop-left-line" aria-hidden="true"></i>
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
                        v-else-if="
                          row.statusKind !== 'installing' &&
                          row.actions.includes('validate')
                        "
                        type="button"
                        class="row-action-btn icon-only info"
                        data-title="Validate"
                        @click.stop="handlePdkValidate(row)"
                      >
                        <i class="ri-shield-check-line" aria-hidden="true"></i>
                      </button>
                      <button
                        v-if="removalActionForRow(row) !== null"
                        type="button"
                        class="row-action-btn icon-only danger-outlined"
                        :data-title="
                          removalActionForRow(row) === 'remove_reference'
                            ? 'Remove'
                            : 'Uninstall'
                        "
                        @click.stop="handleRowRemove(row)"
                      >
                        <i
                          :class="
                            removalActionForRow(row) === 'remove_reference'
                              ? 'ri-link-unlink'
                              : 'ri-delete-bin-line'
                          "
                          aria-hidden="true"
                        ></i>
                      </button>
                    </template>
                  </span>
                </div>
              </template>

              <div
                v-if="!pluginStore.loading && filteredRows.length === 0"
                class="resource-empty"
              >
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

        <PluginSelectedPanel
          :rows="selectedResources"
          :total-size-text="totalSizeText"
          :download-disabled="downloadableSelectedResources.length === 0"
          @remove="removeSelected"
          @download="downloadSelected"
          @cancel="goHome"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import CliInstallerCard from '@/components/CliInstallerCard.vue'
import PluginFrontendReadiness from '@/components/plugins/PluginFrontendReadiness.vue'
import PluginManagerSidebar from '@/components/plugins/PluginManagerSidebar.vue'
import PluginManagerToolbar from '@/components/plugins/PluginManagerToolbar.vue'
import PluginSelectedPanel from '@/components/plugins/PluginSelectedPanel.vue'
import { usePluginStore } from '@/stores/pluginStore'
import { usePdkManager } from '@/composables/usePdkManager'
import { usePluginSelection } from '@/composables/usePluginSelection'
import { getDesktopApi } from '@/platform/desktop'
import {
  canImportLocalResource,
  compactResourceMessage,
  primaryActionForRow,
  resourceToRow,
  removalActionForRow,
  rowActionForStatus,
  runBatchDownload,
  runPrimaryAction,
} from './pluginToolsRows'
import type { ResourceRow } from './pluginToolsRows'
import {
  buildSidebarItems,
  buildStatusTabs,
  filterResourceRows,
  frontendReadiness,
} from './pluginManagerFilters'
import type { CategoryFilter, StatusFilter } from './pluginManagerFilters'

const router = useRouter()
const pluginStore = usePluginStore()
const { importPdk } = usePdkManager()

const searchQuery = ref('')
const categoryFilter = ref<CategoryFilter>('all')
const statusFilter = ref<StatusFilter>('all')
const importingResourceIds = ref<Set<string>>(new Set())

const resourceRows = computed<ResourceRow[]>(() => {
  return pluginStore.resources.map((resource) => {
    return resourceToRow(resource, pluginStore.resourceProgress[resource.id])
  })
})

const {
  selectedIds: selectedResourceIds,
  isSelected,
  toggle: toggleResource,
  remove: removeSelected,
} = usePluginSelection(resourceRows)

const managerErrorText = computed(() => {
  return pluginStore.error
    ? compactResourceMessage(pluginStore.error, 'Resource manager error')
    : null
})

const filteredRows = computed(() =>
  filterResourceRows(resourceRows.value, {
    category: categoryFilter.value,
    status: statusFilter.value,
    query: searchQuery.value,
  }),
)

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

const sidebarItems = computed(() => buildSidebarItems(resourceRows.value))
const tabItems = computed(() => buildStatusTabs(resourceRows.value))
const frontendSummary = computed(() => frontendReadiness(resourceRows.value))

onMounted(() => {
  void pluginStore.fetchTools()
})

onUnmounted(() => {
  pluginStore.cleanup()
})

function clearFilters(): void {
  searchQuery.value = ''
  categoryFilter.value = 'all'
  statusFilter.value = 'all'
}

async function handleRowInstall(row: ResourceRow): Promise<void> {
  await runPrimaryAction(row, pluginStore)
}

async function handleRowCancel(row: ResourceRow): Promise<void> {
  await pluginStore.cancelResource(row.resource.id)
}

async function handleLocalImport(row: ResourceRow): Promise<void> {
  if (importingResourceIds.value.has(row.id)) {
    return
  }

  const next = new Set(importingResourceIds.value)
  next.add(row.id)
  importingResourceIds.value = next
  try {
    if (row.type === 'pdk') {
      if (await importPdk()) {
        void pluginStore.fetchTools({ silent: true })
      }
      return
    }

    const desktopApi = getDesktopApi()
    const path = await desktopApi.dialog.pickDirectory({
      title: `Select Local ${row.name} Directory`,
    })
    if (!path) {
      return
    }

    await pluginStore.importLocalResource(row.id, path)
  } finally {
    const done = new Set(importingResourceIds.value)
    done.delete(row.id)
    importingResourceIds.value = done
  }
}

async function handlePdkValidate(row: ResourceRow): Promise<void> {
  if (row.resource) {
    await pluginStore.validatePdk(row.resource.id)
  }
}

async function handleRowRemove(row: ResourceRow): Promise<void> {
  const action = removalActionForRow(row)
  if (!action) return
  const isDestructive = action === 'uninstall'
  const confirmMsg = isDestructive
    ? `Are you sure you want to uninstall "${row.name}"? This action cannot be undone.`
    : `Remove reference to "${row.name}"?`
  if (!confirm(confirmMsg)) return

  if (action === 'remove_reference') {
    if (row.type === 'pdk') {
      await pluginStore.removePdkReference(row.resource.id)
      return
    }
    await pluginStore.uninstallResource(row.resource.id)
    return
  }
  await pluginStore.uninstallResource(row.resource.id)
}

async function downloadSelected(): Promise<void> {
  await runBatchDownload(downloadableSelectedResources.value, pluginStore)
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
  const docsUrl =
    'https://github.com/openecos-projects/ecos-studio/blob/main/ecos/docs/user-guide.md'
  try {
    await getDesktopApi().system.openExternal(docsUrl)
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
  --dialog-inline-gutter: clamp(24px, 6vw, 96px);
  --dialog-block-gutter: clamp(28px, 7vh, 64px);
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
  width: min(1280px, calc(100% - var(--dialog-inline-gutter)));
  height: min(760px, calc(100% - var(--dialog-block-gutter)));
  min-height: min(560px, calc(100% - var(--dialog-block-gutter)));
  margin: 0 auto;
  padding: clamp(24px, 3.2vh, 36px) clamp(24px, 3vw, 38px) clamp(24px, 3.4vh, 38px);
  overflow: hidden;
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
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.manager-close:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

/* ---- Header ---- */
.manager-header {
  flex: 0 0 auto;
  padding-right: 42px;
  margin-bottom: clamp(18px, 3vh, 28px);
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
  grid-template-columns: minmax(170px, 200px) minmax(420px, 1fr) minmax(220px, 240px);
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

.manager-table-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 78%, transparent);
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
  --resource-table-columns: 32px minmax(150px, 2fr) minmax(96px, 0.6fr)
    minmax(68px, 0.5fr) minmax(112px, 0.7fr) 116px;
  width: 100%;
}

.resource-table-head,
.resource-row {
  display: grid;
  grid-template-columns: var(--resource-table-columns);
  align-items: center;
  gap: 0;
}

.resource-table-head > *,
.resource-row > * {
  min-width: 0;
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
  --resource-row-primary-line: 22px;
  width: 100%;
  min-height: 56px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  align-items: start;
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
  margin-top: 7px;
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
  align-items: flex-start;
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
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--row-accent) 92%, white),
    color-mix(in srgb, var(--row-accent) 76%, black)
  );
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.35),
    0 6px 14px rgba(15, 23, 42, 0.12);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
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
  line-height: var(--resource-row-primary-line);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-copy small {
  display: block;
  overflow: hidden;
  max-width: min(260px, 100%);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-flow-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.resource-flow-tags b {
  min-height: 18px;
  padding: 2px 5px;
  border-radius: 5px;
  line-height: 1.2;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 11%, transparent);
  font-size: 10px;
  font-weight: 700;
}

.resource-dependency {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 10px;
  gap: 4px;
}

.resource-dependency i {
  flex: 0 0 auto;
  color: var(--accent-color);
  font-size: 12px;
}

.resource-dependency span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-row > .resource-muted,
.resource-status-cell,
.row-actions {
  align-self: start;
}

.resource-muted {
  display: inline-flex;
  align-items: center;
  min-height: var(--resource-row-primary-line);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.2;
}

/* ---- Pills ---- */
.status-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill span {
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: 10px;
  font-weight: 700;
  padding: 0 7px;
  color: var(--info-color);
  background: var(--info-bg);
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

/* ---- Row actions ---- */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
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
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
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
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
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
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
  z-index: 10;
}

.row-action-btn[data-title]:not(:disabled):hover::after,
.row-action-btn[data-title]:not(:disabled):hover::before {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.row-action-btn.primary {
  color: var(--accent-text);
  background: var(--accent-color);
}

.row-action-btn.primary:not(:disabled):hover {
  opacity: 0.9;
}

.row-action-btn.danger-outlined {
  color: var(--danger-color);
  background: transparent;
  border: 1px solid var(--danger-color);
}

.row-action-btn.danger-outlined:not(:disabled):hover {
  background: var(--danger-bg);
}

.row-action-btn.info {
  color: var(--info-color);
  background: var(--info-bg);
}

.row-action-btn.info:not(:disabled):hover {
  opacity: 0.85;
}

.row-action-btn.warn {
  color: var(--warn-color);
  background: var(--warn-bg);
}

.row-action-btn.warn:disabled {
  cursor: default;
  opacity: 0.7;
}

.row-action-btn:disabled {
  cursor: default;
  opacity: 0.65;
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

/* ---- Responsive ---- */
@media (max-width: 1240px) {
  .manager-dialog {
    --dialog-inline-gutter: 40px;
    --dialog-block-gutter: 40px;
    width: min(980px, calc(100% - var(--dialog-inline-gutter)));
    height: calc(100% - var(--dialog-block-gutter));
    min-height: 0;
  }

  .manager-grid {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-right: 2px;
  }

  .manager-table-panel {
    flex: 0 0 clamp(280px, 42vh, 420px);
    min-height: 280px;
  }
}

@media (max-width: 767px) {
  .resource-manager-view {
    --dialog-inline-gutter: 24px;
    --dialog-block-gutter: 24px;
  }

  .manager-dialog {
    width: calc(100% - 24px);
    height: calc(100% - var(--dialog-block-gutter));
    padding: 24px 18px;
  }

  .resource-table-head,
  .resource-row {
    --resource-table-columns: 28px minmax(88px, 1fr) minmax(96px, auto) minmax(68px, auto);
  }

  .resource-table-head span:nth-child(3),
  .resource-row > .resource-muted:nth-child(3),
  .resource-table-head span:nth-child(4),
  .resource-row > .resource-muted:nth-child(4) {
    display: none;
  }

  .manager-close {
    top: 24px;
    right: 18px;
  }
}
</style>
