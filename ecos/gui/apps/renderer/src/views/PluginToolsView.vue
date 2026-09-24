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

        <main class="manager-content-panel">
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

          <PluginResourceCardGrid
            :rows="filteredRows"
            :loading="pluginStore.loading"
            :importing-ids="importingResourceIds"
            @action="handleCardAction"
            @homepage="handleHomepage"
            @clear-filters="clearFilters"
          />
        </main>
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
import PluginResourceCardGrid from '@/components/plugins/PluginResourceCardGrid.vue'
import { usePluginStore } from '@/stores/pluginStore'
import { usePdkManager } from '@/composables/usePdkManager'
import { getDesktopApi } from '@/platform/desktop'
import {
  compactResourceMessage,
  resourceToRow,
  removalActionForRow,
  runPrimaryAction,
} from './pluginToolsRows'
import type { ResourceRow } from './pluginToolsRows'
import { homepageUrlFor } from './pluginResourceCards'
import type { PluginCardActionId } from './pluginResourceCards'
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

async function handleCardAction(
  row: ResourceRow,
  action: PluginCardActionId,
): Promise<void> {
  switch (action) {
    case 'install':
    case 'update':
    case 'replace':
    case 'retry':
      await runPrimaryAction(row, pluginStore)
      return
    case 'cancel':
      await pluginStore.cancelResource(row.resource.id)
      return
    case 'validate':
      await pluginStore.validatePdk(row.resource.id)
      return
    case 'import_local':
      await handleLocalImport(row)
      return
    case 'uninstall':
    case 'remove_reference':
      await handleRowRemove(row)
      return
  }
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

async function handleHomepage(row: ResourceRow): Promise<void> {
  const url = homepageUrlFor(row)
  if (!url) return
  try {
    await getDesktopApi().system.openExternal(url)
  } catch (error) {
    console.error('Failed to open homepage:', error)
  }
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
  grid-template-columns: minmax(170px, 200px) minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  margin-top: 14px;
  overflow: hidden;
  flex: 1 1 auto;
}

.manager-content-panel {
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

  .manager-content-panel {
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

  .manager-close {
    top: 24px;
    right: 18px;
  }
}
</style>
