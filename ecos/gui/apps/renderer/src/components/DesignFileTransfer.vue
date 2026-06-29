<template>
  <div class="design-file-transfer">
    <div class="flex items-center justify-between gap-3 mb-3">
      <div class="min-w-0">
        <h4 class="text-sm font-semibold text-(--text-primary)">Directory Selection</h4>
        <p class="text-xs text-(--text-secondary) truncate mt-0.5" :title="rootPath">{{ rootPath }}</p>
      </div>
      <span class="text-xs font-medium text-(--text-secondary) shrink-0">
        {{ selectedFiles.length }} / {{ allFiles.length }} selected
      </span>
    </div>

    <div class="flex gap-3 min-h-64">
      <div class="flex-1 min-w-0 flex flex-col rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 overflow-hidden">
        <div class="px-4 py-2.5 border-b border-(--border-color)/60 bg-(--bg-secondary)/40">
          <span class="text-xs font-semibold uppercase tracking-wider text-(--text-secondary)">Available Files</span>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar p-2">
          <p v-if="availableFiles.length === 0" class="text-xs text-(--text-secondary) px-2 py-4 text-center">
            All RTL files in this directory are selected.
          </p>
          <DesignFileTransferTree
            v-else
            :node="availableTree"
            :root-path="rootPath"
            :selected-paths="leftSelection"
            @toggle="toggleLeftSelection"
            @add="addFile"
          />
        </div>
      </div>

      <div class="flex flex-col items-center justify-center gap-2 shrink-0">
        <button
          type="button"
          class="transfer-action"
          :disabled="leftSelection.length === 0"
          title="Add selected files"
          @click="addSelected"
        >
          <i class="ri-arrow-right-line"></i>
        </button>
        <button
          type="button"
          class="transfer-action"
          :disabled="availableFiles.length === 0"
          title="Add all files"
          @click="addAll"
        >
          <i class="ri-arrow-right-double-line"></i>
        </button>
        <button
          type="button"
          class="transfer-action"
          :disabled="rightSelection.length === 0"
          title="Remove selected files"
          @click="removeSelected"
        >
          <i class="ri-arrow-left-line"></i>
        </button>
        <button
          type="button"
          class="transfer-action"
          :disabled="selectedFiles.length === 0"
          title="Remove all files"
          @click="removeAll"
        >
          <i class="ri-arrow-left-double-line"></i>
        </button>
      </div>

      <div class="flex-1 min-w-0 flex flex-col rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 overflow-hidden">
        <div class="px-4 py-2.5 border-b border-(--border-color)/60 bg-(--bg-secondary)/40">
          <span class="text-xs font-semibold uppercase tracking-wider text-(--text-secondary)">Selected Files</span>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          <p v-if="selectedFiles.length === 0" class="text-xs text-(--text-secondary) px-2 py-4 text-center">
            No RTL files selected from this directory.
          </p>
          <button
            v-for="file in selectedFiles"
            :key="file"
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors duration-200 cursor-pointer"
            :class="rightSelection.includes(file)
              ? 'bg-(--accent-color)/10 border border-(--accent-color)/30'
              : 'hover:bg-(--bg-secondary)/60 border border-transparent'"
            :title="`${displayRelativePath(file)} — double-click to remove`"
            @click="toggleRightSelection(file)"
            @dblclick.prevent="removeFile(file)"
          >
            <i class="ri-file-code-line text-blue-500 shrink-0"></i>
            <span class="text-sm text-(--text-primary) truncate" :title="file">{{ displayRelativePath(file) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DesignFileTransferTree from './DesignFileTransferTree.vue'
import { buildRtlFileTree, filterRtlTreeFiles } from '@/utils/rtlFileTree'

const props = defineProps<{
  rootPath: string
  allFiles: string[]
  selectedFiles: string[]
}>()

const emit = defineEmits<{
  'update:selectedFiles': [files: string[]]
}>()

const leftSelection = ref<string[]>([])
const rightSelection = ref<string[]>([])

const availableFiles = computed(() =>
  props.allFiles.filter((file) => !props.selectedFiles.includes(file)),
)

const availableTree = computed(() => {
  const tree = buildRtlFileTree(props.rootPath, props.allFiles)
  return filterRtlTreeFiles(tree, availableFiles.value)
})

watch(
  () => [props.allFiles, props.selectedFiles] as const,
  () => {
    leftSelection.value = leftSelection.value.filter((file) => availableFiles.value.includes(file))
    rightSelection.value = rightSelection.value.filter((file) => props.selectedFiles.includes(file))
  },
)

function displayRelativePath(filePath: string): string {
  const normalizedRoot = props.rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedFile = filePath.replace(/\\/g, '/')
  const prefix = `${normalizedRoot}/`
  return normalizedFile.startsWith(prefix)
    ? normalizedFile.slice(prefix.length)
    : normalizedFile.split('/').pop() || normalizedFile
}

function toggleLeftSelection(filePath: string) {
  if (leftSelection.value.includes(filePath)) {
    leftSelection.value = leftSelection.value.filter((path) => path !== filePath)
    return
  }
  leftSelection.value = [...leftSelection.value, filePath]
}

function toggleRightSelection(filePath: string) {
  if (rightSelection.value.includes(filePath)) {
    rightSelection.value = rightSelection.value.filter((path) => path !== filePath)
    return
  }
  rightSelection.value = [...rightSelection.value, filePath]
}

function addSelected() {
  emit('update:selectedFiles', mergeSelected(leftSelection.value))
  leftSelection.value = []
}

function addFile(filePath: string) {
  emit('update:selectedFiles', mergeSelected([filePath]))
  leftSelection.value = leftSelection.value.filter((path) => path !== filePath)
}

function addAll() {
  emit('update:selectedFiles', mergeSelected(availableFiles.value))
  leftSelection.value = []
}

function removeSelected() {
  emit(
    'update:selectedFiles',
    props.selectedFiles.filter((file) => !rightSelection.value.includes(file)),
  )
  rightSelection.value = []
}

function removeFile(filePath: string) {
  emit(
    'update:selectedFiles',
    props.selectedFiles.filter((file) => file !== filePath),
  )
  rightSelection.value = rightSelection.value.filter((path) => path !== filePath)
}

function removeAll() {
  emit('update:selectedFiles', [])
  rightSelection.value = []
}

function mergeSelected(paths: string[]): string[] {
  const merged = new Set(props.selectedFiles)
  for (const path of paths) {
    merged.add(path)
  }
  return props.allFiles.filter((file) => merged.has(file))
}
</script>

<script lang="ts">
export default {
  name: 'DesignFileTransfer',
}
</script>

<style scoped>
.transfer-action {
  width: 2.25rem;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 40%, transparent);
  color: var(--text-primary);
  transition: background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
  cursor: pointer;
}

.transfer-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
}

.transfer-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 9999px;
}
</style>
