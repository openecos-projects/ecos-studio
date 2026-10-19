<template>
  <nav
    class="flex h-full w-[64px] shrink-0 flex-col overflow-y-auto border-r border-(--border-color) bg-(--bg-sidebar) py-3"
    aria-label="Workspace navigation"
  >
    <router-link
      v-for="stage in workspaceStages"
      :key="stage.id"
      :to="workspaceStageLink(stage.id)"
      class="group relative mb-1 flex w-full min-w-0 flex-col items-center justify-center px-1 py-4 transition-all"
      :class="[
        currentStage === stage.id ? 'text-(--accent-color)' : 'text-(--text-secondary)',
      ]"
    >
      <span
        v-if="currentStage === stage.id"
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
import { computed } from 'vue'
import { FLOW_INSIGHT_MODULES } from './flow-insights/flowInsightsModule'

const route = useRoute()
const currentStage = computed(() => route.query.insight ?? 'home')
const sidebarInsightModules = [
  ...FLOW_INSIGHT_MODULES.filter((module) => !['power', 'timing'].includes(module.id)),
  ...FLOW_INSIGHT_MODULES.filter((module) => module.id === 'timing'),
  ...FLOW_INSIGHT_MODULES.filter((module) => module.id === 'power'),
]
const workspaceStages = [
  { label: 'Dashboard', id: 'home', icon: 'ri-dashboard-line' },
  ...sidebarInsightModules.map((module) => ({
    label: module.title,
    id: module.id,
    icon: module.icon,
  })),
]

function workspaceStageLink(moduleId: string) {
  const { insight: _insight, ...query } = route.query
  return {
    path: '/workspace/home',
    query: moduleId === 'home' ? query : { ...query, insight: moduleId },
  }
}
</script>
