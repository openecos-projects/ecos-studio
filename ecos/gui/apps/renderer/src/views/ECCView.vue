<template>
  <div
    class="flex flex-col items-center min-h-full w-full text-(--text-primary) relative overflow-y-auto overflow-x-hidden py-8">

    <!-- 返回按钮 -->
    <button @click="goBack"
      class="absolute top-6 left-6 z-20 flex items-center gap-2 px-3 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color) hover:border-(--accent-color) text-(--text-secondary) hover:text-(--accent-color) transition-all duration-200 cursor-pointer text-sm">
      <i class="ri-arrow-left-line"></i>
      <span>Back to ECOS</span>
    </button>

    <div class="relative z-10 my-auto flex flex-col items-center w-full">
      <!-- Logo 和标题 -->
      <div class="flex items-center justify-center mb-12">
        <div class="relative">
          <div class="absolute -inset-4 bg-(--accent-color)/10 rounded-full blur-xl"></div>
          <i class="ri-cpu-line text-6xl text-(--accent-color) relative"></i>
        </div>
        <div class="flex flex-col ml-5">
          <h1 class="text-4xl font-bold text-(--text-primary) tracking-tight">ECC</h1>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-5 mb-16">
        <button @click="handleOpenProject"
          class="group flex flex-col items-center gap-3 px-8 py-6 bg-(--bg-secondary) hover:bg-(--bg-sidebar) rounded-xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 border border-(--border-color) hover:border-(--accent-color) min-w-[180px] cursor-pointer shadow-sm hover:shadow-lg hover:shadow-(--accent-color)/5">
          <div
            class="w-14 h-14 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors">
            <i
              class="ri-book-open-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">Open Workspace</span>
        </button>

        <button @click="openWizard"
          class="group flex flex-col items-center gap-3 px-8 py-6 bg-(--bg-secondary) hover:bg-(--bg-sidebar) rounded-xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 border border-(--border-color) hover:border-(--accent-color) min-w-[180px] cursor-pointer shadow-sm hover:shadow-lg hover:shadow-(--accent-color)/5">
          <div
            class="w-14 h-14 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors">
            <i
              class="ri-folder-open-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">New Workspace</span>
        </button>

      </div>

      <!-- 最近项目 -->
      <div class="w-full max-w-3xl px-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-(--text-primary) flex items-center gap-2">
            <i class="ri-time-line text-(--text-secondary)"></i>
            Recent Workspaces
          </h2>
          <button v-if="recentProjects.length > 3" @click="showAllProjects = !showAllProjects"
            class="text-sm text-(--accent-color) hover:opacity-80 transition-opacity cursor-pointer flex items-center gap-1">
            <template v-if="showAllProjects">
              Collapse
              <i class="ri-arrow-up-s-line"></i>
            </template>
            <template v-else>
              View All ({{ recentProjects.length }})
              <i class="ri-arrow-right-s-line"></i>
            </template>
          </button>
        </div>

        <div v-if="recentProjects.length === 0"
          class="text-center py-16 text-(--text-secondary) bg-(--bg-secondary)/50 rounded-xl border border-dashed border-(--border-color)">
          <i class="ri-folder-2-line text-5xl mb-4 opacity-30 block"></i>
          <p class="text-sm">No recent workspaces</p>
          <p class="text-xs mt-2 opacity-60">Click "New Workspace" to start your chip design journey</p>
        </div>

        <div v-else class="space-y-2 max-h-[min(42vh,420px)] overflow-y-auto overscroll-contain scrollbar-thin pr-1">
          <div v-for="project in displayedProjects" :key="project.id"
            class="w-full flex items-center justify-between px-5 py-4 bg-(--bg-secondary) rounded-xl transition-all duration-200 border text-left group"
            :class="project.workspaceRecognized === false
              ? 'border-(--border-color) opacity-55 cursor-default'
              : 'border-(--border-color) hover:border-(--accent-color) hover:bg-(--bg-sidebar) cursor-pointer hover:shadow-md'"
            @click="project.workspaceRecognized !== false && handleOpenRecent(project)">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center transition-colors" :class="project.workspaceRecognized === false
                ? 'bg-red-500/10'
                : 'bg-(--accent-color)/10 group-hover:bg-(--accent-color)/20'">
                <i :class="project.workspaceRecognized === false
                  ? 'ri-folder-warning-line text-lg text-red-400'
                  : 'ri-folder-line text-lg text-(--accent-color)'"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap min-w-0">
                  <p class="font-medium truncate min-w-0"
                    :class="project.workspaceRecognized === false ? 'text-(--text-secondary)' : 'text-(--text-primary)'">
                    {{ project.name }}
                  </p>
                  <span v-if="project.pdk"
                    class="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-color)/10 text-(--accent-color) font-medium shrink-0">
                    {{ project.pdk }}
                  </span>
                  <span v-if="project.status" :class="statusBadgeClass(project.status)"
                    class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0">
                    {{ statusLabel(project.status) }}
                  </span>
                </div>
                <p v-if="project.completedSteps != null && project.totalSteps"
                  class="text-[11px] text-(--text-secondary) mt-0.5">
                  {{ project.completedSteps }}/{{ project.totalSteps }} steps
                </p>
                <div class="flex items-center gap-2 mt-0.5">
                  <p class="text-xs text-(--text-secondary) truncate">{{ project.path }}</p>
                  <span v-if="project.workspaceRecognized === false"
                    class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                    Workspace not recognized
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs text-(--text-secondary) group-hover:text-(--text-primary) transition-colors whitespace-nowrap">
                {{ formatDate(project.lastOpened) }}
              </span>
              <button @click.stop="handleRemoveRecent(project.id)"
                class="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer"
                title="Remove from list">
                <i class="ri-close-line text-sm text-(--text-secondary) hover:text-red-500"></i>
              </button>
              <i v-if="project.workspaceRecognized !== false"
                class="ri-arrow-right-s-line text-(--text-secondary) opacity-0 group-hover:opacity-100 transition-opacity"></i>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- New Project Wizard Modal -->
    <NewProjectWizard
      v-if="showWizard"
      :initial-config="initialWizardConfig"
      @close="closeWizard"
      @create="handleWizardCreate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Project, ProjectStatus, WorkspaceConfig } from '../types'
import NewProjectWizard from '../components/NewProjectWizard.vue'
import { useWorkspace } from '../composables/useWorkspace'
import {
  createProjectManifestDraft,
  parseProjectManifest,
  registerWorkspaceInManifest,
  serializeProjectManifest,
} from '@/utils/projectManagement'
import { readOptionalProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import { waitForDesktopApi } from '@/platform/desktop'

const router = useRouter()
const route = useRoute()
const {
  currentProject,
  recentProjects,
  openProject,
  newProject,
  loadRecentProjects,
  removeRecentProject,
  showToast,
} = useWorkspace()

const showWizard = ref(false)
const showAllProjects = ref(false)
type ProjectWorkspaceInitialConfig = Partial<WorkspaceConfig> & {
  managedWorkspaceRoot?: string
  deriveDirectoryFromDesign?: boolean
}

const initialWizardConfig = ref<ProjectWorkspaceInitialConfig | undefined>(undefined)

const displayedProjects = computed(() => {
  return showAllProjects.value ? recentProjects.value : recentProjects.value.slice(0, 3)
})

onMounted(async () => {
  await loadRecentProjects()
  prefillWorkspaceDirectory()
})

const goBack = () => {
  router.push('/')
}

const handleOpenProject = async () => {
  const success = await openProject()
  if (success) {
    await registerProjectManagedWorkspace({
      workspacePath: currentProject.value?.path,
    })
    router.push({
      path: '/workspace/home',
      query: workspaceRouteQuery(currentProject.value?.path),
    })
  }
}

const handleOpenRecent = async (project: Project) => {
  const success = await openProject(project)
  if (success) {
    await registerProjectManagedWorkspace({
      workspacePath: currentProject.value?.path ?? project.path,
    })
    router.push({
      path: '/workspace/home',
      query: workspaceRouteQuery(currentProject.value?.path ?? project.path),
    })
  }
}

const handleRemoveRecent = async (projectId: string) => {
  await removeRecentProject(projectId)
}

const openWizard = () => {
  initialWizardConfig.value = projectManagedWizardInitialConfig()
  showWizard.value = true
}

const closeWizard = () => {
  showWizard.value = false
  initialWizardConfig.value = undefined
}

const prefillWorkspaceDirectory = () => {
  const workspacePath = queryString(route.query.workspacePath)
  if (!workspacePath) return

  const projectName = queryString(route.query.projectName)
  const sourceWorkspace = queryString(route.query.sourceWorkspace)
  const sourceStep = queryString(route.query.sourceStep)
  const originDef = queryString(route.query.originDef)
  const originVerilog = queryString(route.query.originVerilog)
  const sourceOutputPath = queryString(route.query.sourceOutputPath)
  const sourceOutputType = queryString(route.query.sourceOutputType)
  const startStep = queryString(route.query.startStep)
  const endStep = queryString(route.query.endStep)
  const workspaceName = workspacePath.split('/').filter(Boolean).pop() || 'workspace'

  initialWizardConfig.value = {
    directory: workspacePath,
    origin_def: originDef,
    origin_verilog: originVerilog,
    parameters: {
      design: projectName ? `${projectName}_${workspaceName}` : workspaceName,
      description: sourceWorkspace && sourceStep
        ? `Created from ${sourceWorkspace} ${sourceStep} output`
        : 'Created from Project Management',
      source_output_path: sourceOutputPath,
      source_output_type: sourceOutputType,
      start_step: startStep,
      end_step: endStep,
    },
  }
  showWizard.value = true
}

function projectManagedWizardInitialConfig(): ProjectWorkspaceInitialConfig | undefined {
  const projectRoot = queryString(route.query.projectRoot)
  if (!projectRoot) return undefined

  return {
    managedWorkspaceRoot: normalizePath(projectRoot),
    deriveDirectoryFromDesign: true,
    parameters: {
      description: 'Created from Project Management',
    },
  }
}

const queryString = (value: unknown): string => {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

const handleWizardCreate = async (config: WorkspaceConfig) => {
  closeWizard()
  const success = await newProject(config)
  if (!success) return

  await registerProjectManagedWorkspace({
    workspacePath: config.directory,
    config,
  })
  router.push({
    path: '/workspace/home',
    query: workspaceRouteQuery(config.directory),
  })
}

async function registerProjectManagedWorkspace(input: {
  workspacePath?: string
  config?: WorkspaceConfig
}) {
  const projectRoot = queryString(route.query.projectRoot)
  if (!projectRoot || !input.workspacePath) return

  const registeredProjectRoot = await registerProjectRootForProjectManagement(projectRoot)
  if (!registeredProjectRoot) {
    showToast({
      severity: 'warn',
      summary: 'Project manifest not updated',
      detail: 'Workspace was created, but the project root could not be registered for manifest access.',
    })
    return
  }

  const projectName = queryString(route.query.projectName)
    || registeredProjectRoot.split('/').filter(Boolean).pop()
    || 'project'
  try {
    const manifestText = await readOptionalProjectTextFile('project.json', { projectPath: registeredProjectRoot })
    const manifest = manifestText
      ? parseProjectManifest(manifestText)
      : createProjectManifestDraft({ rootPath: registeredProjectRoot, name: projectName })
    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot: registeredProjectRoot,
      projectName,
      workspacePath: input.workspacePath,
      sourceWorkspaceId: queryString(route.query.sourceWorkspace) || undefined,
      sourceStep: queryString(route.query.sourceStep) || undefined,
      sourceOutputPath: queryString(route.query.sourceOutputPath) || undefined,
      sourceOutputType: queryString(route.query.sourceOutputType) || undefined,
      startStep: queryString(route.query.startStep) || undefined,
      endStep: queryString(route.query.endStep) || undefined,
      config: input.config,
    })

    await writeProjectTextFile('project.json', serializeProjectManifest(updated), { projectPath: registeredProjectRoot })
  } catch (error) {
    console.warn('Failed to update project manifest after workspace creation.', error)
    showToast({
      severity: 'warn',
      summary: 'Project manifest not updated',
      detail: 'Workspace was created, but project.json could not be updated.',
    })
  }
}

function workspaceRouteQuery(workspacePath?: string) {
  const projectRoot = queryString(route.query.projectRoot)
  if (!projectRoot) return {}

  return {
    projectRoot,
    projectName: queryString(route.query.projectName),
    workspaceId: queryString(route.query.workspaceId) || workspacePath?.split('/').filter(Boolean).pop() || '',
  }
}

async function registerProjectRootForProjectManagement(projectRoot: string): Promise<string | null> {
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const registeredRoot = await desktopApi.workspace.registerProjectRoot(projectRoot)
    return normalizePath(registeredRoot || projectRoot)
  } catch (error) {
    console.warn('Failed to register project root for Project Management.', error)
    return null
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}

const formatDate = (date: Date) => {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  return new Date(date).toLocaleDateString('en-US')
}

function statusBadgeClass(status: ProjectStatus): string {
  const map: Record<ProjectStatus, string> = {
    success: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    running: 'bg-blue-500/15 text-blue-400',
    in_progress: 'bg-amber-500/15 text-amber-400',
    not_started: 'bg-gray-500/15 text-gray-400',
  }
  return map[status] || 'bg-gray-500/15 text-gray-400'
}

function statusLabel(status: ProjectStatus): string {
  const map: Record<ProjectStatus, string> = {
    success: 'Success',
    failed: 'Failed',
    running: 'Running',
    in_progress: 'In Progress',
    not_started: 'Not Started',
  }
  return map[status] || 'Unknown'
}
</script>
