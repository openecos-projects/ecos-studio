<template>
  <nav
    class="flex h-full w-[64px] shrink-0 flex-col overflow-y-auto border-r border-(--border-color) bg-(--bg-sidebar) py-3"
    aria-label="Workspace navigation"
  >
    <router-link
      v-for="stage in workspaceStages"
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

const route = useRoute()
const currentStage = 'home'
const workspaceStages = [{ label: 'Dashboard', path: 'home', icon: 'ri-dashboard-line' }]

function workspaceStageLink(stagePath: string) {
  return {
    path: `/workspace/${stagePath}`,
    query: route.query,
  }
}
</script>
