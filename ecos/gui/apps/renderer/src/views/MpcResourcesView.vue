<template>
  <div class="mpc-catalog-view">
    <header class="mpc-catalog-header">
      <button
        type="button"
        class="mpc-icon-button"
        aria-label="Back to ECOS"
        title="Back to ECOS"
        @click="goHome"
      >
        <i class="ri-arrow-left-line" aria-hidden="true"></i>
      </button>

      <div class="mpc-catalog-title">
        <p>MPC Catalog</p>
        <h1>MPC Resources</h1>
        <span>Installed templates and core constraints</span>
      </div>

      <div class="mpc-catalog-actions">
        <button type="button" class="mpc-command-button" @click="openResourceManager">
          <i class="ri-tools-line" aria-hidden="true"></i>
          <span>Manage</span>
        </button>
        <button
          type="button"
          class="mpc-icon-button"
          :disabled="isLoadingResources"
          aria-label="Refresh MPC resources"
          title="Refresh MPC resources"
          @click="loadResources"
        >
          <i
            :class="
              isLoadingResources ? 'ri-loader-4-line is-spinning' : 'ri-refresh-line'
            "
            aria-hidden="true"
          ></i>
        </button>
      </div>
    </header>

    <main class="mpc-catalog-content">
      <div v-if="isLoadingResources" class="mpc-catalog-state" role="status">
        <i class="ri-loader-4-line is-spinning" aria-hidden="true"></i>
        <strong>Loading MPC resources</strong>
      </div>

      <div v-else-if="resourceError" class="mpc-catalog-state is-error" role="alert">
        <i class="ri-error-warning-line" aria-hidden="true"></i>
        <strong>MPC resources could not be loaded</strong>
        <p>{{ resourceError }}</p>
        <button type="button" class="mpc-command-button" @click="loadResources">
          <i class="ri-refresh-line" aria-hidden="true"></i>
          <span>Retry</span>
        </button>
      </div>

      <div v-else-if="mpcEntries.length === 0" class="mpc-catalog-state">
        <i class="ri-layout-grid-line" aria-hidden="true"></i>
        <strong>No installed MPC resources</strong>
        <button type="button" class="mpc-command-button" @click="openResourceManager">
          <i class="ri-tools-line" aria-hidden="true"></i>
          <span>Open Resource Manager</span>
        </button>
      </div>

      <div v-else class="mpc-catalog-workspace">
        <aside class="mpc-resource-list" aria-label="Installed MPC resources">
          <div class="mpc-resource-list__heading">
            <span>Installed</span>
            <b>{{ mpcEntries.length }}</b>
          </div>

          <button
            v-for="entry in mpcEntries"
            :key="entry.resource.id"
            type="button"
            class="mpc-resource-row"
            :class="{ 'is-selected': selectedResourceId === entry.resource.id }"
            @click="selectResource(entry.resource.id)"
          >
            <span class="mpc-resource-row__icon">
              <i class="ri-layout-grid-line" aria-hidden="true"></i>
            </span>
            <span class="mpc-resource-row__copy">
              <strong>{{ entry.resource.display_name }}</strong>
              <small>{{ entry.candidate.installed_version }}</small>
            </span>
            <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
          </button>
        </aside>

        <section v-if="selectedEntry" class="mpc-resource-detail">
          <header class="mpc-resource-detail__header">
            <div>
              <div class="mpc-resource-detail__identity">
                <h2>{{ selectedEntry.resource.display_name }}</h2>
                <span>{{ selectedEntry.candidate.installed_version }}</span>
                <span
                  v-if="selectedEntry.resource.status === 'update_available'"
                  class="is-update"
                >
                  Update available
                </span>
              </div>
              <p>{{ selectedEntry.candidate.spec_path }}</p>
            </div>

            <label v-if="designs.length > 1" class="mpc-design-select">
              <span>Design</span>
              <select v-model="selectedDesignIndex">
                <option
                  v-for="design in designs"
                  :key="design.index"
                  :value="design.index"
                >
                  {{ design.designName }}
                </option>
              </select>
            </label>
          </header>

          <div v-if="isLoadingSpec" class="mpc-detail-state" role="status">
            <i class="ri-loader-4-line is-spinning" aria-hidden="true"></i>
            <span>Loading MPC specification</span>
          </div>

          <div v-else-if="specError" class="mpc-detail-state is-error" role="alert">
            <i class="ri-error-warning-line" aria-hidden="true"></i>
            <div>
              <strong>Specification could not be loaded</strong>
              <p>{{ specError }}</p>
            </div>
            <button
              type="button"
              class="mpc-icon-button"
              aria-label="Retry specification"
              title="Retry specification"
              @click="loadMpcSpec(selectedEntry.resource.id)"
            >
              <i class="ri-refresh-line" aria-hidden="true"></i>
            </button>
          </div>

          <MpcTemplatePreview v-else-if="selectedDesign" :design="selectedDesign" />
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import MpcTemplatePreview from '@/components/MpcTemplatePreview.vue'
import { listResourcesApi, readMpcSpecApi, type ResourceItem } from '@/api/plugin'
import {
  projectMpcOptionFromResource,
  type ProjectManifestMpcCandidate,
} from '@/utils/projectManagement'
import { parseMpcSpecDesigns, type MpcSpecDesign } from '@/utils/mpcSpec'

interface MpcCatalogEntry {
  candidate: ProjectManifestMpcCandidate
  resource: ResourceItem
}

const router = useRouter()
const mpcEntries = ref<MpcCatalogEntry[]>([])
const selectedResourceId = ref('')
const designs = ref<MpcSpecDesign[]>([])
const selectedDesignIndex = ref<number | null>(null)
const isLoadingResources = ref(false)
const isLoadingSpec = ref(false)
const resourceError = ref('')
const specError = ref('')

let resourceLoadGeneration = 0
let specLoadGeneration = 0

const selectedEntry = computed<MpcCatalogEntry | null>(() => {
  return (
    mpcEntries.value.find((entry) => entry.resource.id === selectedResourceId.value) ??
    null
  )
})

const selectedDesign = computed<MpcSpecDesign | null>(() => {
  return (
    designs.value.find((design) => design.index === selectedDesignIndex.value) ?? null
  )
})

onMounted(() => {
  void loadResources()
})

function goHome() {
  void router.push('/')
}

function openResourceManager() {
  void router.push('/tools')
}

function selectResource(resourceId: string) {
  if (selectedResourceId.value === resourceId && designs.value.length > 0) return
  selectedResourceId.value = resourceId
  void loadMpcSpec(resourceId)
}

async function loadResources(): Promise<void> {
  const generation = ++resourceLoadGeneration
  specLoadGeneration += 1
  isLoadingResources.value = true
  resourceError.value = ''
  resetSpec()

  let nextResourceId = ''
  try {
    const resources = await listResourcesApi()
    if (generation !== resourceLoadGeneration) return

    mpcEntries.value = resources.flatMap((resource) => {
      const candidate = projectMpcOptionFromResource(resource)
      return candidate ? [{ candidate, resource }] : []
    })
    nextResourceId = mpcEntries.value.some(
      (entry) => entry.resource.id === selectedResourceId.value,
    )
      ? selectedResourceId.value
      : (mpcEntries.value[0]?.resource.id ?? '')
    selectedResourceId.value = nextResourceId
  } catch (error) {
    if (generation !== resourceLoadGeneration) return
    mpcEntries.value = []
    selectedResourceId.value = ''
    resourceError.value = errorMessage(error, 'Unable to list managed MPC resources.')
  } finally {
    if (generation === resourceLoadGeneration) {
      isLoadingResources.value = false
    }
  }

  if (generation === resourceLoadGeneration && nextResourceId) {
    void loadMpcSpec(nextResourceId)
  }
}

function resetSpec() {
  designs.value = []
  selectedDesignIndex.value = null
  isLoadingSpec.value = false
  specError.value = ''
}

async function loadMpcSpec(resourceId: string): Promise<void> {
  const generation = ++specLoadGeneration
  resetSpec()
  const entry = mpcEntries.value.find((candidate) => candidate.resource.id === resourceId)
  if (!entry) return

  isLoadingSpec.value = true
  try {
    const result = await readMpcSpecApi(resourceId)
    if (generation !== specLoadGeneration) return
    if (
      result.resource_id !== entry.candidate.resource_id ||
      result.installed_version !== entry.candidate.installed_version ||
      normalizePath(result.spec_path) !== normalizePath(entry.candidate.spec_path)
    ) {
      throw new Error('The MPC resource changed while its specification was loading.')
    }

    const parsedDesigns = parseMpcSpecDesigns(result.spec)
    designs.value = parsedDesigns
    selectedDesignIndex.value = parsedDesigns[0].index
  } catch (error) {
    if (generation !== specLoadGeneration) return
    specError.value = errorMessage(error, 'Unable to read the MPC specification.')
  } finally {
    if (generation === specLoadGeneration) {
      isLoadingSpec.value = false
    }
  }
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}
</script>

<style scoped>
.mpc-catalog-view {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--text-primary);
}

.mpc-catalog-header {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 24px 0 18px;
  border-bottom: 1px solid var(--border-color);
}

.mpc-catalog-title p,
.mpc-catalog-title h1,
.mpc-catalog-title span,
.mpc-resource-detail__identity h2,
.mpc-resource-detail__header p,
.mpc-catalog-state p,
.mpc-detail-state p {
  margin: 0;
}

.mpc-catalog-title p {
  margin-bottom: 3px;
  color: var(--accent-color);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.mpc-catalog-title h1 {
  font-size: 24px;
  line-height: 1.15;
}

.mpc-catalog-title > span {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.mpc-catalog-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.mpc-icon-button,
.mpc-command-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  cursor: pointer;
}

.mpc-icon-button {
  width: 36px;
  height: 36px;
  padding: 0;
  font-size: 16px;
}

.mpc-command-button {
  min-height: 36px;
  gap: 7px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
}

.mpc-icon-button:hover:not(:disabled),
.mpc-command-button:hover {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 48%, var(--border-color));
}

.mpc-icon-button:disabled {
  cursor: default;
  opacity: 0.55;
}

.mpc-catalog-content {
  display: flex;
  width: min(1240px, calc(100% - 48px));
  min-height: 0;
  flex: 1 0 auto;
  margin: 0 auto;
  padding: 18px 0 24px;
}

.mpc-catalog-workspace {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  width: 100%;
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 96%, var(--bg-secondary));
}

.mpc-resource-list {
  min-width: 0;
  padding: 14px 10px;
  border-right: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 64%, transparent);
}

.mpc-resource-list__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 10px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.mpc-resource-list__heading b {
  min-width: 20px;
  padding: 2px 5px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  text-align: center;
}

.mpc-resource-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 16px;
  gap: 9px;
  align-items: center;
  width: 100%;
  min-height: 52px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.mpc-resource-row:hover {
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.mpc-resource-row.is-selected {
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
}

.mpc-resource-row__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--accent-color);
  background: var(--bg-primary);
}

.mpc-resource-row__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.mpc-resource-row__copy strong,
.mpc-resource-row__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mpc-resource-row__copy strong {
  font-size: 12px;
}

.mpc-resource-row__copy small,
.mpc-resource-row > i {
  color: var(--text-secondary);
  font-size: 11px;
}

.mpc-resource-detail {
  min-width: 0;
  padding: 20px 24px 28px;
}

.mpc-resource-detail__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.mpc-resource-detail__identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mpc-resource-detail__identity h2 {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 17px;
}

.mpc-resource-detail__identity span {
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.mpc-resource-detail__identity span.is-update {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
}

.mpc-resource-detail__header p {
  max-width: 72ch;
  margin-top: 6px;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

.mpc-design-select {
  display: grid;
  flex: 0 0 220px;
  gap: 5px;
}

.mpc-design-select span {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.mpc-design-select select {
  width: 100%;
  height: 34px;
  padding: 0 9px;
  font-size: 11px;
}

.mpc-catalog-state,
.mpc-detail-state {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.mpc-catalog-state {
  width: 100%;
  min-height: 440px;
  flex-direction: column;
  gap: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
}

.mpc-catalog-state > i {
  color: var(--accent-color);
  font-size: 24px;
}

.mpc-catalog-state strong {
  color: var(--text-primary);
  font-size: 14px;
}

.mpc-catalog-state p,
.mpc-detail-state p {
  max-width: 68ch;
  overflow-wrap: anywhere;
  font-size: 11px;
  text-align: center;
}

.mpc-detail-state {
  min-height: 240px;
  gap: 10px;
  font-size: 12px;
}

.mpc-detail-state.is-error {
  justify-content: flex-start;
  min-height: auto;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--danger-color) 38%, var(--border-color));
  border-radius: 8px;
  color: var(--danger-color);
  background: color-mix(in srgb, var(--danger-color) 5%, transparent);
}

.mpc-detail-state.is-error div {
  min-width: 0;
  flex: 1;
}

.mpc-detail-state.is-error p {
  margin-top: 3px;
  text-align: left;
}

.mpc-catalog-state.is-error > i {
  color: var(--danger-color);
}

.is-spinning {
  animation: mpc-spin 0.8s linear infinite;
}

@keyframes mpc-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 1600px) {
  .mpc-catalog-header,
  .mpc-catalog-content {
    width: min(1800px, calc(100% - 64px));
  }
}

@media (max-width: 820px) {
  .mpc-catalog-header,
  .mpc-catalog-content {
    width: calc(100% - 28px);
    max-width: 1240px;
  }

  .mpc-catalog-workspace {
    grid-template-columns: 1fr;
  }

  .mpc-resource-list {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .mpc-resource-detail {
    padding: 18px;
  }
}

@media (max-width: 600px) {
  .mpc-catalog-header {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .mpc-catalog-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }

  .mpc-resource-detail__header {
    display: grid;
  }

  .mpc-design-select {
    width: 100%;
  }
}
</style>
