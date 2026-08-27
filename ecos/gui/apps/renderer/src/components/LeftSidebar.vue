<template>
  <nav
    class="flex h-full w-[64px] shrink-0 flex-col overflow-y-auto border-r border-(--border-color) bg-(--bg-sidebar) py-3"
    aria-label="Flow step navigation"
  >
    <router-link
      v-for="stage in flowStages"
      :key="stage.path"
      :to="workspaceStageLink(stage.path)"
      class="group relative mb-1 flex w-full min-w-0 flex-col items-center justify-center px-1 py-4 transition-all"
      :class="[
        currentStage === stage.path ? 'text-(--accent-color)' : 'text-(--text-secondary)',
      ]"
    >
      <span
        v-if="currentStage === stage.path"
        class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-(--accent-color) shadow-[0_0_10px_var(--accent-color)]"
        aria-hidden="true"
      />

      <span class="relative transition-transform group-hover:-translate-y-0.5">
        <i :class="stage.icon" class="mb-1.5 inline-block text-xl" aria-hidden="true" />
        <i
          v-if="stage.state === 'Success'"
          class="ri-checkbox-circle-fill absolute -top-0.5 right-0 rounded-full bg-(--bg-sidebar) text-[10px] text-green-500"
          aria-label="Completed"
        />
        <i
          v-else-if="stage.state === 'Skipped'"
          class="ri-skip-forward-fill absolute -top-0.5 right-0 rounded-full bg-(--bg-sidebar) text-[10px] text-(--text-secondary)"
          aria-label="Skipped"
        />
        <i
          v-else-if="stage.state === 'Ongoing'"
          class="ri-loader-4-line absolute -top-0.5 right-0 animate-spin rounded-full bg-(--bg-sidebar) text-[10px] text-blue-400"
          aria-label="Running"
        />
        <i
          v-else-if="stage.state === 'Pending'"
          class="ri-time-line absolute -top-0.5 right-0 rounded-full bg-(--bg-sidebar) text-[10px] text-(--text-secondary)"
          aria-label="Pending"
        />
        <i
          v-else-if="stage.state === 'Invalid'"
          class="ri-error-warning-fill absolute -top-0.5 right-0 rounded-full bg-(--bg-sidebar) text-[10px] text-red-500"
          aria-label="Failed"
        />
        <i
          v-else-if="stage.state === 'Incomplete'"
          class="ri-indeterminate-circle-fill absolute -top-0.5 right-0 rounded-full bg-(--bg-sidebar) text-[10px] text-amber-500"
          aria-label="Incomplete"
        />
      </span>

      <span
        class="w-full max-w-full text-center text-[8px] leading-tight font-bold break-words uppercase"
      >
        {{ stage.label }}
      </span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useFlowStages } from '@/composables/useFlowStages'

const { flowStages } = useFlowStages()
const { currentStage } = useCurrentStage()
const route = useRoute()

function workspaceStageLink(stagePath: string) {
  return {
    path: `/workspace/${stagePath}`,
    query: route.query,
  }
}
</script>
