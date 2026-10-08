<template>
  <section class="macro-location-panel">
    <header class="macro-location-header">
      <div class="macro-location-title">
        <i class="ri-file-code-line" aria-hidden="true" />
        <div>
          <h3>macro_location.tcl</h3>
          <p>config/macro_location.tcl</p>
        </div>
      </div>
      <button
        type="button"
        class="btn-text macro-location-update"
        :disabled="disabled || loading || updating"
        title="Replace macro_location.tcl"
        @click="updateFile"
      >
        <i
          :class="updating ? 'ri-loader-4-line spin' : 'ri-upload-2-line'"
          aria-hidden="true"
        />
        {{ updating ? 'Updating…' : 'Update' }}
      </button>
    </header>

    <p v-if="error" class="macro-location-error" role="alert">
      <i class="ri-error-warning-line" aria-hidden="true" />
      {{ error }}
    </p>

    <div v-if="loading" class="macro-location-state">
      <i class="ri-loader-4-line spin" aria-hidden="true" />
      Loading file…
    </div>
    <div v-else-if="content === null" class="macro-location-state">
      <i class="ri-file-forbid-line" aria-hidden="true" />
      File not found
    </div>
    <Textarea
      v-else
      :model-value="content"
      auto-resize
      rows="10"
      readonly
      class="macro-location-textarea w-full font-mono text-[11px]"
      aria-label="macro_location.tcl content"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Textarea from 'primevue/textarea'
import { getDesktopApi } from '@/platform/desktop'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'

const MACRO_LOCATION_PATH = 'config/macro_location.tcl'

withDefaults(
  defineProps<{
    disabled?: boolean
  }>(),
  { disabled: false },
)

const workspaceLifecycle = useWorkspaceLifecycle()
const content = ref<string | null>(null)
const loading = ref(true)
const updating = ref(false)
const error = ref<string | null>(null)

async function refresh(): Promise<void> {
  const sessionId = workspaceLifecycle.currentSessionId.value
  const session = workspaceLifecycle.session.value
  if (!sessionId || session.state !== 'active' || !session.projectRoot) {
    content.value = null
    loading.value = false
    return
  }

  loading.value = true
  error.value = null
  try {
    const nextContent = await workspaceLifecycle.runForSession(sessionId, () =>
      readOptionalProjectTextFile(MACRO_LOCATION_PATH, {
        projectPath: session.projectRoot,
      }),
    )
    if (nextContent === undefined) return
    content.value = nextContent
  } catch (cause) {
    content.value = null
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (workspaceLifecycle.isCurrentSession(sessionId)) loading.value = false
  }
}

async function updateFile(): Promise<void> {
  if (updating.value) return
  const sessionId = workspaceLifecycle.currentSessionId.value
  if (!sessionId || workspaceLifecycle.session.value.state !== 'active') return

  error.value = null
  const selected = await getDesktopApi().dialog.pickFiles({
    title: 'Select macro_location.tcl',
    multiple: false,
    filters: [{ name: 'Tcl files', extensions: ['tcl'] }],
  })
  const sourcePath = selected?.[0]
  if (!sourcePath) return

  updating.value = true
  try {
    await workspaceLifecycle.runForSession(sessionId, () =>
      getDesktopApi().workspace.importMacroLocationFile(sourcePath),
    )
    if (!workspaceLifecycle.isCurrentSession(sessionId)) return
    await refresh()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    updating.value = false
  }
}

watch(
  [
    workspaceLifecycle.currentSessionId,
    () => workspaceLifecycle.session.value.state,
    () => workspaceLifecycle.resourceVersions.value['step-config'],
  ],
  () => {
    void refresh()
  },
  { immediate: true },
)
</script>

<style scoped>
.macro-location-panel {
  margin: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
}

.macro-location-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border-color);
  padding: 10px 12px;
}

.macro-location-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.macro-location-title > i {
  color: var(--accent-color);
  font-size: 16px;
}

.macro-location-title h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.macro-location-title p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 10px;
}

.macro-location-update {
  flex: 0 0 auto;
}

.macro-location-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 10px 12px 0;
  color: #fca5a5;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.macro-location-state {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  color: var(--text-secondary);
  font-size: 11px;
}

.macro-location-textarea {
  display: block;
  margin: 10px 12px 12px;
  width: calc(100% - 24px);
  min-height: 160px;
  resize: vertical;
}
</style>
