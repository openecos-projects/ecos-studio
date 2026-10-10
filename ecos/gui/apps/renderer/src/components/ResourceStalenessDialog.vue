<template>
  <Dialog
    :visible="request !== null"
    modal
    header="Resource Updates Available"
    :style="{ width: 'min(520px, calc(100vw - 32px))' }"
    :contentStyle="{ padding: '20px 24px' }"
    :closable="!busy"
    :draggable="false"
    class="resource-staleness-dialog"
    @update:visible="handleVisibleChange"
  >
    <div v-if="request" class="staleness-content">
      <p class="staleness-description">
        Updates are available for resources used by the {{ request.runLabel }}. Running
        with the installed versions keeps current behavior; updating first is recommended.
      </p>

      <ul class="staleness-list">
        <li v-for="item in request.resources" :key="item.id" class="staleness-item">
          <div class="staleness-item-main">
            <span class="staleness-name">{{ item.display_name }}</span>
            <span class="staleness-versions">
              {{ item.installed_version ?? 'unknown' }} →
              {{ item.latest_version ?? 'unknown' }}
            </span>
          </div>
          <span class="staleness-kind" :data-kind="item.update_kind ?? 'unknown'">
            {{ kindLabel(item.update_kind) }}
          </span>
          <span v-if="progressPercentFor(item) !== null" class="staleness-progress">
            {{ progressPercentFor(item) }}%
          </span>
        </li>
      </ul>

      <p v-if="updateError" class="staleness-error">{{ updateError }}</p>
      <p v-if="!allUpdatable" class="staleness-hint">
        Some resources can only be updated from Resource Manager.
      </p>

      <div class="staleness-actions">
        <button
          type="button"
          class="staleness-secondary"
          :disabled="busy"
          @click="dismiss"
        >
          Cancel
        </button>
        <button
          type="button"
          class="staleness-secondary"
          :disabled="busy"
          @click="confirmRunAnyway"
        >
          <i v-if="runningAnyway" class="ri-loader-4-line staleness-spinner" />
          <span>{{ runningAnyway ? 'Starting…' : 'Run anyway' }}</span>
        </button>
        <button
          type="button"
          class="staleness-primary"
          :disabled="busy || !allUpdatable"
          @click="updateAndRun"
        >
          <i v-if="updating" class="ri-loader-4-line staleness-spinner" />
          <span>{{ updating ? 'Updating…' : 'Update and run' }}</span>
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import type { ResourceStalenessItem, ResourceUpdateKind } from '@ecos-studio/shared'
import { useResourceStalenessGuard } from '@/composables/useResourceStalenessGuard'
import { usePluginStore } from '@/stores/pluginStore'

const { pendingRequest, dismiss, runAnyway, retryAfterUpdates } =
  useResourceStalenessGuard()
const pluginStore = usePluginStore()

const request = computed(() => pendingRequest.value)
const updating = ref(false)
const runningAnyway = ref(false)
const updateError = ref<string | null>(null)
const busy = computed(() => updating.value || runningAnyway.value)

function kindLabel(kind: ResourceUpdateKind | null): string {
  if (kind === 'version') return 'new version'
  if (kind === 'rebuild') return 'republished (same version)'
  return 'update available'
}

/**
 * The id `pluginStore.updateResource` accepts for a staleness item. Tool/MPC
 * ids are already resource ids; a PDK item carries its installation id, which
 * maps to the registry PDK resource through the store listing (inventory
 * entries keep the family id in `name`).
 */
function updatableIdFor(item: ResourceStalenessItem): string | null {
  if (/^(tool|mpc|pdk):/.test(item.id)) return item.id
  const match = pluginStore.resources.find(
    (resource) => resource.id === item.id && resource.type === 'pdk',
  )
  return match ? `pdk:${match.name}` : null
}

const allUpdatable = computed(
  () =>
    request.value !== null &&
    request.value.resources.every((item) => updatableIdFor(item) !== null),
)

function progressPercentFor(item: ResourceStalenessItem): number | null {
  if (!updating.value) return null
  const updatableId = updatableIdFor(item)
  const progress = updatableId ? pluginStore.resourceProgress[updatableId] : null
  if (!progress || typeof progress.progress !== 'number') return null
  const raw = progress.progress
  return Math.round(raw <= 1 ? raw * 100 : raw)
}

function handleVisibleChange(visible: boolean): void {
  if (!visible && !busy.value) dismiss()
}

async function confirmRunAnyway(): Promise<void> {
  if (busy.value) return
  runningAnyway.value = true
  try {
    await runAnyway()
  } finally {
    runningAnyway.value = false
  }
}

async function updateAndRun(): Promise<void> {
  const current = request.value
  if (!current || busy.value || !allUpdatable.value) return
  updating.value = true
  updateError.value = null
  try {
    const targets = current.resources.map((item) => updatableIdFor(item) as string)
    await Promise.all(targets.map((id) => pluginStore.updateResource(id)))
    // updateResource resolves even on failure (it records resourceErrors);
    // check every target before declaring the updates complete.
    const failure = targets
      .map((id) => pluginStore.resourceErrors[id])
      .find((message) => typeof message === 'string' && message.length > 0)
    await pluginStore.fetchTools({ silent: true })
    if (failure) {
      updateError.value = failure
      return
    }
    await retryAfterUpdates()
  } finally {
    updating.value = false
  }
}
</script>

<style>
/* PrimeVue Dialog teleports to <body>, so scoped styles can't reach it */
.resource-staleness-dialog.p-dialog {
  background: var(--bg-primary) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

.resource-staleness-dialog .p-dialog-header {
  color: var(--text-primary);
  padding: 20px 24px 8px !important;
}

.resource-staleness-dialog .p-dialog-content {
  background: transparent;
}
</style>

<style scoped>
.staleness-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.staleness-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.staleness-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.staleness-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.staleness-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.staleness-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.staleness-versions {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}

.staleness-kind {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.staleness-progress {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--accent-color);
  font-variant-numeric: tabular-nums;
}

.staleness-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #f87171;
}

.staleness-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.staleness-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.staleness-primary,
.staleness-secondary {
  min-height: 34px;
  border-radius: 8px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.staleness-primary {
  border: 1px solid var(--accent-color);
  background: var(--accent-color);
  color: #fff;
}

.staleness-primary:disabled {
  cursor: wait;
  opacity: 0.75;
}

.staleness-secondary {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.staleness-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.staleness-spinner {
  animation: staleness-spin 0.8s linear infinite;
}

@keyframes staleness-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
