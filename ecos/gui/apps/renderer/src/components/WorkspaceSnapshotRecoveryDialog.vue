<template>
  <Dialog
    :visible="request !== null"
    modal
    :header="isRebuildable ? 'Snapshot Rebuild Required' : 'Workspace Identity Mismatch'"
    :style="{ width: 'min(480px, calc(100vw - 32px))' }"
    :contentStyle="{ padding: '20px 24px' }"
    :closable="!rebuilding"
    :draggable="false"
    class="snapshot-recovery-dialog"
    @update:visible="handleVisibleChange"
  >
    <div v-if="request" class="snapshot-recovery-content">
      <p v-if="isRebuildable" class="snapshot-recovery-description">
        The Engineering Snapshot of this workspace is unreadable or uses an unsupported
        schema version, so the workspace cannot be opened as-is
        <code>(snapshot_rebuild_required)</code>. ECOS Studio left the file untouched.
        Rebuilding deletes <code>home/engineering-snapshot.json</code> and regenerates it
        from the workspace's flow state on the next open.
      </p>
      <p v-else class="snapshot-recovery-description">
        The Engineering Snapshot belongs to a different workspace identity, which usually
        means the workspace directory was copied by hand
        <code>(snapshot_identity_mismatch)</code>. Opening is refused to protect the
        original workspace's data. To work on a copy, create a new workspace or branch
        from the Projects view instead.
      </p>

      <dl class="snapshot-recovery-facts">
        <div>
          <dt>Workspace</dt>
          <dd class="snapshot-recovery-path">{{ request.directory }}</dd>
        </div>
        <div v-if="request.detail && request.detail !== request.code">
          <dt>Detail</dt>
          <dd>{{ request.detail }}</dd>
        </div>
      </dl>

      <div class="snapshot-recovery-actions">
        <button
          type="button"
          class="snapshot-recovery-secondary"
          :disabled="rebuilding"
          @click="dismiss"
        >
          {{ isRebuildable ? 'Cancel' : 'Close' }}
        </button>
        <button
          v-if="isRebuildable"
          type="button"
          class="snapshot-recovery-primary"
          :disabled="rebuilding"
          @click="rebuild"
        >
          <i v-if="rebuilding" class="ri-loader-4-line snapshot-recovery-spinner" />
          <span>{{ rebuilding ? 'Rebuilding…' : 'Rebuild Snapshot' }}</span>
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { SNAPSHOT_REBUILD_REQUIRED } from '@ecos-studio/shared'
import { useSnapshotOpenRecovery } from '@/composables/useSnapshotOpenRecovery'
import { useWorkspace } from '@/composables/useWorkspace'

const { pendingRequest, dismissSnapshotOpenRecovery, rebuildSnapshotAndRetry } =
  useSnapshotOpenRecovery()
const { showToast } = useWorkspace()

const request = computed(() => pendingRequest.value)
const isRebuildable = computed(() => request.value?.code === SNAPSHOT_REBUILD_REQUIRED)
const rebuilding = ref(false)

function handleVisibleChange(visible: boolean): void {
  if (!visible && !rebuilding.value) dismissSnapshotOpenRecovery()
}

function dismiss(): void {
  dismissSnapshotOpenRecovery()
}

async function rebuild(): Promise<void> {
  if (rebuilding.value) return
  rebuilding.value = true
  try {
    await rebuildSnapshotAndRetry()
  } catch (error) {
    showToast({
      severity: 'error',
      summary: 'Snapshot Rebuild Failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    rebuilding.value = false
  }
}
</script>

<style>
/* PrimeVue Dialog teleports to <body>, so scoped styles can't reach it */
.snapshot-recovery-dialog.p-dialog {
  background: var(--bg-primary) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

.snapshot-recovery-dialog .p-dialog-header {
  color: var(--text-primary);
  padding: 20px 24px 8px !important;
}

.snapshot-recovery-dialog .p-dialog-content {
  background: transparent;
}
</style>

<style scoped>
.snapshot-recovery-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.snapshot-recovery-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.snapshot-recovery-description code {
  font-size: 12px;
  color: var(--text-primary);
}

.snapshot-recovery-facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.snapshot-recovery-facts div {
  display: flex;
  gap: 8px;
}

.snapshot-recovery-facts dt {
  flex: 0 0 72px;
  color: var(--text-secondary);
  font-weight: 600;
}

.snapshot-recovery-facts dd {
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.snapshot-recovery-path {
  font-family: monospace;
}

.snapshot-recovery-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.snapshot-recovery-primary,
.snapshot-recovery-secondary {
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

.snapshot-recovery-primary {
  border: 1px solid var(--accent-color);
  background: var(--accent-color);
  color: #fff;
}

.snapshot-recovery-primary:disabled {
  cursor: wait;
  opacity: 0.75;
}

.snapshot-recovery-secondary {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.snapshot-recovery-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.snapshot-recovery-spinner {
  animation: snapshot-recovery-spin 0.8s linear infinite;
}

@keyframes snapshot-recovery-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
