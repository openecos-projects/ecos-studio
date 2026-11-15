<template>
  <button
    v-if="enabled"
    type="button"
    class="replay-entry"
    title="Layout Replay"
    :disabled="busy"
    @click="openReplay"
  >
    <i class="ri-play-circle-line" aria-hidden="true" /> Replay
  </button>
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
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'

const { currentProject, resourceVersions } = useWorkspace()
const enabled = ref(false)
const busy = ref(false)
const showError = ref(false)
const error = ref('')
let generation = 0

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
  if (!projectPath) return
  const version = generation
  busy.value = true
  try {
    await getDesktopApi().chipViewer.open({ projectPath, step: 'replay', mode: 'replay' })
  } catch (cause) {
    if (version === generation) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      showError.value = true
    }
  } finally {
    busy.value = false
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
</style>
