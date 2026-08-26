<template>
  <div
    class="relative flex min-h-full w-full flex-col items-center overflow-x-hidden overflow-y-auto py-8 text-(--text-primary)"
  >
    <!-- 返回按钮 -->
    <button
      @click="goBack"
      class="absolute top-6 left-6 z-20 flex cursor-pointer items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-3 py-2 text-sm text-(--text-secondary) transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color)"
    >
      <i class="ri-arrow-left-line"></i>
      <span>Back to ECOS</span>
    </button>

    <div class="relative z-10 my-auto flex w-full flex-col items-center">
      <!-- Logo 和标题 -->
      <div class="mb-12 flex items-center justify-center">
        <div class="relative">
          <div
            class="absolute -inset-4 rounded-full bg-(--accent-color)/10 blur-xl"
          ></div>
          <i class="ri-cpu-line relative text-6xl text-(--accent-color)"></i>
        </div>
        <div class="ml-5 flex flex-col">
          <h1 class="text-4xl font-bold tracking-tight text-(--text-primary)">ECC</h1>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="mb-16 flex gap-5">
        <button
          @click="handleOpenProject"
          class="group flex min-w-[180px] cursor-pointer flex-col items-center gap-3 rounded-xl border border-(--border-color) bg-(--bg-secondary) px-8 py-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:border-(--accent-color) hover:bg-(--bg-sidebar) hover:shadow-(--accent-color)/5 hover:shadow-lg"
        >
          <div
            class="flex h-14 w-14 items-center justify-center rounded-xl bg-(--bg-primary) transition-colors group-hover:bg-(--accent-color)/10"
          >
            <i
              class="ri-book-open-line text-2xl text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
            ></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">Open Workspace</span>
        </button>

        <button
          @click="openWizard"
          class="group flex min-w-[180px] cursor-pointer flex-col items-center gap-3 rounded-xl border border-(--border-color) bg-(--bg-secondary) px-8 py-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:border-(--accent-color) hover:bg-(--bg-sidebar) hover:shadow-(--accent-color)/5 hover:shadow-lg"
        >
          <div
            class="flex h-14 w-14 items-center justify-center rounded-xl bg-(--bg-primary) transition-colors group-hover:bg-(--accent-color)/10"
          >
            <i
              class="ri-folder-open-line text-2xl text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
            ></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">New Workspace</span>
        </button>
      </div>

      <!-- 最近项目 -->
      <div class="w-full max-w-3xl px-4">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-lg font-semibold text-(--text-primary)">
            <i class="ri-time-line text-(--text-secondary)"></i>
            Recent Workspaces
          </h2>
          <button
            v-if="recentProjects.length > 3"
            @click="showAllProjects = !showAllProjects"
            class="flex cursor-pointer items-center gap-1 text-sm text-(--accent-color) transition-opacity hover:opacity-80"
          >
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

        <div
          v-if="recentProjects.length === 0"
          class="rounded-xl border border-dashed border-(--border-color) bg-(--bg-secondary)/50 py-16 text-center text-(--text-secondary)"
        >
          <i class="ri-folder-2-line mb-4 block text-5xl opacity-30"></i>
          <p class="text-sm">No recent workspaces</p>
          <p class="mt-2 text-xs opacity-60">
            Click "New Workspace" to start your chip design journey
          </p>
        </div>

        <div
          v-else
          class="scrollbar-thin max-h-[min(42vh,420px)] space-y-2 overflow-y-auto overscroll-contain pr-1"
        >
          <div
            v-for="project in displayedProjects"
            :key="project.id"
            class="group flex w-full items-center justify-between rounded-xl border bg-(--bg-secondary) px-5 py-4 text-left transition-all duration-200"
            :class="
              project.workspaceRecognized === false
                ? 'cursor-default border-(--border-color) opacity-55'
                : 'cursor-pointer border-(--border-color) hover:border-(--accent-color) hover:bg-(--bg-sidebar) hover:shadow-md'
            "
            @click="project.workspaceRecognized !== false && handleOpenRecent(project)"
          >
            <div class="flex min-w-0 flex-1 items-center gap-4">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
                :class="
                  project.workspaceRecognized === false
                    ? 'bg-red-500/10'
                    : 'bg-(--accent-color)/10 group-hover:bg-(--accent-color)/20'
                "
              >
                <i
                  :class="
                    project.workspaceRecognized === false
                      ? 'ri-folder-warning-line text-lg text-red-400'
                      : 'ri-folder-line text-lg text-(--accent-color)'
                  "
                ></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <p
                    class="min-w-0 truncate font-medium"
                    :class="
                      project.workspaceRecognized === false
                        ? 'text-(--text-secondary)'
                        : 'text-(--text-primary)'
                    "
                  >
                    {{ project.name }}
                  </p>
                  <span
                    v-if="project.pdk"
                    class="shrink-0 rounded bg-(--accent-color)/10 px-1.5 py-0.5 text-[10px] font-medium text-(--accent-color)"
                  >
                    {{ project.pdk }}
                  </span>
                  <span
                    v-if="project.status"
                    :class="statusBadgeClass(project.status)"
                    class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  >
                    {{ statusLabel(project.status) }}
                  </span>
                </div>
                <p
                  v-if="project.completedSteps != null && project.totalSteps"
                  class="mt-0.5 text-[11px] text-(--text-secondary)"
                >
                  {{ project.completedSteps }}/{{ project.totalSteps }} steps
                </p>
                <div class="mt-0.5 flex items-center gap-2">
                  <p class="truncate text-xs text-(--text-secondary)">
                    {{ project.path }}
                  </p>
                  <span
                    v-if="project.workspaceRecognized === false"
                    class="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
                  >
                    Workspace not recognized
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs whitespace-nowrap text-(--text-secondary) transition-colors group-hover:text-(--text-primary)"
              >
                {{ formatDate(project.lastOpened) }}
              </span>
              <button
                @click.stop="handleRemoveRecent(project.id)"
                class="cursor-pointer rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10"
                title="Remove from list"
              >
                <i
                  class="ri-close-line text-sm text-(--text-secondary) hover:text-red-500"
                ></i>
              </button>
              <i
                v-if="project.workspaceRecognized !== false"
                class="ri-arrow-right-s-line text-(--text-secondary) opacity-0 transition-opacity group-hover:opacity-100"
              ></i>
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
import { requestOpenStepConfigAfterCreate } from '@/composables/openStepConfigAfterCreate'
import { waitForDesktopApi } from '@/platform/desktop'
import {
  readOptionalProjectTextFile,
  readWorkspaceParametersFile,
} from '@/utils/projectFiles'
import {
  projectContextFromWorkspaceConfig,
  registerProjectManagedWorkspace,
  resolveProjectRouteContextForWorkspace,
  type ProjectRouteContext,
} from '@/utils/projectManifestRegistration'

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
  await prefillWorkspaceDirectory()
})

const goBack = () => {
  router.push('/')
}

const handleOpenProject = async () => {
  const success = await openProject()
  if (!success || !currentProject.value?.path) return

  const projectContext = await resolveOpenProjectContext(currentProject.value.path)
  await registerProjectManagedWorkspace({
    workspacePath: currentProject.value.path,
    projectContext,
    routeQuery: route.query,
  })
  router.push({
    path: '/workspace/home',
    query: workspaceRouteQuery(currentProject.value.path, projectContext),
  })
}

const handleOpenRecent = async (project: Project) => {
  const success = await openProject(project)
  if (!success) return

  const workspacePath = currentProject.value?.path ?? project.path
  const projectContext = await resolveOpenProjectContext(workspacePath)
  await registerProjectManagedWorkspace({
    workspacePath,
    projectContext,
    routeQuery: route.query,
  })
  router.push({
    path: '/workspace/home',
    query: workspaceRouteQuery(workspacePath, projectContext),
  })
}

const handleRemoveRecent = async (projectId: string) => {
  await removeRecentProject(projectId)
}

const openWizard = () => {
  initialWizardConfig.value = projectManagedWizardInitialConfig()
  showWizard.value = true
}

const resetWizard = () => {
  showWizard.value = false
  initialWizardConfig.value = undefined
}

const closeWizard = () => {
  resetWizard()
  if (queryString(route.query.projectRoot)) {
    router.push('/projects')
  }
}

const prefillWorkspaceDirectory = async () => {
  const workspacePath = queryString(route.query.workspacePath)
  if (!workspacePath) return

  const projectRoot = queryString(route.query.projectRoot)
  const projectName = queryString(route.query.projectName)
  const designName = queryString(route.query.designName)
  const sourceWorkspace = queryString(route.query.sourceWorkspace)
  const sourceWorkspacePath = queryString(route.query.sourceWorkspacePath)
  const sourceStep = queryString(route.query.sourceStep)
  const originDef = queryString(route.query.originDef)
  const originVerilog = queryString(route.query.originVerilog)
  const sourceSdc = queryString(route.query.sdc)
  const sourceOutputPath = queryString(route.query.sourceOutputPath)
  const sourceOutputType = queryString(route.query.sourceOutputType)
  const startStep = queryString(route.query.startStep)
  const endStep = queryString(route.query.endStep)
  const workspaceName = workspacePath.split('/').filter(Boolean).pop() || 'workspace'
  let sourceWorkspaceConfig: ProjectWorkspaceInitialConfig | undefined

  await registerProjectRootForProjectManagement(projectRoot)
  try {
    sourceWorkspaceConfig = await loadSourceWorkspaceInitialConfig(sourceWorkspacePath)
  } catch (error) {
    console.warn('Failed to load source workspace defaults.', error)
  }

  initialWizardConfig.value = mergeBranchInitialConfig(
    {
      directory: workspacePath,
      origin_def: originDef,
      origin_verilog: originVerilog,
      pdk: sourceWorkspaceConfig?.pdk,
      pdk_root: sourceWorkspaceConfig?.pdk_root,
      sdc: sourceSdc || sourceWorkspaceConfig?.sdc,
      pdk_config_mode: sourceWorkspaceConfig?.pdk_config_mode,
      pdk_config: sourceWorkspaceConfig?.pdk_config,
      pdk_json: sourceWorkspaceConfig?.pdk_json,
      source_config: sourceWorkspaceConfig,
      source_context: {
        projectName,
        projectRoot,
        workspaceId: sourceWorkspace,
        workspaceName: sourceWorkspace,
        workspacePath: sourceWorkspacePath,
        step: sourceStep,
        outputPath: sourceOutputPath,
        outputType: sourceOutputType,
        startStep,
      },
      parameters: {
        ...sourceWorkspaceConfig?.parameters,
        design:
          designName || (projectName ? `${projectName}_${workspaceName}` : workspaceName),
        description:
          sourceWorkspace && sourceStep
            ? `Created from ${sourceWorkspace} ${sourceStep} output`
            : 'Created from Project Management',
        source_output_path: sourceOutputPath,
        source_output_type: sourceOutputType,
        start_step: startStep,
        end_step: endStep,
      },
    },
    sourceWorkspaceConfig,
  )
  showWizard.value = true
}

async function registerProjectRootForProjectManagement(
  projectRoot: string,
): Promise<void> {
  if (!projectRoot) return

  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    await desktopApi.workspace.registerProjectRoot(projectRoot)
  } catch (error) {
    console.warn('Failed to register project root for workspace defaults.', error)
  }
}

async function loadSourceWorkspaceInitialConfig(
  sourceWorkspacePath: string,
): Promise<ProjectWorkspaceInitialConfig | undefined> {
  if (!sourceWorkspacePath) return undefined

  try {
    const [parametersJson, pdkText, dbConfigText] = await Promise.all([
      readWorkspaceParametersFile(sourceWorkspacePath),
      readOptionalProjectTextFile('home/pdk.json', { projectPath: sourceWorkspacePath }),
      readOptionalProjectTextFile('config/db_ecc.json', {
        projectPath: sourceWorkspacePath,
      }),
    ])

    const pdkJson = parseOptionalJson(pdkText)
    const dbConfigJson = parseOptionalJson(dbConfigText)
    const dbInput = optionalRecord(dbConfigJson?.INPUT)
    const pdkConfig = normalizeSourcePdkConfig(pdkJson, dbConfigJson)

    return {
      pdk: optionalString(parametersJson?.PDK) || optionalString(parametersJson?.pdk),
      pdk_root:
        optionalString(parametersJson?.['PDK Root']) ||
        optionalString(parametersJson?.pdk_root),
      sdc:
        sourceWorkspaceSdcPath(sourceWorkspacePath, parametersJson) ||
        optionalString(pdkJson?.sdc) ||
        optionalString(dbInput?.sdc_path),
      pdk_config_mode: pdkConfig.mode,
      pdk_config: pdkConfig,
      pdk_json: pdkText ? `${normalizePath(sourceWorkspacePath)}/home/pdk.json` : '',
      parameters: normalizeSourceParameters(parametersJson),
    }
  } catch (error) {
    console.warn('Failed to load source workspace config for wizard prefill.', error)
    return undefined
  }
}

function mergeBranchInitialConfig(
  branchConfig: ProjectWorkspaceInitialConfig,
  sourceWorkspaceConfig?: ProjectWorkspaceInitialConfig,
): ProjectWorkspaceInitialConfig {
  if (!sourceWorkspaceConfig) return branchConfig

  return {
    ...sourceWorkspaceConfig,
    ...branchConfig,
    origin_def: branchConfig.origin_def || '',
    origin_verilog: branchConfig.origin_verilog || '',
    parameters: {
      ...sourceWorkspaceConfig.parameters,
      ...branchConfig.parameters,
    },
  }
}

function sourceWorkspaceSdcPath(
  sourceWorkspacePath: string,
  parametersJson: Record<string, unknown> | null,
): string {
  const designName =
    optionalString(parametersJson?.Design) || optionalString(parametersJson?.design)
  if (!designName) return ''
  return `${normalizePath(sourceWorkspacePath)}/origin/${designName}.sdc`
}

function parseOptionalJson(content: string | null): Record<string, unknown> | null {
  if (!content) return null
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeSourceParameters(
  parametersJson: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parametersJson) return {}
  const dieAreaRecord = optionalRecord(parametersJson['Die Area']) ?? {}
  const die =
    optionalRecord(parametersJson.Die) ?? optionalRecord(parametersJson.die) ?? {}
  const core =
    optionalRecord(parametersJson.Core) ?? optionalRecord(parametersJson.core) ?? {}
  const dieSize = numberList(die.Size ?? die.size)
  const coreMargin = numberList(core.Margin ?? core.margin)

  return {
    design:
      optionalString(parametersJson.Design) || optionalString(parametersJson.design),
    top_module:
      optionalString(parametersJson['Top module']) ||
      optionalString(parametersJson.top_module),
    clock: optionalString(parametersJson.Clock) || optionalString(parametersJson.clock),
    frequency_max: optionalNumber(
      parametersJson['Frequency max [MHz]'] ?? parametersJson.frequency_max,
      50,
    ),
    max_fanout: optionalNumber(
      parametersJson['Max fanout'] ?? parametersJson.max_fanout,
      32,
    ),
    die_area_mode:
      optionalString(dieAreaRecord.mode) || optionalString(parametersJson.die_area_mode),
    die_width: optionalNumber(
      dieAreaRecord.width ?? dieSize[0] ?? parametersJson.die_width,
      100,
    ),
    die_height: optionalNumber(
      dieAreaRecord.height ?? dieSize[1] ?? parametersJson.die_height,
      100,
    ),
    utilitization: optionalNumber(
      dieAreaRecord.utilitization ??
        core.Utilitization ??
        core.utilitization ??
        parametersJson.utilitization,
      0.6,
    ),
    margin: optionalNumber(
      dieAreaRecord.margin ?? coreMargin[0] ?? parametersJson.margin,
      0,
    ),
  }
}

function normalizeSourcePdkConfig(
  pdkJson: Record<string, unknown> | null,
  dbConfigJson: Record<string, unknown> | null,
) {
  const dbInput = optionalRecord(dbConfigJson?.INPUT)
  const techLef = stringList(
    pdkJson?.tech_lef ??
      pdkJson?.tech ??
      pdkJson?.selected_tech_lef ??
      dbInput?.tech_lef_path,
  )
  const cellLef = stringList(
    pdkJson?.cell_lef ?? pdkJson?.lefs ?? pdkJson?.cell_lef_list ?? dbInput?.lef_paths,
  )
  const liberty = stringList(
    pdkJson?.liberty ?? pdkJson?.libs ?? pdkJson?.liberty_list ?? dbInput?.lib_path,
  )
  const hasManualResources =
    techLef.length > 0 || cellLef.length > 0 || liberty.length > 0

  return {
    mode: hasManualResources ? ('manual' as const) : ('default' as const),
    tech_lef: techLef,
    cell_lef: cellLef,
    liberty,
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    )
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function optionalString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function optionalNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter(Number.isFinite)
}

function projectManagedWizardInitialConfig(): ProjectWorkspaceInitialConfig | undefined {
  const projectRoot = queryString(route.query.projectRoot)
  if (!projectRoot) return undefined

  return {
    managedWorkspaceRoot: normalizePath(projectRoot),
    deriveDirectoryFromDesign: true,
    parameters: {
      description: 'Created from Project Management',
      design: queryString(route.query.designName),
    },
  }
}

const queryString = (value: unknown): string => {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

const handleWizardCreate = async (config: WorkspaceConfig) => {
  resetWizard()
  const success = await newProject(config)
  if (!success) return

  const workspacePath = currentProject.value?.path ?? config.directory
  const projectContext = projectContextFromWorkspaceConfig(config)
  await registerProjectManagedWorkspace({
    workspacePath,
    config,
    projectContext,
    routeQuery: route.query,
    onWarning: (summary, detail) => {
      showToast({
        severity: 'warn',
        summary,
        detail,
      })
    },
  })
  requestOpenStepConfigAfterCreate()
  router.push({
    path: '/workspace/home',
    query: workspaceRouteQuery(workspacePath, projectContext),
  })
}

async function resolveOpenProjectContext(
  workspacePath: string,
): Promise<ProjectRouteContext | null> {
  const resolved = await resolveProjectRouteContextForWorkspace(workspacePath)
  if (resolved) return resolved

  const projectRoot = queryString(route.query.projectRoot)
  if (!projectRoot) return null

  return {
    projectRoot,
    projectName: queryString(route.query.projectName) || undefined,
  }
}

function workspaceRouteQuery(
  workspacePath?: string,
  projectContext?: ProjectRouteContext | null,
) {
  const projectRoot = projectContext?.projectRoot || queryString(route.query.projectRoot)
  if (!projectRoot) return {}

  return {
    projectRoot,
    projectName: projectContext?.projectName || queryString(route.query.projectName),
    workspaceId:
      queryString(route.query.workspaceId) ||
      workspacePath?.split('/').filter(Boolean).pop() ||
      '',
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
