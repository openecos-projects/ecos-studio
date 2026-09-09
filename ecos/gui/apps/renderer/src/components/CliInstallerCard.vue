<template>
  <section class="cli-installer" aria-label="Command line tools">
    <div class="cli-installer__header">
      <div class="cli-installer__heading min-w-0 flex-1">
        <h3 class="cli-installer__title">Command line tools</h3>
        <p class="cli-installer__message selectable">
          {{ message }}
        </p>
      </div>
      <span class="cli-installer__state" role="status">{{ stateLabel }}</span>
    </div>

    <dl
      v-if="state?.versionDir || state?.shimPath"
      class="cli-installer__meta selectable"
    >
      <div v-if="state?.installedVersion" class="cli-installer__meta-row">
        <dt>Version</dt>
        <dd>{{ state.installedVersion }}</dd>
      </div>
      <div v-if="state?.versionDir" class="cli-installer__meta-row">
        <dt>Bundle</dt>
        <dd class="break-all">{{ state.versionDir }}</dd>
      </div>
      <div v-if="state?.shimPath" class="cli-installer__meta-row">
        <dt>Shim</dt>
        <dd class="break-all">{{ state.shimPath }}</dd>
      </div>
    </dl>

    <div
      v-if="activeJob"
      class="cli-installer__progress"
      role="progressbar"
      aria-label="ECC CLI install progress"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-live="polite"
    >
      <div class="cli-installer__progress-bar" aria-hidden="true">
        <span
          class="cli-installer__progress-fill"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <p class="cli-installer__progress-text">{{ progressText }}</p>
    </div>

    <p v-if="state?.error" class="cli-installer__error selectable" role="alert">
      {{ state.error }}
    </p>

    <div v-if="actionsVisible" class="cli-installer__actions">
      <button
        v-if="showInstall"
        type="button"
        class="cli-installer__action cli-installer__action--primary"
        :disabled="actionsDisabled"
        @click="runInstall"
      >
        {{ installLabel }}
      </button>
      <button
        v-if="showUninstall"
        type="button"
        class="cli-installer__action"
        :disabled="actionsDisabled"
        @click="runUninstall"
      >
        Uninstall
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  fetchCliInstallerStatus,
  installEccCli,
  subscribeCliInstallerProgress,
  uninstallEccCli,
  type CliInstallState,
  type CliInstallerProgressEvent,
} from '@/api/cliInstaller'

const state = ref<CliInstallState | null>(null)
/** Latest non-terminal progress event; cleared on done/error/cancelled. */
const activeJob = ref<CliInstallerProgressEvent | null>(null)
const busy = ref(false)
let unsubscribe: (() => void) | null = null

const terminalPhases = new Set(['done', 'error', 'cancelled'])

const stateLabel = computed(() => {
  switch (state.value?.status) {
    case 'unsupported':
      return 'Unsupported'
    case 'dev-wrapper':
      return 'Development'
    case 'not-installed':
      return 'Not installed'
    case 'installing':
      return 'Installing'
    case 'ready':
      return 'Ready'
    case 'self-check-failed':
      return 'Self-check failed'
    case 'failed':
      return 'Failed'
    default:
      return ''
  }
})

const message = computed(() => {
  switch (state.value?.status) {
    case 'unsupported':
      return 'The ecos-ecc host command currently requires Linux.'
    case 'dev-wrapper':
      return 'Development mode runs ecos-ecc from the repository wrapper (latest local source).'
    case 'not-installed':
      return 'Install the ecos-ecc host command to run ECC from any external terminal.'
    case 'installing':
      return activeJob.value?.message ?? 'Installing the ECC bundle...'
    case 'ready':
      return 'ecos-ecc is available from any external terminal.'
    case 'self-check-failed':
      return 'The bundle is installed but its self-check failed. See the hint below.'
    case 'failed':
      return 'The last install attempt failed. Retry, or start the GUI once to download the core component.'
    default:
      return ''
  }
})

const actionsVisible = computed(
  () => state.value?.status !== 'unsupported' && state.value !== null,
)

const showInstall = computed(() => {
  const status = state.value?.status
  return (
    status === 'not-installed' ||
    status === 'failed' ||
    status === 'installing' ||
    status === 'self-check-failed' ||
    status === 'ready' ||
    (status === 'dev-wrapper' && !state.value?.shimPath)
  )
})

const installLabel = computed(() =>
  state.value?.status === 'ready' ? 'Reinstall' : 'Install',
)

const showUninstall = computed(() => {
  const status = state.value?.status
  if (status === 'dev-wrapper') return Boolean(state.value?.shimPath)
  return status === 'ready' || status === 'self-check-failed'
})

const progressPercent = computed(() =>
  Math.min(100, Math.max(0, Math.round((activeJob.value?.progress ?? 0) * 100))),
)

const progressText = computed(() => activeJob.value?.message ?? 'Working...')

/** Buttons stay disabled while any install (including background drift) runs. */
const actionsDisabled = computed(
  () => busy.value || state.value?.status === 'installing' || activeJob.value !== null,
)

async function refreshStatus(): Promise<void> {
  try {
    const next = await fetchCliInstallerStatus()
    if (next) state.value = next
  } catch {
    // Bridge unavailable; keep the last known state instead of flickering.
  }
}

async function runInstall(): Promise<void> {
  busy.value = true
  if (state.value) {
    state.value = { ...state.value, status: 'installing', error: null }
  }
  try {
    state.value = await installEccCli()
  } catch (error) {
    if (state.value) {
      state.value = {
        ...state.value,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  } finally {
    busy.value = false
    await refreshStatus()
  }
}

async function runUninstall(): Promise<void> {
  busy.value = true
  try {
    state.value = await uninstallEccCli()
  } catch (error) {
    if (state.value) {
      state.value = {
        ...state.value,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  } finally {
    busy.value = false
    await refreshStatus()
  }
}

onMounted(() => {
  void refreshStatus()
  unsubscribe = subscribeCliInstallerProgress((event) => {
    if (terminalPhases.has(event.phase)) {
      activeJob.value = null
      void refreshStatus()
      return
    }
    // Startup acquisition (or another window) may be installing without any
    // local action: reflect it immediately.
    activeJob.value = event
    if (state.value?.status !== 'ready') {
      state.value = { ...(state.value ?? emptyState()), status: 'installing' }
    }
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})

function emptyState(): CliInstallState {
  return {
    status: 'installing',
    expectedVersion: '',
    installedVersion: null,
    source: null,
    versionDir: null,
    shimPath: null,
    selfCheck: null,
    error: null,
  }
}
</script>

<style scoped>
.cli-installer {
  width: 100%;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.625rem;
  background: var(--bg-secondary);
}

.cli-installer__header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.cli-installer__title {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
}

.cli-installer__message {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.cli-installer__state {
  flex-shrink: 0;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}

.cli-installer__meta {
  display: grid;
  gap: 0.35rem;
  margin: 0.75rem 0 0;
}

.cli-installer__meta-row {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: 0.5rem;
  margin: 0;
  font-size: 0.6875rem;
  line-height: 1.4;
}

.cli-installer__meta-row dt {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

.cli-installer__meta-row dd {
  margin: 0;
  color: var(--text-primary);
}

.cli-installer__progress {
  margin-top: 0.75rem;
}

.cli-installer__progress-bar {
  height: 0.25rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 80%, transparent);
}

.cli-installer__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-color);
  transition: width 160ms ease;
}

.cli-installer__progress-text {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.cli-installer__error {
  margin: 0.65rem 0 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.45;
}

.cli-installer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.875rem;
}

.cli-installer__action {
  min-height: 2.125rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
}

.cli-installer__action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cli-installer__action--primary {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
  color: var(--text-primary);
}

.cli-installer__action:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
}
</style>
