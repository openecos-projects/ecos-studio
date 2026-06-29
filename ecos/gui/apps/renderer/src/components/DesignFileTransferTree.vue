<template>
  <div v-if="node.kind === 'directory'">
    <div
      v-if="node.path !== rootPath"
      class="flex items-center gap-2 px-2 py-1.5 text-sm text-(--text-primary)"
    >
      <i class="ri-folder-line text-yellow-500/80 shrink-0"></i>
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
    class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors duration-200 cursor-pointer"
    :class="selectedPaths.includes(node.path)
      ? 'bg-(--accent-color)/10 border border-(--accent-color)/30'
      : 'hover:bg-(--bg-secondary)/60 border border-transparent'"
    :title="`${node.name} — double-click to add`"
    @click="$emit('toggle', node.path)"
    @dblclick.prevent="$emit('add', node.path)"
  >
    <i class="ri-file-code-line text-blue-500 shrink-0"></i>
    <span class="text-sm text-(--text-primary) truncate">{{ node.name }}</span>
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
