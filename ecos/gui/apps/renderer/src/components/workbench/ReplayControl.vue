<template>
  <button
    v-if="enabled"
    type="button"
    class="replay-entry"
    title="Layout Replay"
    :disabled="busy"
    @click="openReplay"
  >
    <i
      :class="busy ? 'ri-loader-4-line replay-spinner' : 'ri-play-circle-line'"
      aria-hidden="true"
    />
    {{ busy ? 'Opening Replay…' : 'Replay' }}
  </button>
  <Dialog
    :visible="busy"
    modal
    :closable="false"
    :close-on-escape="false"
    :draggable="false"
    header="Preparing Layout Replay"
    :style="{ width: '440px', maxWidth: '90vw' }"
  >
    <div class="replay-loading" role="status" aria-live="polite">
      <div class="replay-loading-heading">
        <i class="ri-loader-4-line replay-spinner" aria-hidden="true" />
        <strong :title="stepLabel">{{ stepLabel }}</strong>
      </div>
      <p class="replay-loading-phase" :title="progress?.phase">
        {{ progress?.phase || 'Preparing your workspace' }}
      </p>
      <div
        class="replay-loading-track"
        role="progressbar"
        aria-label="Replay preparation"
        :aria-valuenow="progressPercent"
        :aria-valuemin="0"
        :aria-valuemax="100"
      >
        <div :style="{ width: progressPercent + '%' }" />
      </div>
      <div class="replay-loading-counts">
        <span>{{
          progress?.steps ? 'Step ' + progress.step + ' / ' + progress.steps : 'Steps: —'
        }}</span>
        <span>{{
          progress?.frames
            ? 'Frame ' + progress.frame + ' / ' + progress.frames
            : 'Frames: —'
        }}</span>
      </div>
      <div class="replay-loading-footer">
        <span>Elapsed {{ elapsed }}s</span>
        <span>Large designs may take longer</span>
      </div>
    </div>
  </Dialog>
  <Dialog
    v-model:visible="showError"
    modal
    header="Layout Replay"
    :style="{ width: '400px' }"
  >
    <p role="alert">{{ error }}</p>
    <p>Replay becomes available after a run with capture enabled completes.</p>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ReplayLoadingProgress } from '@ecos-studio/shared'
import Dialog from 'primevue/dialog'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'

const { currentProject, resourceVersions } = useWorkspace()
const enabled = ref(false)
const busy = ref(false)
const showError = ref(false)
const error = ref('')
let generation = 0
let launchGeneration = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let elapsedTimer: ReturnType<typeof setInterval> | undefined
const progress = ref<ReplayLoadingProgress>()
const elapsed = ref(0)
const stepLabel = computed(() => progress.value?.name || 'Opening Replay')
const progressPercent = ref(0)

function stopLoading(): void {
  clearTimeout(pollTimer)
  clearInterval(elapsedTimer)
  busy.value = false
}

watch(
  () => currentProject.value?.path,
  () => {
    launchGeneration++
    stopLoading()
    showError.value = false
  },
)
onBeforeUnmount(() => {
  generation++
  launchGeneration++
  stopLoading()
})

watch(
  () => [
    currentProject.value?.path,
    resourceVersions.value.parameters,
    resourceVersions.value.all,
  ],
  async () => {
    const version = ++generation
    enabled.value = false
    showError.value = false
    if (!currentProject.value?.path) return
    try {
      const settings = await getDesktopApi().chipViewer.replaySettings()
      if (version === generation) enabled.value = settings.enabled
    } catch {
      /* An unavailable or older runtime has no Replay entry. */
    }
  },
  { immediate: true },
)

async function openReplay(): Promise<void> {
  const projectPath = currentProject.value?.path
  if (!projectPath || busy.value) return
  const version = ++launchGeneration
  busy.value = true
  showError.value = false
  progress.value = undefined
  progressPercent.value = 0
  elapsed.value = 0
  const started = Date.now()
  elapsedTimer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - started) / 1000)
  }, 1000)
  const request = { projectPath, step: 'replay', mode: 'replay' as const }
  const fail = (cause: unknown) => {
    if (version !== launchGeneration) return
    stopLoading()
    error.value = cause instanceof Error ? cause.message : String(cause)
    showError.value = true
  }
  const poll = async (): Promise<void> => {
    try {
      const status = await getDesktopApi().chipViewer.isOpen(request)
      if (version !== launchGeneration) return
      if (status.replayLoading?.state === 'ready') {
        stopLoading()
        return
      }
      if (!status.open || !status.replayLoading)
        throw new Error(
          'Replay closed before loading completed. Check the Chip Viewer log and try again.',
        )
      progress.value = status.replayLoading
      const p = progress.value
      if (p?.steps) {
        const fraction = p.frames > 0 ? p.frame / p.frames : 0
        progressPercent.value = Math.max(
          progressPercent.value,
          Math.round((100 * (Math.max(0, p.step - 1) + fraction)) / p.steps),
        )
      }
      pollTimer = setTimeout(() => {
        void poll()
      }, 200)
    } catch (cause) {
      fail(cause)
    }
  }
  try {
    await getDesktopApi().chipViewer.open(request)
    if (version === launchGeneration) await poll()
  } catch (cause) {
    fail(cause)
  }
}
</script>

<style scoped>
.replay-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}
.replay-entry:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
}
.replay-entry:disabled {
  opacity: 0.6;
  cursor: wait;
}
.replay-loading {
  height: 190px;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
}
.replay-loading-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
}
.replay-loading-heading > i {
  color: var(--accent-color);
  font-size: 24px;
  flex: 0 0 24px;
}
.replay-loading-heading > strong,
.replay-loading-phase {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.replay-loading-phase {
  margin: 4px 0 16px;
  height: 24px;
  line-height: 24px;
  color: var(--text-secondary);
}
.replay-loading-track {
  height: 5px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-tertiary, var(--border-color));
}
.replay-loading-track > div {
  height: 100%;
  background: var(--accent-color);
}
.replay-loading-counts,
.replay-loading-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
  height: 32px;
  align-items: center;
}
.replay-loading-footer {
  border-top: 1px solid var(--border-color);
  margin-top: 16px;
}
.replay-spinner {
  display: inline-block;
  animation: replay-spin 1s linear infinite;
}
@keyframes replay-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .replay-spinner {
    animation: none;
  }
}
</style>
