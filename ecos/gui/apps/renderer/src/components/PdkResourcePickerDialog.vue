<template>
  <div
    class="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
    @click.self="closeDialog"
  >
    <section
      class="flex h-[78vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-primary) shadow-[0_28px_70px_-24px_rgba(0,0,0,0.55)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdk-resource-picker-title"
    >
      <header class="flex shrink-0 items-start justify-between gap-4 border-b border-(--border-color) px-5 py-4">
        <div class="min-w-0">
          <p class="text-xs font-bold uppercase tracking-wide text-(--accent-color)">PDK Resource Selection</p>
          <h2 id="pdk-resource-picker-title" class="mt-1 text-xl font-bold text-(--text-primary)">
            {{ resourceTitle }}
          </h2>
          <p class="mt-1 text-xs text-(--text-secondary)">
            {{ directories.length }} folders · {{ availableFiles.length }} resource files
          </p>
        </div>
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-(--border-color) bg-(--bg-secondary)/60 text-(--text-secondary) transition-colors duration-200 hover:text-(--text-primary)"
          title="Close"
          @click="closeDialog"
        >
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="flex shrink-0 items-center gap-3 border-b border-(--border-color) bg-(--bg-secondary)/20 px-5 py-3">
        <label class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-primary)/80 px-3 py-2">
          <i class="ri-search-line text-(--text-secondary)"></i>
          <input
            v-model="searchQuery"
            type="text"
            class="min-w-0 flex-1 bg-transparent text-sm text-(--text-primary) outline-none"
            placeholder="Search file or folder"
          />
        </label>
        <span class="shrink-0 text-xs font-semibold text-(--text-secondary)">
          {{ draftSelectedFiles.length }} / {{ availableFiles.length }} selected
        </span>
      </div>

      <div class="grid min-h-0 flex-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)]">
        <section class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary)/20">
          <div class="flex items-center justify-between gap-3 border-b border-(--border-color)/60 bg-(--bg-secondary)/40 px-4 py-3">
            <div>
              <h3 class="text-sm font-bold text-(--text-primary)">PDK Folder Browser</h3>
              <p class="mt-0.5 text-xs text-(--text-secondary)">{{ filteredAvailableFiles.length }} available files</p>
            </div>
          </div>
          <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <p
              v-if="filteredAvailableFiles.length === 0"
              class="rounded-lg border border-dashed border-(--border-color) px-4 py-8 text-center text-xs text-(--text-secondary)"
            >
              No matching files.
            </p>
            <DesignFileTransferTree
              v-else
              :node="directoryTree"
              :root-path="rootPath"
              :selected-paths="availableSelection"
              @toggle="toggleAvailableSelection"
              @add="addFile"
            />
          </div>
        </section>

        <div class="flex flex-col items-center justify-center gap-3">
          <button
            type="button"
            class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-(--accent-color) bg-(--accent-color) text-white shadow-sm transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            title="Add to selection"
            :disabled="availableSelection.length === 0"
            @click="addSelected"
          >
            <i class="ri-arrow-right-line text-lg"></i>
          </button>
          <button
            type="button"
            class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-(--accent-color) bg-(--accent-color) text-white shadow-sm transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            title="Remove from selection"
            :disabled="selectedSelection.length === 0"
            @click="removeSelected"
          >
            <i class="ri-arrow-left-line text-lg"></i>
          </button>
        </div>

        <section class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary)/20">
          <div class="flex items-center justify-between gap-3 border-b border-(--border-color)/60 bg-(--bg-secondary)/40 px-4 py-3">
            <div>
              <h3 class="text-sm font-bold text-(--text-primary)">Selected Paths</h3>
              <p class="mt-0.5 text-xs text-(--text-secondary)">{{ draftSelectedFiles.length }} selected</p>
            </div>
          </div>
          <div class="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
            <p
              v-if="draftSelectedFiles.length === 0"
              class="rounded-lg border border-dashed border-(--border-color) px-4 py-8 text-center text-xs text-(--text-secondary)"
            >
              No file selected.
            </p>
            <button
              v-for="file in draftSelectedFiles"
              :key="file"
              type="button"
              class="flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors duration-200"
              :class="
                selectedSelection.includes(file)
                  ? 'border-(--accent-color)/40 bg-(--accent-color)/10'
                  : 'border-transparent hover:bg-(--bg-secondary)/60'
              "
              :title="file"
              @click="toggleSelectedSelection(file)"
            >
              <i class="ri-file-list-3-line shrink-0 text-(--accent-color)"></i>
              <span class="min-w-0">
                <span class="block truncate text-sm text-(--text-primary)">{{ displayRelativePath(file) }}</span>
                <span class="mt-1 block break-all font-mono text-[11px] text-(--text-secondary)">{{ file }}</span>
              </span>
            </button>
          </div>
        </section>
      </div>

      <footer class="flex shrink-0 items-center justify-end gap-3 border-t border-(--border-color) px-5 py-4">
        <button
          type="button"
          class="rounded-md border border-(--border-color) bg-(--bg-primary)/75 px-4 py-2 text-xs font-semibold text-(--text-primary) transition-colors duration-200 hover:border-(--accent-color)/45"
          @click="closeDialog"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-md bg-(--accent-color) px-4 py-2 text-xs font-bold text-white transition-opacity duration-200 hover:opacity-90"
          @click="saveSelection"
        >
          Save
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DesignFileTransferTree from './DesignFileTransferTree.vue'
import { buildRtlFileTree } from '@/utils/rtlFileTree'

const props = defineProps<{
  resourceTitle: string
  rootPath: string
  directories: string[]
  availableFiles: string[]
  selectedFiles: string[]
}>()

const emit = defineEmits<{
  close: []
  'update:selectedFiles': [files: string[]]
}>()

const searchQuery = ref('')
const draftSelectedFiles = ref<string[]>([...props.selectedFiles])
const availableSelection = ref<string[]>([])
const selectedSelection = ref<string[]>([])

const unselectedFiles = computed(() => {
  const selected = new Set(draftSelectedFiles.value)
  return props.availableFiles.filter((file) => !selected.has(file))
})

const filteredAvailableFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return unselectedFiles.value
  return unselectedFiles.value.filter((file) =>
    displayRelativePath(file).toLowerCase().includes(query),
  )
})

const directoryTree = computed(() => buildRtlFileTree(props.rootPath, filteredAvailableFiles.value))

watch(
  () => props.selectedFiles,
  (files) => {
    draftSelectedFiles.value = uniquePaths(files)
    selectedSelection.value = selectedSelection.value.filter((file) =>
      draftSelectedFiles.value.includes(file),
    )
  },
  { immediate: true },
)

watch(
  [filteredAvailableFiles, draftSelectedFiles],
  () => {
    availableSelection.value = availableSelection.value.filter((file) =>
      filteredAvailableFiles.value.includes(file),
    )
    selectedSelection.value = selectedSelection.value.filter((file) =>
      draftSelectedFiles.value.includes(file),
    )
  },
)

function closeDialog() {
  emit('close')
}

function displayRelativePath(filePath: string): string {
  const normalizedRoot = props.rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedFile = filePath.replace(/\\/g, '/')
  const prefix = `${normalizedRoot}/`
  return normalizedFile.startsWith(prefix)
    ? normalizedFile.slice(prefix.length)
    : normalizedFile.split('/').pop() || normalizedFile
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}

function addFiles(files: string[]) {
  draftSelectedFiles.value = uniquePaths([...draftSelectedFiles.value, ...files])
  availableSelection.value = availableSelection.value.filter((file) => !files.includes(file))
}

function addFile(file: string) {
  addFiles([file])
}

function addSelected() {
  addFiles(availableSelection.value)
}

function removeSelected() {
  const selected = new Set(selectedSelection.value)
  draftSelectedFiles.value = draftSelectedFiles.value.filter((file) => !selected.has(file))
  selectedSelection.value = []
}

function toggleAvailableSelection(file: string) {
  availableSelection.value = availableSelection.value.includes(file)
    ? availableSelection.value.filter((item) => item !== file)
    : [...availableSelection.value, file]
}

function toggleSelectedSelection(file: string) {
  selectedSelection.value = selectedSelection.value.includes(file)
    ? selectedSelection.value.filter((item) => item !== file)
    : [...selectedSelection.value, file]
}

function saveSelection() {
  emit('update:selectedFiles', uniquePaths(draftSelectedFiles.value))
  closeDialog()
}
</script>
