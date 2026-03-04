<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- 欢迎页面内容 -->
    <WelcomePage :recent-projects="recentProjects" @open-project="handleOpenProject" @new-project="handleNewProject"
      @import-project="handleImportProject" @open-recent="handleOpenRecent" @remove-recent="handleRemoveRecent" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import WelcomePage from '../components/WelcomePage.vue'
import { useWorkspace } from '../composables/useWorkspace'
import type { Project, WorkspaceConfig } from '../types'

const router = useRouter()
const { recentProjects, openProject, newProject, importProject, loadRecentProjects, removeRecentProject } = useWorkspace()

const handleOpenProject = async () => {
  const success = await openProject()
  if (success) router.push('/workspace')
}

const handleNewProject = async (config?: WorkspaceConfig) => {
  const success = await newProject(config)
  if (success) router.push('/workspace')
}

const handleImportProject = async () => {
  const success = await importProject()
  if (success) router.push('/workspace')
}

const handleOpenRecent = async (project: Project) => {
  const success = await openProject(project)
  if (success) router.push('/workspace')
}

const handleRemoveRecent = async (projectId: string) => {
  await removeRecentProject(projectId)
}

onMounted(async () => {
  await loadRecentProjects();
})
</script>
