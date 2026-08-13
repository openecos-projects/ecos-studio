<template>
  <div v-if="modelValue" class="design-files-dialog-overlay" @click.self="handleCancel">
    <div class="design-files-dialog">
      <div class="design-files-dialog-header">
        <div>
          <h3 class="text-lg font-semibold text-(--text-primary)">
            Manage RTL Design Files
          </h3>
          <p class="mt-1 text-xs text-(--text-secondary)">
            Browse folders or files, then use the transfer panel to add or remove RTL from
            this workspace.
          </p>
        </div>
        <button type="button" class="dialog-close" @click="handleCancel">
          <i class="ri-close-line"></i>
        </button>
      </div>

      <div class="design-files-dialog-body">
        <p v-if="loading" class="flex items-center gap-2 text-sm text-(--text-secondary)">
          <i class="ri-loader-4-line animate-spin"></i>
          Loading workspace RTL files...
        </p>
        <p v-else-if="loadError" class="text-sm text-red-500">{{ loadError }}</p>

        <template v-else>
          <div
            class="relative rounded-2xl border-2 border-dashed p-6 text-center transition-colors duration-200"
            :class="
              isDraggingFiles
                ? 'border-(--accent-color) bg-(--accent-color)/5'
                : 'border-(--border-color) bg-(--bg-secondary)/20'
            "
            @dragover.prevent="isDraggingFiles = true"
            @dragleave.prevent="isDraggingFiles = false"
            @drop.prevent="handleFileDrop"
          >
            <div class="flex flex-col items-center">
              <div
                class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-(--border-color) bg-(--bg-secondary)/50"
              >
                <i class="ri-upload-cloud-2-line text-3xl text-(--text-secondary)"></i>
              </div>
              <h4 class="mb-1 text-base font-semibold text-(--text-primary)">
                Add RTL Design Files
              </h4>
              <p class="mb-4 max-w-md text-sm text-(--text-secondary)">
                Browse individual HDL files or scan a design folder to populate the
                transfer panel.
              </p>
              <div class="relative">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-xl bg-(--accent-color) px-6 py-2.5 font-medium text-white hover:opacity-90"
                  @click="toggleBrowseMenu"
                >
                  Browse
                  <i
                    class="ri-arrow-down-s-line transition-transform duration-200"
                    :class="{ 'rotate-180': showBrowseMenu }"
                  ></i>
                </button>
                <div
                  v-if="showBrowseMenu"
                  class="absolute top-[calc(100%+0.5rem)] left-1/2 z-20 w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-primary) shadow-lg"
                >
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-(--text-primary) hover:bg-(--bg-secondary)/60"
                    @click="browseRtlFiles"
                  >
                    <i class="ri-file-code-line text-blue-500"></i>
                    Select RTL files...
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 border-t border-(--border-color)/60 px-4 py-3 text-left text-sm text-(--text-primary) hover:bg-(--bg-secondary)/60"
                    @click="browseRtlFolder"
                  >
                    <i class="ri-folder-open-line text-yellow-500/80"></i>
                    Select design folder...
                  </button>
                </div>
              </div>

              <div
                v-if="isScanningDirectory"
                class="mt-4 flex items-center justify-center gap-2 text-sm text-(--text-secondary)"
              >
                <i class="ri-loader-4-line animate-spin"></i>
                Scanning RTL files in the selected directory...
              </div>
              <p v-else-if="manualFilePickError" class="mt-4 text-xs text-red-500">
                {{ manualFilePickError }}
              </p>
              <p v-else-if="directoryScanError" class="mt-4 text-xs text-red-500">
                {{ directoryScanError }}
              </p>
            </div>
          </div>

          <DesignFileTransfer
            v-if="rtlSourceDirectory && scannedRtlFiles.length > 0"
            class="mt-6"
            :root-path="rtlSourceDirectory"
            :all-files="scannedRtlFiles"
            :selected-files="directorySelectedFiles"
            @update:selected-files="updateDirectorySelectedFiles"
          />

          <p
            v-else-if="
              rtlSourceDirectory && !isScanningDirectory && scannedRtlFiles.length === 0
            "
            class="mt-4 flex items-center gap-1 text-xs text-(--text-secondary)"
          >
            <i class="ri-information-line"></i>
            No RTL files were found in the selected directory.
          </p>

          <div class="mt-6 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-semibold text-(--text-primary)">
                Workspace RTL Files
                <span class="ml-2 rounded-full bg-(--bg-secondary) px-2 py-0.5 text-xs">{{
                  workingPaths.length
                }}</span>
              </h4>
            </div>
            <p
              v-if="workingPaths.length === 0"
              class="px-1 text-sm text-(--text-secondary)"
            >
              No RTL files in this workspace yet. Browse files or a folder above to add
              some.
            </p>
            <div v-else class="custom-scrollbar max-h-52 space-y-2 overflow-y-auto pr-1">
              <div
                v-for="file in workingPaths"
                :key="file"
                class="group flex items-center justify-between rounded-xl border border-(--border-color) bg-(--bg-secondary)/30 px-4 py-3 transition-colors duration-200 hover:bg-(--bg-secondary)/60"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <i class="ri-file-code-line shrink-0 text-blue-500"></i>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-(--text-primary)">
                      {{ basename(file) }}
                    </p>
                    <p class="truncate text-xs text-(--text-secondary) opacity-70">
                      {{ file }}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--text-secondary) opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500"
                  title="Remove from workspace"
                  @click="removeWorkspaceFile(file)"
                >
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="design-files-dialog-footer">
        <button
          type="button"
          class="dialog-btn dialog-btn-secondary"
          :disabled="saving"
          @click="handleCancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="dialog-btn dialog-btn-primary"
          :disabled="loading || saving || !hasChanges"
          @click="handleSave"
        >
          <i v-if="saving" class="ri-loader-4-line mr-1 animate-spin"></i>
          Save Changes
        </button>
      </div>
    </div>

    <div v-if="showRunResultsConfirm" class="design-files-confirm-overlay">
      <div class="design-files-confirm-dialog">
        <h4 class="text-base font-semibold text-(--text-primary)">
          Keep Current Run Results?
        </h4>
        <p class="mt-2 text-sm leading-relaxed text-(--text-secondary)">
          RTL design files were updated. Do you want to keep the existing flow run results
          and artifacts in this workspace?
        </p>
        <p class="mt-3 text-xs leading-relaxed text-(--text-secondary)">
          Choosing
          <span class="font-medium text-(--text-primary)">Clear and Reset</span> reuses
          the same cleanup logic as ReRun: step outputs are removed and home/flow state is
          reset.
        </p>
        <div class="design-files-confirm-actions">
          <button
            type="button"
            class="dialog-btn dialog-btn-secondary"
            :disabled="clearingRunResults"
            @click="handleKeepRunResults"
          >
            Keep Results
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn-danger"
            :disabled="clearingRunResults"
            @click="handleClearRunResults"
          >
            <i v-if="clearingRunResults" class="ri-loader-4-line mr-1 animate-spin"></i>
            Clear and Reset
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  isHdlFilePath,
  type PickedRtlSources,
  type WorkspaceDesignFileEntry,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'
import { useWorkspace } from '@/composables/useWorkspace'
import { resetFlowApi } from '@/api/flow'
import { CMDEnum } from '@/api/type'
import { requestHomeRunArtifactReset } from '@/composables/homeRunArtifacts'
import DesignFileTransfer from './DesignFileTransfer.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { currentProject, showToast, invalidateWorkspaceResources, workspaceSession } =
  useWorkspace()

const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const initialEntries = ref<WorkspaceDesignFileEntry[]>([])
const workingPaths = ref<string[]>([])

const showBrowseMenu = ref(false)
const isDraggingFiles = ref(false)
const isScanningDirectory = ref(false)
const manualFilePickError = ref('')
const directoryScanError = ref('')
const rtlSourceDirectory = ref('')
const scannedRtlFiles = ref<string[]>([])
const directorySelectedFiles = ref<string[]>([])
const showRunResultsConfirm = ref(false)
const clearingRunResults = ref(false)
const DIRECTORY_UPLOAD_FAILURE_MESSAGE =
  'Folders cannot be uploaded from Select RTL files. Use Select design folder to scan a folder.'

const hasChanges = computed(() => {
  const initial = new Set(initialEntries.value.map((entry) => entry.resolvedPath))
  const working = new Set(workingPaths.value)
  if (initial.size !== working.size) {
    return true
  }
  for (const path of initial) {
    if (!working.has(path)) {
      return true
    }
  }
  return false
})

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

function resetBrowseState() {
  showBrowseMenu.value = false
  manualFilePickError.value = ''
  directoryScanError.value = ''
  rtlSourceDirectory.value = ''
  scannedRtlFiles.value = []
  directorySelectedFiles.value = []
  showRunResultsConfirm.value = false
  clearingRunResults.value = false
}

async function loadWorkspaceFiles() {
  loading.value = true
  loadError.value = ''
  resetBrowseState()
  try {
    const entries = await getDesktopApi().workspace.listDesignFiles()
    initialEntries.value = entries
    workingPaths.value = entries.map((entry) => entry.resolvedPath)
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : 'Failed to load workspace RTL files.'
    initialEntries.value = []
    workingPaths.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      void loadWorkspaceFiles()
    }
  },
)

function closeBrowseMenu() {
  showBrowseMenu.value = false
}

function toggleBrowseMenu() {
  showBrowseMenu.value = !showBrowseMenu.value
}

function addPathsToWorkspace(paths: string[]) {
  const merged = new Set(workingPaths.value)
  for (const path of paths) {
    merged.add(path)
  }
  workingPaths.value = [...merged]
}

function removeWorkspaceFile(path: string) {
  workingPaths.value = workingPaths.value.filter((entry) => entry !== path)
  directorySelectedFiles.value = directorySelectedFiles.value.filter(
    (entry) => entry !== path,
  )
}

function updateDirectorySelectedFiles(files: string[]) {
  directorySelectedFiles.value = files
  const scannedSet = new Set(scannedRtlFiles.value)
  workingPaths.value = workingPaths.value.filter(
    (path) => !scannedSet.has(path) || files.includes(path),
  )
  addPathsToWorkspace(files)
}

function showDirectoryUploadFailurePrompt() {
  manualFilePickError.value = DIRECTORY_UPLOAD_FAILURE_MESSAGE
  showToast({
    severity: 'warn',
    summary: 'Folder Upload Failed',
    detail: DIRECTORY_UPLOAD_FAILURE_MESSAGE,
    life: 15000,
  })
}

async function browseRtlFiles() {
  closeBrowseMenu()
  manualFilePickError.value = ''
  directoryScanError.value = ''

  let picked: PickedRtlSources | null = null
  try {
    picked = await getDesktopApi().dialog.pickRtlSources({
      multiple: false,
      title: 'Add RTL Design Files',
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not folders')) {
      showDirectoryUploadFailurePrompt()
      return
    }

    manualFilePickError.value =
      error instanceof Error ? error.message : 'Failed to select RTL design files.'
    return
  }

  if (!picked || picked.files.length === 0) {
    return
  }

  if (picked.directories.length > 0) {
    showDirectoryUploadFailurePrompt()
    return
  }

  const hdlFiles = picked.files.filter((path) => isHdlFilePath(path))
  if (hdlFiles.length === 0) {
    manualFilePickError.value =
      'Please select RTL design files only (.v, .sv, .vhd, .vhdl, or .gz-compressed HDL).'
    return
  }

  addPathsToWorkspace(hdlFiles)
}

async function browseRtlFolder() {
  closeBrowseMenu()
  manualFilePickError.value = ''
  directoryScanError.value = ''

  let directoryPath: string | null = null
  try {
    directoryPath = await getDesktopApi().dialog.pickDirectory({
      title: 'Select RTL Design Folder',
    })
  } catch (error) {
    directoryScanError.value =
      error instanceof Error ? error.message : 'Please select a folder, not a file.'
    return
  }

  if (!directoryPath) {
    return
  }

  isScanningDirectory.value = true
  directoryScanError.value = ''
  try {
    const scanned = await getDesktopApi().workspace.scanRtlDirectory(directoryPath)
    rtlSourceDirectory.value = scanned.rootPath
    scannedRtlFiles.value = scanned.files
    directorySelectedFiles.value = scanned.files.filter((file) =>
      workingPaths.value.includes(file),
    )
  } catch (error) {
    directoryScanError.value =
      error instanceof Error ? error.message : 'Failed to scan the selected directory.'
  } finally {
    isScanningDirectory.value = false
  }
}

function handleFileDrop(event: DragEvent) {
  isDraggingFiles.value = false
  manualFilePickError.value = ''
  const files = event.dataTransfer?.files
  if (!files) {
    return
  }

  const paths = Array.from(files)
    .map((file) => (file as File & { path?: string }).path ?? file.name)
    .filter((path): path is string => Boolean(path))
    .filter((path) => isHdlFilePath(path))

  if (paths.length === 0) {
    manualFilePickError.value =
      'Only RTL design files can be dropped here. Use Browse to select a folder.'
    return
  }

  addPathsToWorkspace(paths)
}

function handleCancel() {
  if (saving.value || clearingRunResults.value) {
    return
  }
  showRunResultsConfirm.value = false
  emit('update:modelValue', false)
}

function closeDialog() {
  showRunResultsConfirm.value = false
  emit('update:modelValue', false)
}

async function handleKeepRunResults() {
  closeDialog()
}

async function handleClearRunResults() {
  const projectPath = currentProject.value?.path
  if (!projectPath) {
    closeDialog()
    return
  }

  clearingRunResults.value = true
  try {
    const result = await resetFlowApi({
      cmd: CMDEnum.reset_flow,
      data: {
        directory: projectPath,
        workspaceHandle: workspaceSession.value.workspaceId,
      },
    })
    if (result.response !== 'success') {
      throw new Error(result.message?.[0] || 'Failed to reset workspace run results.')
    }

    requestHomeRunArtifactReset(projectPath)
    invalidateWorkspaceResources('all')

    showToast({
      severity: 'success',
      summary: 'Workspace Reset',
      detail: 'Previous flow run results were cleared.',
      life: 15000,
    })
    closeDialog()
  } catch (error) {
    showToast({
      severity: 'error',
      summary: 'Reset Failed',
      detail:
        error instanceof Error ? error.message : 'Failed to clear workspace run results.',
      life: 15000,
    })
  } finally {
    clearingRunResults.value = false
  }
}

async function handleSave() {
  if (!hasChanges.value || saving.value) {
    return
  }

  saving.value = true
  const initialSet = new Set(initialEntries.value.map((entry) => entry.resolvedPath))
  const workingSet = new Set(workingPaths.value)
  const toRemove = initialEntries.value.filter(
    (entry) => !workingSet.has(entry.resolvedPath),
  )
  const toAdd = workingPaths.value.filter((path) => !initialSet.has(path))

  try {
    for (const entry of toRemove) {
      const removed = await getDesktopApi().workspace.removeDesignFile(
        entry.filelistEntry,
      )
      if (!removed) {
        throw new Error(`Failed to remove ${entry.basename} from the workspace filelist.`)
      }
    }

    if (toAdd.length > 0) {
      const result = await getDesktopApi().workspace.addDesignFiles(toAdd)
      if (result.skipped.length > 0) {
        showToast({
          severity: 'warn',
          summary: 'Some Files Skipped',
          detail: result.skipped
            .map((entry) => `${entry.path}: ${entry.reason}`)
            .join('\n'),
          life: 15000,
        })
      }
    }

    showToast({
      severity: 'success',
      summary: 'RTL Files Updated',
      detail: `${toAdd.length} added, ${toRemove.length} removed.`,
      life: 15000,
    })
    showRunResultsConfirm.value = true
  } catch (error) {
    showToast({
      severity: 'error',
      summary: 'Save RTL Files Failed',
      detail:
        error instanceof Error ? error.message : 'Failed to update workspace filelist.',
      life: 15000,
    })
  } finally {
    saving.value = false
  }
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.relative')) {
    return
  }
  closeBrowseMenu()
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<style scoped>
.design-files-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  padding: 24px;
}

.design-files-dialog {
  position: relative;
  width: min(960px, 100%);
  max-height: min(85vh, 820px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}

.design-files-dialog-header,
.design-files-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}

.design-files-dialog-footer {
  border-bottom: none;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  justify-content: flex-end;
  gap: 12px;
}

.design-files-dialog-body {
  overflow: auto;
  padding: 20px;
}

.dialog-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.dialog-close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.dialog-btn {
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-btn-secondary {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
}

.dialog-btn-primary {
  border: none;
  background: var(--accent-color);
  color: white;
}

.dialog-btn-danger {
  border: none;
  background: #ef4444;
  color: white;
}

.design-files-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 16px;
}

.design-files-confirm-dialog {
  width: min(420px, calc(100% - 32px));
  padding: 20px;
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.25);
}

.design-files-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
</style>
