<template>
  <button
    type="button"
    class="background-task-cancel"
    aria-label="Save optimization diagnostics"
    title="Save optimization diagnostics"
    :disabled="saving"
    @click="save"
  >
    <i class="ri-file-download-line" aria-hidden="true"></i>
  </button>
</template>

<script setup lang="ts">
import type { DesktopAgentOptimizationEpisodeSummary } from '@ecos-studio/shared'
import { ref } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'

const props = defineProps<{ episode: DesktopAgentOptimizationEpisodeSummary }>()
const { showToast } = useWorkspace()
const saving = ref(false)

async function save() {
  saving.value = true
  try {
    const {
      episodeId,
      state,
      startedAt,
      updatedAt,
      turnCount,
      inFlightCount,
      optimization,
    } = props.episode
    const saved = await getDesktopApi().dialog.saveFile({
      title: 'Save optimization diagnostics',
      defaultPath: `optimization-${episodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      content: JSON.stringify(
        {
          episodeId,
          state,
          startedAt,
          updatedAt,
          turnCount,
          inFlightCount,
          phase: optimization.phase ?? optimization.execution_state ?? optimization.state,
          objective: optimization.active_primary_metric,
          reason: optimization.rejection_reason ?? 'No failure detail was recorded.',
        },
        null,
        2,
      ),
    })
    if (saved)
      showToast({ severity: 'success', summary: 'Optimization diagnostics saved.' })
  } catch (error) {
    showToast({
      severity: 'error',
      summary: error instanceof Error ? error.message : String(error),
    })
  } finally {
    saving.value = false
  }
}
</script>
