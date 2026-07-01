<template>
  <div v-if="node.kind === 'directory'">
    <div
      v-if="node.path !== rootPath"
      class="flex items-center gap-2 px-2 py-1.5 text-sm text-(--text-primary)"
    >
      <i class="ri-folder-line shrink-0 text-yellow-500/80"></i>
      <span class="truncate">{{ node.name }}</span>
    </div>
    <div :class="node.path === rootPath ? '' : 'pl-4'">
      <DesignFileTransferTree
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :root-path="rootPath"
        :selected-paths="selectedPaths"
        @toggle="$emit('toggle', $event)"
        @add="$emit('add', $event)"
      />
    </div>
  </div>
  <button
    v-else
    type="button"
    class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200"
    :class="
      selectedPaths.includes(node.path)
        ? 'border border-(--accent-color)/30 bg-(--accent-color)/10'
        : 'border border-transparent hover:bg-(--bg-secondary)/60'
    "
    :title="`${node.name} — double-click to add`"
    @click="$emit('toggle', node.path)"
    @dblclick.prevent="$emit('add', node.path)"
  >
    <i class="ri-file-code-line shrink-0 text-blue-500"></i>
    <span class="truncate text-sm text-(--text-primary)">{{ node.name }}</span>
  </button>
</template>

<script setup lang="ts">
import type { RtlTreeNode } from '@/utils/rtlFileTree'

defineProps<{
  node: RtlTreeNode
  rootPath: string
  selectedPaths: string[]
}>()

defineEmits<{
  toggle: [filePath: string]
  add: [filePath: string]
}>()
</script>

<script lang="ts">
export default {
  name: 'DesignFileTransferTree',
}
</script>
