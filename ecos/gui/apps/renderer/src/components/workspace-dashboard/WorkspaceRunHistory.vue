<template>
  <button
    type="button"
    class="history-trigger"
    :disabled="!workspaceSession.workspaceId"
    @click="open"
  >
    <i class="ri-history-line" aria-hidden="true" />
    Run history
  </button>

  <dialog ref="dialog" class="run-history" :aria-labelledby="headingId" @close="reset">
    <header>
      <h2 :id="headingId">Run history</h2>
      <form method="dialog">
        <button type="submit" aria-label="Close run history" autofocus>
          <i class="ri-close-line" aria-hidden="true" />
        </button>
      </form>
    </header>
    <p v-if="issue" role="alert">{{ issue }}</p>
    <p v-if="loading && !runs.length" role="status">Loading runs…</p>
    <p v-else-if="!runs.length && !issue">No saved ECC run results in this Workspace.</p>
    <div
      v-if="runs.length"
      class="run-table"
      tabindex="0"
      role="region"
      aria-label="Run history table"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Run ID</th>
            <th scope="col">Finished</th>
            <th scope="col">Scope</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs" :key="run.runId">
            <td>
              <code>{{ run.runId }}</code>
            </td>
            <td>{{ new Date(run.finishedAt * 1000).toLocaleString() }}</td>
            <td>{{ scope(run) }}</td>
            <td>
              {{ stateLabels[run.state] }}
              <small v-if="run.error">{{ run.error.message }}</small>
            </td>
            <td>
              <button type="button" :disabled="busy" @click="viewLog(run)">
                View log
              </button>
              <button type="button" :disabled="busy" @click="saveDiagnostics(run)">
                Save diagnostics
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="cursor" type="button" :disabled="loading" @click="load(cursor)">
      Load older runs
    </button>
    <section v-if="log" aria-label="ECC run log">
      <h3>
        Run log <code>{{ log.runId }}</code>
      </h3>
      <p v-if="log.truncated">Showing the last 64 KiB.</p>
      <pre>{{ log.content || 'The run log is empty.' }}</pre>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import type {
  EccBackgroundOperationLogResult,
  EccRunHistoryEntry,
  EccRunHistoryRequest,
} from '@ecos-studio/shared'
import { ref, useId, watch } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'

const { workspaceSession, showToast } = useWorkspace()
const dialog = ref<HTMLDialogElement | null>(null)
const headingId = useId()
const runs = ref<EccRunHistoryEntry[]>([])
const cursor = ref<EccRunHistoryRequest['before']>()
const log = ref<(EccBackgroundOperationLogResult & { runId: string }) | null>(null)
const issue = ref('')
const loading = ref(false)
const busy = ref(false)
let generation = 0
const stateLabels = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}

watch(
  () => workspaceSession.value.workspaceId,
  () => {
    reset()
    dialog.value?.close()
  },
)

function reset() {
  generation += 1
  runs.value = []
  cursor.value = undefined
  log.value = null
  issue.value = ''
  loading.value = false
  busy.value = false
}

function open() {
  reset()
  dialog.value?.showModal()
  void load()
}

async function load(before?: EccRunHistoryRequest['before']) {
  const current = generation
  loading.value = true
  issue.value = ''
  try {
    const page = await getDesktopApi().ecc.runtime?.runHistory({
      workspaceHandle: workspaceSession.value.workspaceId,
      before,
    })
    if (!page) throw new Error('ECC run history is unavailable.')
    if (current !== generation) return
    runs.value = before ? [...runs.value, ...page.runs] : page.runs
    cursor.value = page.next
  } catch (error) {
    if (current === generation) issue.value = message(error)
  } finally {
    if (current === generation) loading.value = false
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function scope({ selection }: EccRunHistoryEntry) {
  if (selection.only) return selection.only
  if (selection.fromStep)
    return `${selection.fromStep} → ${selection.throughStep ?? 'end'}`
  return 'Full flow'
}

async function viewLog(run: EccRunHistoryEntry) {
  log.value = null
  await runAction(run, false)
}

async function saveDiagnostics(run: EccRunHistoryEntry) {
  await runAction(run, true)
}

async function runAction(run: EccRunHistoryEntry, includeDiagnostics: boolean) {
  const current = generation
  busy.value = true
  issue.value = ''
  try {
    const api = getDesktopApi()
    const result = await api.ecc.runtime?.operationLog({
      workspaceHandle: workspaceSession.value.workspaceId,
      operationId: run.runId,
      includeDiagnostics,
    })
    if (current !== generation) return
    if (!result) throw new Error('ECC run log is unavailable.')
    if (!includeDiagnostics) {
      log.value = { ...result, runId: run.runId }
      return
    }
    if (!result.diagnostics) throw new Error('ECC run diagnostics are unavailable.')
    const saved = await api.dialog.saveFile({
      title: 'Save run diagnostics',
      defaultPath: `ecc-run-${run.runId}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
      content: result.diagnostics,
    })
    if (saved) showToast({ severity: 'success', summary: 'Run diagnostics saved.' })
  } catch (error) {
    if (current === generation) issue.value = message(error)
  } finally {
    if (current === generation) busy.value = false
  }
}
</script>

<style scoped>
.history-trigger {
  white-space: nowrap;
}

.run-history {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(68rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  padding: 1rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.75rem;
  background: var(--p-content-background);
  color: var(--p-content-color);
}

.run-history::backdrop {
  background: var(--p-mask-background);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.run-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

th,
td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

td small {
  display: block;
}

td button,
.run-history > button {
  margin: 0.25rem;
}

pre {
  max-height: 16rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
