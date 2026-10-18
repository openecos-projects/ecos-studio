<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { isHdlFilePath, type PickedRtlSources } from '@ecos-studio/shared'
import DesignFileTransfer from './DesignFileTransfer.vue'

/**
 * Project-level RTL import selection (wizard step / project dialog).
 *
 * The selection is the single pending import handed to `ecc rtl import` at
 * creation time; a project that already declares design RTL passes its
 * imported source for display and reuse instead. RTL files and a filelist
 * are mutually exclusive.
 */
interface Props {
  verilog: string[]
  filelist: string
  importedSource?: { rtlList: string[]; filelist: string } | null
  showManualPath?: boolean
  manualInputName?: string
}

interface Emits {
  (e: 'update:selection', selection: { verilog: string[]; filelist: string }): void
}

const props = withDefaults(defineProps<Props>(), {
  importedSource: null,
  showManualPath: false,
  manualInputName: 'rtl-source-path',
})
const emit = defineEmits<Emits>()

const DIRECTORY_UPLOAD_FAILURE_MESSAGE =
  'Folder upload is not supported in this environment. Use "Select RTL files..." or "Select design folder..." instead.'

const isDraggingFiles = ref(false)
const isScanningDirectory = ref(false)
const directoryScanError = ref('')
const manualFilePickError = ref('')
const rtlSourceDirectory = ref<string | null>(null)
const scannedRtlFiles = ref<string[]>([])
const directorySelectedFiles = ref<string[]>([])
const manuallyAddedFiles = ref<string[]>([...props.verilog])
const showBrowseMenu = ref(false)
const manualSourcePath = ref('')

function uniquePaths(paths: string[]) {
  const unique: string[] = []
  for (const path of paths) {
    if (!unique.includes(path)) unique.push(path)
  }
  return unique
}

function getFileName(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path
}

function emitSelection(selection: { verilog: string[]; filelist: string }) {
  emit('update:selection', selection)
}

function syncSelection(nextFilelist?: string) {
  const verilog = uniquePaths([
    ...directorySelectedFiles.value,
    ...manuallyAddedFiles.value,
  ])
  const filelist =
    nextFilelist !== undefined ? nextFilelist : verilog.length > 0 ? '' : props.filelist
  emitSelection({ verilog, filelist })
}

// External updates (prefill, manifest-driven reuse reset) re-seed the local
// picker state; self-emitted selections round-trip as no-ops.
watch(
  () => props.verilog,
  (verilog) => {
    const nextVerilog = uniquePaths([
      ...directorySelectedFiles.value,
      ...manuallyAddedFiles.value,
    ])
    const changed =
      verilog.length !== nextVerilog.length ||
      verilog.some((path) => !nextVerilog.includes(path))
    if (!changed) return
    manuallyAddedFiles.value = [...verilog]
    directorySelectedFiles.value = []
    rtlSourceDirectory.value = null
    scannedRtlFiles.value = []
  },
)

function closeBrowseMenu() {
  showBrowseMenu.value = false
}

function toggleBrowseMenu() {
  showBrowseMenu.value = !showBrowseMenu.value
}

function showDirectoryUploadFailurePrompt() {
  manualFilePickError.value = DIRECTORY_UPLOAD_FAILURE_MESSAGE
}

async function browseRtlFiles() {
  closeBrowseMenu()
  manualFilePickError.value = ''
  directoryScanError.value = ''

  let result: PickedRtlSources | null = null
  try {
    result = await getDesktopApi().dialog.pickRtlSources({
      multiple: false,
      title: 'Select RTL Design Files',
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

  if (!result || result.files.length === 0) return
  if (result.directories.length > 0) {
    showDirectoryUploadFailurePrompt()
    return
  }

  const hdlFiles = result.files.filter((path) => isHdlFilePath(path))
  if (hdlFiles.length === 0) {
    manualFilePickError.value =
      'Please select RTL design files only (.v, .sv, .vhd, .vhdl, or .gz-compressed HDL).'
    return
  }

  addManualFiles(hdlFiles)
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

  if (!directoryPath) return
  await loadRtlDirectory(directoryPath)
}

async function loadRtlDirectory(directoryPath: string) {
  isScanningDirectory.value = true
  directoryScanError.value = ''
  try {
    const scanned = await getDesktopApi().workspace.scanRtlDirectory(directoryPath)
    rtlSourceDirectory.value = scanned.rootPath
    scannedRtlFiles.value = scanned.files
    directorySelectedFiles.value = [...scanned.files]
    syncSelection()
  } catch (error) {
    directoryScanError.value =
      error instanceof Error ? error.message : 'Failed to scan the selected directory.'
  } finally {
    isScanningDirectory.value = false
  }
}

function updateDirectorySelectedFiles(files: string[]) {
  directorySelectedFiles.value = files
  syncSelection()
}

function handleFileDrop(event: DragEvent) {
  isDraggingFiles.value = false
  manualFilePickError.value = ''
  const files = event.dataTransfer?.files
  if (!files) return

  const paths = Array.from(files)
    .map((file) => (file as File & { path?: string }).path ?? file.name)
    .filter((path): path is string => Boolean(path))
    .filter((path) => isHdlFilePath(path))

  if (paths.length === 0) {
    manualFilePickError.value =
      'Only RTL design files can be dropped here. Use Browse to select a folder.'
    return
  }

  addManualFiles(paths)
}

function addManualFiles(paths: string[]) {
  const existing = new Set([...manuallyAddedFiles.value, ...directorySelectedFiles.value])
  for (const path of paths) {
    if (!existing.has(path)) {
      manuallyAddedFiles.value.push(path)
      existing.add(path)
    }
  }
  syncSelection()
}

function removeManualFile(path: string) {
  manuallyAddedFiles.value = manuallyAddedFiles.value.filter((file) => file !== path)
  syncSelection()
}

function clearRtlSelection() {
  manuallyAddedFiles.value = []
  directorySelectedFiles.value = []
  rtlSourceDirectory.value = null
  scannedRtlFiles.value = []
}

const FILELIST_DIALOG_OPTIONS = {
  multiple: false,
  title: 'Select Filelist',
  filters: [
    {
      name: 'Filelist',
      extensions: ['f', 'fl', 'flist', 'filelist', 'lst', 'txt', 'gz'],
    },
    {
      // ECC writes the workspace filelist without an extension
      // (origin/filelist); keep it selectable in the dialog.
      name: 'All Files',
      extensions: ['*'],
    },
  ],
}

function isAllowedFilelistPath(path: string) {
  const lowerPath = path.toLowerCase()
  const matches = (extensions: string[]) =>
    extensions.some(
      (extension) =>
        lowerPath.endsWith(`.${extension}`) || lowerPath.endsWith(`.${extension}.gz`),
    )
  // Extension filters cannot match the extensionless ECC convention
  // (origin/filelist), so accept it by basename as well.
  return (
    matches(['f', 'fl', 'flist', 'filelist', 'lst', 'txt']) ||
    lowerPath.endsWith('/filelist')
  )
}

async function pickFilelist() {
  manualFilePickError.value = ''
  directoryScanError.value = ''

  let picked: string[] | null = null
  try {
    picked = await getDesktopApi().dialog.pickFiles(FILELIST_DIALOG_OPTIONS)
  } catch (error) {
    manualFilePickError.value =
      error instanceof Error ? error.message : 'Failed to import filelist.'
    return
  }

  const file = picked?.[0]
  if (!file) return
  if (!isAllowedFilelistPath(file)) {
    manualFilePickError.value = 'Please select a supported filelist file.'
    return
  }
  setFilelist(file)
}

function setFilelist(path: string) {
  clearRtlSelection()
  emitSelection({ verilog: [], filelist: path })
}

/**
 * Classify a manually entered source path (Quick Start project dialog):
 * filelist-like paths become the filelist selection, HDL paths join the
 * Verilog list. Complete-looking paths classify on input so programmatic
 * drivers do not need to click Add Source; the explicit apply also reports
 * unclassifiable values.
 */
function onManualSourceInput() {
  const path = manualSourcePath.value.trim()
  if (!path) return
  if (isAllowedFilelistPath(path)) {
    setFilelist(path)
  } else if (isHdlFilePath(path)) {
    addManualFiles([path])
  }
}

function applyManualSourcePath() {
  const path = manualSourcePath.value.trim()
  manualFilePickError.value = ''
  if (!path) return
  onManualSourceInput()
  if (isAllowedFilelistPath(path) || isHdlFilePath(path)) return
  manualFilePickError.value =
    'Enter an RTL source file (.v, .sv, .vhd, .vhdl, .gz) or a filelist path.'
}

const selectedCount = computed(() =>
  props.filelist
    ? 1
    : uniquePaths([...directorySelectedFiles.value, ...manuallyAddedFiles.value]).length,
)
</script>

<template>
  <div class="space-y-5">
    <div
      v-if="importedSource"
      class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-4"
    >
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-(--text-primary)">
          Imported in this project
        </h4>
        <span
          class="rounded-md bg-(--bg-secondary) px-2 py-0.5 text-xs text-(--text-secondary)"
          >Reused from the project rtl/ folder</span
        >
      </div>
      <p v-if="importedSource.filelist" class="text-xs text-(--text-secondary)">
        Filelist: <span class="break-all">{{ importedSource.filelist }}</span>
      </p>
      <ul
        v-else-if="importedSource.rtlList.length"
        class="custom-scrollbar max-h-36 space-y-1 overflow-y-auto pr-1"
      >
        <li
          v-for="file in importedSource.rtlList"
          :key="file"
          class="truncate text-xs text-(--text-secondary)"
        >
          {{ file }}
        </li>
      </ul>
      <p class="mt-2 text-xs text-(--text-secondary)">
        A new selection below replaces it for this creation.
      </p>
    </div>

    <div
      @dragover.prevent="isDraggingFiles = true"
      @dragleave.prevent="isDraggingFiles = false"
      @drop.prevent="handleFileDrop"
      class="rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200"
      :class="
        isDraggingFiles
          ? 'border-(--accent-color) bg-(--accent-color)/5'
          : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/45'
      "
    >
      <div
        class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-(--border-color) bg-(--bg-secondary)/50 text-(--text-secondary)"
      >
        <i class="ri-upload-cloud-2-line text-3xl"></i>
      </div>
      <h3 class="text-base font-bold text-(--text-primary)">Add RTL Design Files</h3>
      <p class="mt-2 text-sm text-(--text-secondary)">
        Supports .v, .sv, .vhd, .vhdl, and .gz-compressed RTL files or a design folder.
      </p>
      <div class="relative mt-5 inline-block">
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90"
          @click="toggleBrowseMenu"
        >
          Browse
          <i class="ri-arrow-down-s-line" :class="{ 'rotate-180': showBrowseMenu }"></i>
        </button>
        <div
          v-if="showBrowseMenu"
          class="absolute top-[calc(100%+0.5rem)] left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-lg border border-(--border-color) bg-(--bg-primary) shadow-lg"
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)/60"
            @click="browseRtlFiles"
          >
            <i class="ri-file-code-line text-blue-500"></i>
            Select RTL files...
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 border-t border-(--border-color)/60 px-4 py-3 text-left text-sm text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)/60"
            @click="browseRtlFolder"
          >
            <i class="ri-folder-open-line text-yellow-500"></i>
            Select design folder...
          </button>
        </div>
      </div>
      <p v-if="manualFilePickError" class="mt-5 text-xs text-red-500">
        {{ manualFilePickError }}
      </p>
      <p v-else-if="directoryScanError" class="mt-5 text-xs text-red-500">
        {{ directoryScanError }}
      </p>
      <p v-else-if="isScanningDirectory" class="mt-5 text-xs text-(--text-secondary)">
        <i class="ri-loader-4-line animate-spin"></i>
        Scanning RTL files in the selected directory...
      </p>
    </div>

    <div v-if="showManualPath" class="flex flex-col gap-3 md:flex-row">
      <input
        v-model="manualSourcePath"
        :name="manualInputName"
        type="text"
        placeholder="Or paste an RTL source / filelist path"
        class="min-w-0 flex-1 rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none"
        @input="onManualSourceInput"
        @change="applyManualSourcePath"
      />
      <button
        type="button"
        class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90"
        @click="applyManualSourcePath"
      >
        <i class="ri-add-line"></i>
        Add Source
      </button>
    </div>

    <DesignFileTransfer
      v-if="rtlSourceDirectory && scannedRtlFiles.length > 0"
      :root-path="rtlSourceDirectory"
      :all-files="scannedRtlFiles"
      :selected-files="directorySelectedFiles"
      @update:selected-files="updateDirectorySelectedFiles"
    />

    <div
      v-if="manuallyAddedFiles.length > 0"
      class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-4"
    >
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-(--text-primary)">Added RTL Files</h4>
        <span
          class="rounded-md bg-(--bg-secondary) px-2 py-0.5 text-xs text-(--text-secondary)"
          >{{ manuallyAddedFiles.length }}</span
        >
      </div>
      <div class="custom-scrollbar max-h-44 space-y-2 overflow-y-auto pr-1">
        <div
          v-for="file in manuallyAddedFiles"
          :key="file"
          class="flex items-center justify-between gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary)/25 px-3 py-2"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-(--text-primary)">
              {{ getFileName(file) }}
            </p>
            <p class="truncate text-xs text-(--text-secondary)">{{ file }}</p>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-(--text-secondary) transition-colors duration-200 hover:bg-red-500/10 hover:text-red-500"
            @click="removeManualFile(file)"
          >
            <i class="ri-delete-bin-line"></i>
          </button>
        </div>
      </div>
    </div>

    <div class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-5">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h4 class="text-sm font-semibold text-(--text-primary)">Use a Filelist</h4>
          <p class="mt-1 text-xs text-(--text-secondary)">
            Import an existing filelist instead of selecting RTL files. Exclusive with RTL
            files; copied into the project rtl/ folder with its sources.
          </p>
        </div>
        <span
          v-if="filelist"
          class="rounded-md border border-green-500/40 bg-green-500/10 px-2 py-1 text-xs font-semibold text-green-600"
          >Selected</span
        >
      </div>
      <div class="flex flex-col gap-3 md:flex-row">
        <input
          :value="filelist"
          readonly
          type="text"
          placeholder="No filelist selected"
          class="min-w-0 flex-1 rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none"
        />
        <button
          type="button"
          class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90"
          @click="pickFilelist"
        >
          <i class="ri-upload-2-line"></i>
          Import Filelist
        </button>
      </div>
      <p class="mt-3 text-xs text-(--text-secondary)">
        {{ selectedCount }} source{{ selectedCount === 1 ? '' : 's' }} selected for import
        into the project rtl/ folder.
      </p>
    </div>
  </div>
</template>
