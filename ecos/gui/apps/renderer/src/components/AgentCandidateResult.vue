<template>
  <div>
    <button
      type="button"
      class="result-action"
      title="View optimization result"
      aria-label="View optimization result"
      @click="open"
    >
      <i class="ri-bar-chart-grouped-line" aria-hidden="true" />
    </button>
    <dialog
      ref="dialog"
      class="result-dialog"
      :aria-labelledby="titleId"
      @cancel="guardClose"
    >
      <header>
        <h2 :id="titleId">Optimization result</h2>
        <button
          type="button"
          :disabled="saving"
          aria-label="Close result"
          autofocus
          @click="dialog?.close()"
        >
          <i class="ri-close-line" aria-hidden="true" />
        </button>
      </header>
      <template v-if="episode.bestCandidate">
        <p>
          Best candidate <code>{{ episode.bestCandidate.candidate_id }}</code>
        </p>
        <div
          class="result-table"
          tabindex="0"
          role="region"
          aria-label="Candidate metrics"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Baseline</th>
                <th scope="col">Candidate</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in episode.bestCandidate.metrics" :key="metric.id">
                <th scope="row">{{ metric.id.replace(/_/g, ' ') }}</th>
                <td>{{ metric.baseline ?? 'Unavailable' }}</td>
                <td>{{ metric.candidate }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <form
          v-if="canSave && !savedWorkspace"
          class="result-save"
          @submit.prevent="save"
        >
          <label>
            New Workspace name
            <input
              v-model.trim="name"
              required
              maxlength="80"
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,79}"
              :disabled="saving"
            />
          </label>
          <button type="submit" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save as Workspace' }}
          </button>
        </form>
        <p v-else-if="episode.cleanupState === 'completed' && !savedWorkspace">
          Temporary candidate files were deleted.
        </p>
        <button v-if="savedWorkspace" type="button" @click="openSaved">
          Open saved Workspace
        </button>
      </template>
      <p v-else>No verified best candidate was recorded for this optimization.</p>
      <p v-if="issue" role="alert">{{ issue }}</p>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import type {
  DesktopAgentOptimizationEpisodeSummary,
  DesktopAgentRetainedWorkspace,
} from '@ecos-studio/shared'
import { computed, ref, useId } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

const props = defineProps<{ episode: DesktopAgentOptimizationEpisodeSummary }>()
const emit = defineEmits<{ openWorkspace: [workspace: DesktopAgentRetainedWorkspace] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const name = ref('')
const saving = ref(false)
const issue = ref('')
const savedWorkspace = ref<DesktopAgentRetainedWorkspace>()
const canSave = computed(
  () =>
    props.episode.cleanupState === 'available' &&
    ['completed', 'stopped', 'failed'].includes(props.episode.state),
)

function open() {
  issue.value = ''
  name.value ||= 'optimization-' + props.episode.episodeId.slice(-12)
  dialog.value?.showModal()
}

function guardClose(event: Event) {
  if (saving.value) event.preventDefault()
}

function openSaved() {
  dialog.value?.close()
  if (savedWorkspace.value) emit('openWorkspace', savedWorkspace.value)
}

async function save() {
  if (!canSave.value || saving.value) return
  const { episodeId, providerId, agentSessionId } = props.episode
  saving.value = true
  issue.value = ''
  try {
    const result = await getDesktopApi().agent?.retainOptimizationCandidate({
      episodeId,
      providerId,
      sessionId: agentSessionId,
      name: name.value,
    })
    if (!result) throw new Error('Saving candidates is unavailable.')
    savedWorkspace.value = result
  } catch (error) {
    issue.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.result-action {
  padding: 0.4rem;
}

.result-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(42rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  padding: 1rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.75rem;
  background: var(--p-content-background);
  color: var(--p-content-color);
}

.result-dialog::backdrop {
  background: var(--p-mask-background);
}

header,
.result-save {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.result-table {
  overflow-x: auto;
  margin-block: 0.75rem;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.4rem;
  text-align: left;
  border-bottom: 1px solid var(--p-content-border-color);
}

label {
  display: grid;
  gap: 0.25rem;
}

input {
  padding: 0.35rem;
  border: 1px solid var(--p-content-border-color);
  color: inherit;
  background: inherit;
}
</style>
