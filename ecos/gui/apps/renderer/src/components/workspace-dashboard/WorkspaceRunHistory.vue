<template>
  <slot name="trigger" :open="open" :disabled="!workspaceSession.workspaceId" />

  <dialog ref="dialog" class="run-history" :aria-labelledby="headingId" @close="reset">
    <header class="run-history-heading">
      <h2 :id="headingId">Run history</h2>
      <form method="dialog">
        <button
          type="submit"
          class="run-history-close"
          aria-label="Close run history"
          autofocus
        >
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
            <th scope="col">Run scope</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs"
            :key="run.runId"
            :class="{ 'is-log-open': log?.runId === run.runId }"
          >
            <th scope="row" class="run-id">
              <code :title="run.runId">{{ run.runId }}</code>
            </th>
            <td>{{ new Date(run.finishedAt * 1000).toLocaleString() }}</td>
            <td>{{ scope(run) }}</td>
            <td>
              {{ stateLabels[run.state] }}
              <small v-if="run.error" class="run-error">{{ run.error.message }}</small>
            </td>
            <td>
              <div class="run-actions">
                <button
                  type="button"
                  class="run-action run-action--log"
                  :disabled="busy"
                  @click="viewLog(run)"
                >
                  <i class="ri-file-list-3-line" aria-hidden="true" />
                  View log
                </button>
                <button
                  type="button"
                  class="run-action"
                  :disabled="busy"
                  @click="saveDiagnostics(run)"
                >
                  <i class="ri-download-line" aria-hidden="true" />
                  Save diagnostics
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      v-if="cursor"
      type="button"
      class="run-action load-older-runs"
      :disabled="loading"
      @click="load(cursor)"
    >
      Load older runs
    </button>
    <section v-if="log" class="run-log" aria-label="ECC run log">
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
import { getStepMetadata } from '@/api/type'
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
  if (selection.only) return `${stepLabel(selection.only)} only`
  if (!selection.fromStep) return 'Run flow'
  const start = stepLabel(selection.fromStep)
  return selection.throughStep
    ? `${start} → ${stepLabel(selection.throughStep)}`
    : `Rerun from ${start}`
}

function stepLabel(step: string): string {
  return getStepMetadata(step)?.label ?? step
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
.run-history {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(70rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 0;
  overflow: auto;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.75rem;
  background: var(--p-content-background);
  color: var(--p-content-color);
}

.run-history[open] {
  display: flex;
  flex-direction: column;
}

.run-history::backdrop {
  background: var(--p-mask-background);
}

.run-history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.run-history-heading h2 {
  font-size: 1rem;
  font-weight: 600;
}

.run-history-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.run-history-close:hover {
  background: var(--bg-sidebar);
  color: var(--text-primary);
}

.run-history > p {
  padding: 1rem;
}

.run-table {
  container-type: inline-size;
  min-height: min(9rem, 35dvh);
  overflow: auto;
}

table {
  width: 100%;
  min-width: 36rem;
  border-collapse: separate;
  border-spacing: 0;
  text-align: left;
}

thead th {
  position: sticky;
  z-index: 1;
  top: 0;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
}

th,
td {
  padding: 0.625rem 0.5rem;
  border-bottom: 1px solid var(--p-content-border-color);
  vertical-align: top;
}

.run-id {
  font-weight: 400;
}

.run-id code {
  display: block;
  max-width: clamp(6.5rem, 23cqw, 17rem);
  overflow: hidden;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-error {
  display: block;
  max-width: 24rem;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.is-log-open {
  background: var(--info-bg);
}

.run-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

@container (min-width: 57rem) {
  th,
  td {
    padding-inline: 0.75rem;
  }

  .run-actions {
    flex-wrap: nowrap;
  }
}

.run-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2rem;
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--text-secondary);
  border-radius: 0.375rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
}

.run-action--log {
  background: var(--bg-secondary);
}

.run-action:enabled:hover {
  border-color: var(--text-primary);
  background: var(--bg-sidebar);
}

.run-action:enabled:active {
  background: color-mix(in srgb, var(--text-secondary) 18%, var(--bg-primary));
}

.run-action:focus-visible,
.run-history-close:focus-visible {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

.run-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.load-older-runs {
  align-self: flex-start;
  flex: none;
  margin: 0.625rem 0.75rem;
}

.run-log {
  flex: none;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.run-log h3 {
  margin-bottom: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

pre {
  max-height: min(12rem, 25dvh);
  padding: 0.625rem;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  background: var(--bg-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
