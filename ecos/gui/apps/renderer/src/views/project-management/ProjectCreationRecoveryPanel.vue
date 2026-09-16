<template>
  <section
    v-if="attention.length"
    class="creation-recovery"
    aria-labelledby="creation-recovery-title"
  >
    <header>
      <div>
        <strong id="creation-recovery-title">Unfinished Workspace Creation</strong>
        <span
          >{{ attention.length }} item{{ attention.length === 1 ? '' : 's' }} need
          review</span
        >
      </div>
      <i class="ri-error-warning-line" aria-hidden="true"></i>
    </header>
    <div class="creation-recovery-list">
      <article v-for="creation in attention" :key="creation.creationId">
        <div class="creation-copy">
          <strong :title="creation.targetDirectory">{{
            creation.targetDirectory || 'Unknown target'
          }}</strong>
          <span>{{ creation.issue || 'Creation did not finish cleanly.' }}</span>
        </div>
        <dl>
          <div>
            <dt>Project</dt>
            <dd>{{ creation.projectId || creation.projectRoot || '-' }}</dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{{ creation.stage || 'Invalid journal' }}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{{ formatTime(creation.updatedAt) }}</dd>
          </div>
        </dl>
        <div class="creation-actions">
          <button
            v-if="creation.status === 'unfinished'"
            type="button"
            :disabled="busyId === creation.creationId"
            @click="continueCreation(creation.creationId)"
          >
            Continue Initialization
          </button>
          <button
            v-if="creation.status === 'unfinished'"
            type="button"
            :disabled="busyId === creation.creationId"
            @click="abandon(creation.creationId)"
          >
            Abandon Registration
          </button>
          <span v-if="creation.status === 'invalid'" class="creation-manual">
            Manual quarantine required
          </span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { useNotificationStore } from '@/stores/notificationStore'

const store = useBackgroundOperationStore()
const notifications = useNotificationStore()
const { creations } = storeToRefs(store)
const attention = computed(() =>
  creations.value.filter(
    (creation) => creation.status === 'unfinished' || creation.status === 'invalid',
  ),
)
const busyId = ref('')

async function continueCreation(creationId: string): Promise<void> {
  await run(creationId, () => store.continueCreation(creationId))
}

async function abandon(creationId: string): Promise<void> {
  if (
    !confirm(
      'Abandon this Workspace registration?\n\nAll Workspace files will remain on disk, including the Workspace directory. ECOS Studio will remove only Project and recent-Workspace registrations that this creation record proves it introduced. If ownership cannot be confirmed, nothing is removed and the recovery item remains.',
    )
  )
    return
  await run(creationId, () => store.abandonCreation(creationId))
}

async function run(creationId: string, action: () => Promise<void>): Promise<void> {
  if (busyId.value) return
  busyId.value = creationId
  try {
    await action()
  } catch (error) {
    notifications.addNotification({
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      title: 'Workspace creation recovery failed',
    })
  } finally {
    busyId.value = ''
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}
</script>

<style scoped>
.creation-recovery {
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.creation-recovery > header,
.creation-recovery article {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
}

.creation-recovery > header {
  justify-content: space-between;
  color: var(--text-primary);
}

.creation-recovery > header div,
.creation-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.creation-recovery > header span,
.creation-copy span,
dt {
  color: var(--text-secondary);
  font-size: 10px;
}

.creation-recovery > header i {
  color: var(--error-color, #e45757);
}

.creation-recovery article {
  border-top: 1px solid var(--border-color);
}

.creation-copy {
  flex: 1;
}

.creation-copy strong,
.creation-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(100px, 1fr));
  min-width: 380px;
  gap: 12px;
  margin: 0;
}

dt,
dd {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

dd {
  margin-top: 2px;
  color: var(--text-primary);
  font-size: 11px;
}

.creation-actions {
  display: flex;
  gap: 6px;
}

.creation-manual {
  color: var(--text-secondary);
  font-size: 11px;
}

.creation-actions button {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  background: transparent;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.creation-actions button:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (max-width: 1200px) {
  dl {
    display: none;
  }
}
</style>
