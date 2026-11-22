<template>
  <div class="candidate-cleanup">
    <button
      type="button"
      :disabled="cleaning"
      :aria-label="cleaning ? 'Deleting candidate files' : 'Delete candidate files'"
      title="Delete candidate files"
      class="candidate-cleanup__action"
      @click="dialog?.showModal()"
    >
      <i
        :class="cleaning ? 'ri-loader-4-line' : 'ri-delete-bin-line'"
        aria-hidden="true"
      ></i>
    </button>
    <dialog
      ref="dialog"
      class="candidate-cleanup__dialog"
      :aria-labelledby="titleId"
      :aria-describedby="detailId"
      @close="confirmCleanup"
    >
      <h2 :id="titleId">Delete candidate files?</h2>
      <p :id="detailId">
        This permanently deletes the candidate workspaces and their generated files for
        this optimization. The source Workspace and optimization history are kept.
      </p>
      <form method="dialog" class="candidate-cleanup__buttons">
        <button type="submit" value="cancel" autofocus>Cancel</button>
        <button type="submit" value="delete" class="candidate-cleanup__delete">
          Delete files
        </button>
      </form>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useOptimizationEpisodeStore } from '@/stores/optimizationEpisodeStore'

const props = defineProps<{ episodeId: string }>()
const episodes = useOptimizationEpisodeStore()
const { showToast } = useWorkspace()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const detailId = useId()
const cleaning = ref(false)

async function confirmCleanup(): Promise<void> {
  const modal = dialog.value
  if (!modal) return
  const choice = modal.returnValue
  modal.returnValue = ''
  if (choice !== 'delete' || cleaning.value) return

  cleaning.value = true
  try {
    await episodes.cleanup(props.episodeId)
    showToast({ severity: 'success', summary: 'Candidate files deleted' })
  } catch (error) {
    showToast({
      severity: 'error',
      summary: 'Candidate cleanup failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    cleaning.value = false
  }
}
</script>

<style scoped>
.candidate-cleanup {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.candidate-cleanup__action {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
}

.candidate-cleanup__action:hover:enabled {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.candidate-cleanup__dialog {
  margin: auto;
  width: min(26rem, calc(100vw - 2rem));
  padding: 1.25rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.candidate-cleanup__dialog:modal {
  overscroll-behavior: contain;
}

.candidate-cleanup__dialog::backdrop {
  overflow: hidden;
  overscroll-behavior: contain;
  background: rgb(0 0 0 / 45%);
}

.candidate-cleanup__dialog h2 {
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.candidate-cleanup__buttons {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.candidate-cleanup__buttons button {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
}

.candidate-cleanup__buttons .candidate-cleanup__delete {
  background: #b72832;
  border-color: #b72832;
  color: white;
}
</style>
