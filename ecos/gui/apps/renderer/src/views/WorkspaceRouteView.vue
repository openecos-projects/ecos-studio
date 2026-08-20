<template>
  <FrontendWorkspaceView v-if="currentProject?.designTool === 'frontend'" />
  <HomeView v-else-if="isHomeRoute" />
  <WorkspaceView v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkspace } from '@/composables/useWorkspace'
import FrontendWorkspaceView from './FrontendWorkspaceView.vue'
import HomeView from './HomeView.vue'
import WorkspaceView from './WorkspaceView.vue'

const route = useRoute()
const { currentProject } = useWorkspace()

const isHomeRoute = computed(() => {
  return String(route.params.step || '') === '' || route.path.endsWith('/home')
})
</script>
