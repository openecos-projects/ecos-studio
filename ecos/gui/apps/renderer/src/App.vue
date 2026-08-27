<template>
  <div class="app-wrapper">
    <!-- 主应用容器 -->
    <div class="app-container">
      <!-- 全局顶部菜单栏 -->
      <TopBar
        :project-name="isWelcome ? null : currentProject?.name"
        :has-workspace="Boolean(currentProject?.path)"
        @menu-action="handleMenuAction"
        @step-config="showStepConfigDialog = true"
      />
      <!-- 页面内容 -->
      <div
        class="app-main"
        :style="
          terminalExpanded
            ? { '--terminal-panel-height': terminalPanelHeight }
            : undefined
        "
      >
        <div
          class="app-content"
          :class="{ 'app-content--terminal-safe-area': terminalExpanded }"
        >
          <router-view />
        </div>
        <HomeAgentDrawer v-if="!isWorkspaceRoute" />
        <ECOSTerminal
          :expanded="terminalExpanded"
          :maximized="terminalPanelMaximized"
          :project-path="currentProject?.path ?? null"
          :theme-name="themeStore.themeName"
          @collapse="terminalExpanded = false"
          @height-change="handleTerminalHeightChange"
          @toggle-maximize="toggleTerminalMaximized"
        />
      </div>
      <StatusBar
        :terminal-expanded="terminalExpanded"
        @toggle-terminal="terminalExpanded = !terminalExpanded"
      />
    </div>

    <!-- 全局 Toast 通知 -->
    <Toast position="top-right" class="app-toast" />

    <!-- 全局新建工程向导 -->
    <NewProjectWizard
      v-if="showNewProjectWizard"
      :title="workspaceWizardTitle"
      :initial-config="workspaceWizardInitialConfig"
      @close="handleWizardClose"
      @create="handleWizardCreate"
    />

    <Teleport to="body">
      <div
        v-if="showWorkspaceUpdateBackupDialog"
        class="workspace-update-backup-overlay"
        role="presentation"
        @click.self="cancelWorkspaceUpdateBackup"
      >
        <section
          class="workspace-update-backup-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-update-backup-title"
        >
          <p class="workspace-update-backup-eyebrow">Update Workspace</p>
          <h2 id="workspace-update-backup-title">Backup Original Workspace?</h2>
          <p>Keep a copy of the current workspace before replacing it.</p>
          <div class="workspace-update-backup-actions">
            <button
              type="button"
              class="workspace-update-backup-secondary"
              @click="cancelWorkspaceUpdateBackup"
            >
              Cancel
            </button>
            <button
              type="button"
              class="workspace-update-backup-secondary"
              @click="runWorkspaceUpdate(false)"
            >
              Do Not Backup
            </button>
            <button
              type="button"
              class="workspace-update-backup-primary"
              @click="confirmWorkspaceUpdateBackup"
            >
              Backup Original
            </button>
          </div>
        </section>
      </div>
    </Teleport>

    <AboutDialog v-model="showAboutDialog" />

    <SignoffPackageReviewDialog
      :error="signoffPackageReview.error"
      :loading="signoffPackageReview.loading"
      :result="signoffPackageReview.result"
      :visible="signoffPackageReview.visible"
      @close="closeSignoffPackageReview"
      @export="confirmSignoffPackageExport"
      @refresh="refreshSignoffPackageReview"
    />

    <DesignReportExportDialog
      :content="generatedDesignReportContent"
      :error="designReportError"
      :loading="designReportLoading"
      :options="designReportExportOptions"
      :report-data="designReportData"
      :selected-format="selectedDesignReportFormat"
      :visible="showDesignReportDialog"
      @close="closeDesignReportExport"
      @copy="copyDesignReport"
      @refresh="refreshDesignReportData"
      @save-all="exportAllDesignReportFormats"
      @save-current="saveDesignReport"
      @update:options="Object.assign(designReportExportOptions, $event)"
      @update:selected-format="selectedDesignReportFormat = $event"
    />

    <DesignFilesManageDialog v-model="showManageDialog" />

    <Dialog
      :visible="pdkNameDialogVisible"
      modal
      header="Import PDK"
      :style="{ width: 'min(420px, calc(100vw - 32px))' }"
      :draggable="false"
      @update:visible="updatePdkNameDialogVisibility"
    >
      <label
        for="pdk-name"
        class="mb-2 block text-sm font-semibold text-(--text-primary)"
      >
        PDK Name
      </label>
      <InputText
        id="pdk-name"
        v-model="pdkNameDraft"
        autofocus
        autocomplete="off"
        spellcheck="false"
        class="w-full"
        @keydown.enter.prevent="confirmPdkName"
      />
      <div class="mt-6 flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-(--border-color) px-3 py-1.5 text-sm text-(--text-secondary) hover:bg-(--bg-secondary) hover:text-(--text-primary)"
          @click="cancelPdkName"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded bg-(--accent-color) px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!pdkNameDraft.trim()"
          @click="confirmPdkName"
        >
          Import
        </button>
      </div>
    </Dialog>

    <Dialog
      :visible="showStepConfigDialog"
      modal
      maximizable
      header="Step Configuration"
      :style="{ width: 'min(1440px, calc(100vw - 32px))' }"
      :draggable="false"
      @update:visible="updateStepConfigDialogVisibility"
    >
      <div class="step-config-dialog">
        <WorkspaceStepConfigDialog
          v-if="showStepConfigDialog"
          ref="stepConfigDialogRef"
        />
      </div>
    </Dialog>

    <!-- Full-screen loading while the workspace is being prepared (open/new project, session restore) -->
    <Teleport to="body">
      <Transition name="runtime-backend-overlay">
        <div
          v-if="runtimeBackendConnecting"
          class="runtime-backend-overlay"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <div class="runtime-backend-panel">
            <div class="runtime-backend-spinner" aria-hidden="true" />
            <p class="runtime-backend-title">{{ runtimeBackendTitle }}</p>
            <p class="runtime-backend-sub">{{ runtimeBackendSubtitle }}</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, provide, watch } from 'vue'
import {
  appMenuActionIds,
  type AppMenuAction,
  type DesktopAgentWorkspaceSetupContract,
  type DesktopApi,
} from '@ecos-studio/shared'
import { useRouter, useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/themeStore'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useAppMenuActions } from '@/composables/useAppMenuActions'
import { useAppWindowClose } from '@/composables/useAppWindowClose'
import { useSignoffPackageExport } from '@/composables/useSignoffPackageExport'
import { useDesignReportExport } from '@/composables/useDesignReportExport'
import { useWorkspace } from '@/composables/useWorkspace'
import { usePdkManager } from '@/composables/usePdkManager'
import { useVersion } from '@/composables/useVersion'
import { losslessNumber, losslessOptionalString } from '@/utils/numbers'
import {
  getOptionalDesktopApi,
  hasDesktopApi,
  waitForDesktopApi,
} from '@/platform/desktop'

import TopBar from '@/components/TopBar.vue'
import HomeAgentDrawer from '@/components/HomeAgentDrawer.vue'
import StatusBar from '@/components/StatusBar.vue'
import ECOSTerminal from '@/components/ECOSTerminal.vue'
import AboutDialog from '@/components/AboutDialog.vue'
import SignoffPackageReviewDialog from '@/components/SignoffPackageReviewDialog.vue'
import DesignReportExportDialog from '@/components/DesignReportExportDialog.vue'
import Toast from 'primevue/toast'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import NewProjectWizard from '@/components/NewProjectWizard.vue'
import DesignFilesManageDialog from '@/components/DesignFilesManageDialog.vue'
import WorkspaceStepConfigDialog from '@/components/WorkspaceStepConfigDialog.vue'
import type { WorkspaceConfig } from '@/types'
import { setWindowResizing } from '@/composables/useWindowResizeState'
import { useDesignFiles } from '@/composables/useDesignFiles'
import { agentWorkspaceSetupKey } from '@/composables/agentWorkspaceSetup'
import {
  requestOpenStepConfigAfterCreate,
  usePendingOpenStepConfigAfterCreate,
} from '@/composables/openStepConfigAfterCreate'
import {
  readOptionalProjectTextFile,
  readWorkspaceParametersFile,
} from '@/utils/projectFiles'
import { consumeOpenWorkspaceLaunchQuery } from '@/utils/openWorkspaceLaunchQuery'
import {
  projectContextFromWorkspaceConfig,
  registerProjectManagedWorkspace,
  resolveProjectRouteContextForWorkspace,
  type ProjectRouteContext,
} from '@/utils/projectManifestRegistration'

type WorkspaceWizardInitialConfig = Partial<WorkspaceConfig> & {
  managedWorkspaceRoot?: string
  deriveDirectoryFromDesign?: boolean
  lockWorkspaceDirectory?: boolean
  standaloneWorkspace?: boolean
  suggestedWorkspaceName?: string
}

const router = useRouter()
const themeStore = useThemeStore()
const route = useRoute()
const isWelcome = computed(() => route.path === '/')
const isWorkspaceRoute = computed(() => route.path.startsWith('/workspace'))
const zoomFactors = [0.8, 0.9, 1, 1.1, 1.25, 1.4] as const
const zoomFactor = ref<(typeof zoomFactors)[number]>(1)
const zoomSettingKey = 'ui.zoomFactor'
const {
  loadRecentProjects,
  currentProject,
  workspaceSession,
  openProject,
  newProject,
  lastWorkspaceCreationError,
  closeProject,
  runtimeBackendConnecting,
  runtimeBackendTitle,
  runtimeBackendSubtitle,
} = useWorkspace()
const { loadPdks, pdkNameDialogVisible, pdkNameDraft, confirmPdkName, cancelPdkName } =
  usePdkManager()
const { loadVersions } = useVersion()
const { showToast } = useWorkspace()
const { showManageDialog, openManageDialog } = useDesignFiles()
const {
  closeSignoffPackageReview,
  confirmSignoffPackageExport,
  exportSignoffPackage,
  refreshSignoffPackageReview,
  signoffPackageReview,
} = useSignoffPackageExport({
  currentProject,
  showToast,
  workspaceSession,
})
const {
  closeDesignReportExport,
  copyToClipboard: copyDesignReport,
  dialogVisible: showDesignReportDialog,
  error: designReportError,
  exportAllFormats: exportAllDesignReportFormats,
  exportOptions: designReportExportOptions,
  generatedContent: generatedDesignReportContent,
  loadWorkspaceReportData: refreshDesignReportData,
  loading: designReportLoading,
  openDesignReportExport,
  reportData: designReportData,
  saveCurrentReport: saveDesignReport,
  selectedFormat: selectedDesignReportFormat,
} = useDesignReportExport({
  currentProject,
  showToast,
})
const desktopApi = ref<DesktopApi | null>(getOptionalDesktopApi())

function updatePdkNameDialogVisibility(visible: boolean): void {
  if (!visible) cancelPdkName()
}

watch(
  () => [Boolean(currentProject.value?.path), isWorkspaceRoute.value] as const,
  ([hasWorkspace, workspaceRoute]) => {
    void (async () => {
      try {
        const api = desktopApi.value ?? (await waitForDesktopApi({ timeoutMs: 5000 }))
        desktopApi.value = api
        await Promise.all([
          api.menu.setActionEnabled(appMenuActionIds.reconfigureWorkspace, hasWorkspace),
          api.menu.setActionEnabled(appMenuActionIds.manageDesignFiles, hasWorkspace),
          api.menu.setActionEnabled(appMenuActionIds.exportDesignMetrics, hasWorkspace),
          api.menu.setActionEnabled(
            appMenuActionIds.exportSignoffPackage,
            workspaceRoute,
          ),
          api.menu.setActionEnabled(appMenuActionIds.exportDesignSummary, workspaceRoute),
        ])
      } catch (error) {
        console.warn('[App] Failed to sync workspace menu availability:', error)
      }
    })()
  },
  { immediate: true },
)

const documentationUrl =
  'https://github.com/openecos-projects/ecos-studio/blob/main/ecos/docs/user-guide.md'
// ---- 新建工程向导 ----
const showNewProjectWizard = ref(false)
const showStepConfigDialog = ref(false)
const pendingOpenStepConfigAfterCreate = usePendingOpenStepConfigAfterCreate()
watch(
  () =>
    isWorkspaceRoute.value &&
    pendingOpenStepConfigAfterCreate.value &&
    Boolean(currentProject.value?.path) &&
    !runtimeBackendConnecting.value,
  (shouldOpenStepConfig) => {
    if (!shouldOpenStepConfig) return
    pendingOpenStepConfigAfterCreate.value = false
    showStepConfigDialog.value = true
  },
  { flush: 'post' },
)

const stepConfigDialogRef = ref<{ hasUnsavedChanges: boolean } | null>(null)
const workspaceWizardInitialConfig = ref<WorkspaceWizardInitialConfig | undefined>()
const reconfigureWorkspacePath = ref('')
const pendingWorkspaceUpdateConfig = ref<WorkspaceConfig | null>(null)

function closeStepConfigDialog(): void {
  if (
    stepConfigDialogRef.value?.hasUnsavedChanges &&
    !confirm('Discard unsaved configuration changes?')
  ) {
    return
  }
  showStepConfigDialog.value = false
}

function updateStepConfigDialogVisibility(visible: boolean): void {
  if (visible) {
    showStepConfigDialog.value = true
    return
  }
  closeStepConfigDialog()
}
const pendingWorkspaceUpdatePath = ref('')
const showWorkspaceUpdateBackupDialog = ref(false)
const workspaceWizardTitle = computed(() => {
  return reconfigureWorkspacePath.value ? 'Update Workspace' : 'New Workspace'
})

async function createWorkspaceFromAgent(
  config: WorkspaceConfig,
  contract: DesktopAgentWorkspaceSetupContract,
  ownerSessionId: string,
): Promise<import('@/composables/agentWorkspaceSetup').AgentWorkspaceCreationResult> {
  const agentShell = useAgentShellStore()
  agentShell.beginPreserveForAgentWorkspaceSwitch()
  const success = await newProject(config)
  if (!success) {
    agentShell.consumePreserveMessages()
    agentShell.consumePreserveSession()
    return { created: false, error: lastWorkspaceCreationError.value }
  }
  const workspacePath = currentProject.value?.path
  if (!workspacePath) throw new Error('Workspace creation did not return a project path.')
  const api = desktopApi.value ?? (await waitForDesktopApi())
  desktopApi.value = api
  await api.workspace.writeProjectTextFile(
    `${normalizeLocalPath(workspacePath)}/home/workspace_setup_contract.v2.json`,
    `${JSON.stringify(contract, null, 2)}\n`,
  )
  await syncProjectManagedWorkspace(config)
  agentShell.closeHomeAgent()
  agentShell.setPendingPostCreateFlow({
    setupId: contract.setup_id,
    ownerSessionId,
    workspacePath,
  })
  agentShell.setMode('workspace')
  await router.push({
    path: '/workspace/home',
    query: {
      projectRoot: contract.project_context.project_root,
      projectName: contract.project_context.project_name,
    },
  })
  await nextTick()
  return { created: true, workspacePath }
}

provide(agentWorkspaceSetupKey, createWorkspaceFromAgent)
const showAboutDialog = ref(false)
const terminalExpanded = ref(false)
const terminalPanelHeight = ref('min(300px, 42vh)')
const terminalPanelRestoredHeight = ref('min(300px, 42vh)')
const terminalPanelMaximized = ref(false)

function handleTerminalHeightChange(height: string) {
  terminalPanelHeight.value = height
  terminalPanelRestoredHeight.value = height
  terminalPanelMaximized.value = false
}

function toggleTerminalMaximized() {
  terminalPanelMaximized.value = !terminalPanelMaximized.value
  terminalPanelHeight.value = terminalPanelMaximized.value
    ? '100%'
    : terminalPanelRestoredHeight.value
}

function resetWorkspaceWizard() {
  showNewProjectWizard.value = false
  workspaceWizardInitialConfig.value = undefined
  reconfigureWorkspacePath.value = ''
  pendingWorkspaceUpdateConfig.value = null
  pendingWorkspaceUpdatePath.value = ''
  showWorkspaceUpdateBackupDialog.value = false
}

function handleWizardClose() {
  resetWorkspaceWizard()
}

function showCreateWorkspaceWizard() {
  workspaceWizardInitialConfig.value = undefined
  reconfigureWorkspacePath.value = ''
  showNewProjectWizard.value = true
}

const handleWizardCreate = async (config: WorkspaceConfig) => {
  const targetReconfigurePath = reconfigureWorkspacePath.value

  if (targetReconfigurePath) {
    pendingWorkspaceUpdateConfig.value = config
    pendingWorkspaceUpdatePath.value = targetReconfigurePath
    showWorkspaceUpdateBackupDialog.value = true
    return
  }

  resetWorkspaceWizard()
  const success = await newProject(config)
  if (!success) return

  await syncProjectManagedWorkspace(config)
  requestOpenStepConfigAfterCreate()
  router.push('/workspace')
}

function cancelWorkspaceUpdateBackup() {
  showWorkspaceUpdateBackupDialog.value = false
  pendingWorkspaceUpdateConfig.value = null
  pendingWorkspaceUpdatePath.value = ''
}

function confirmWorkspaceUpdateBackup() {
  void runWorkspaceUpdate(true)
}

async function runWorkspaceUpdate(keepReplacementBackup: boolean) {
  const config = pendingWorkspaceUpdateConfig.value
  const targetReconfigurePath =
    pendingWorkspaceUpdatePath.value || reconfigureWorkspacePath.value
  if (!config || !targetReconfigurePath) {
    cancelWorkspaceUpdateBackup()
    return
  }

  resetWorkspaceWizard()
  const success = await newProject({
    ...config,
    directory: normalizeLocalPath(targetReconfigurePath),
    replaceExistingWorkspace: true,
    keepReplacementBackup,
  })
  if (success) {
    await syncProjectManagedWorkspace(config, normalizeLocalPath(targetReconfigurePath))
    router.push({
      path: route.path.startsWith('/workspace') ? route.path : '/workspace',
      query: route.query,
    })
  }
}

async function syncProjectManagedWorkspace(
  config: WorkspaceConfig,
  workspacePath?: string,
) {
  const projectContext = projectContextFromWorkspaceConfig(config)
  if (!projectContext) return

  await registerProjectManagedWorkspace({
    workspacePath: workspacePath ?? currentProject.value?.path ?? config.directory,
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
}

async function openWorkspaceReconfigureWizard() {
  const workspacePath = currentProject.value?.path
  if (!workspacePath) {
    showToast({
      severity: 'warn',
      summary: 'Workspace Required',
      detail: 'Open a workspace before updating it.',
      life: 3000,
    })
    return
  }

  try {
    const normalizedWorkspacePath = normalizeLocalPath(workspacePath)
    const api = desktopApi.value ?? (await waitForDesktopApi())
    desktopApi.value = api
    await api.workspace.registerProjectRoot(normalizedWorkspacePath)
    const projectContext = await resolveProjectRouteContextForWorkspace(
      normalizedWorkspacePath,
    )
    if (projectContext) {
      await api.workspace.registerProjectReadRoot(projectContext.projectRoot)
    }

    workspaceWizardInitialConfig.value = await buildReconfigureWizardInitialConfig(
      normalizedWorkspacePath,
      projectContext,
    )
    reconfigureWorkspacePath.value = normalizedWorkspacePath
    showNewProjectWizard.value = true
  } catch (error) {
    console.error('Failed to prepare workspace reconfiguration:', error)
    showToast({
      severity: 'error',
      summary: 'Failed to Update Workspace',
      detail: error instanceof Error ? error.message : String(error),
      life: 5000,
    })
  }
}

async function buildReconfigureWizardInitialConfig(
  workspacePath: string,
  projectContext?: ProjectRouteContext | null,
): Promise<WorkspaceWizardInitialConfig> {
  const resolvedProjectContext =
    projectContext === undefined
      ? await resolveProjectRouteContextForWorkspace(workspacePath)
      : projectContext
  const [parametersJson, pdkText, dbConfigText, flowText] = await Promise.all([
    readWorkspaceParametersFile(workspacePath),
    readOptionalProjectTextFile('home/pdk.json', { projectPath: workspacePath }),
    readOptionalProjectTextFile('config/db_ecc.json', {
      projectPath: workspacePath,
    }),
    readOptionalProjectTextFile('home/flow.json', { projectPath: workspacePath }),
  ])

  const pdkJson = parseOptionalJson(pdkText)
  const dbConfigJson = parseOptionalJson(dbConfigText)
  const flowConfig = normalizeWorkspaceFlowConfig(flowText)
  const normalizedParameters = normalizeWorkspaceParameters(parametersJson, workspacePath)
  const dbInput = optionalRecord(dbConfigJson?.INPUT)
  const pdkConfig = normalizePdkConfig(pdkJson, dbConfigJson)
  const designName =
    optionalString(parametersJson?.Design) ||
    optionalString(parametersJson?.design) ||
    getPathLeafName(workspacePath)
  const originInputs = await scanWorkspaceOriginDesignInputs(workspacePath)
  const rtlList =
    flowConfig.start_step === 'Synthesis'
      ? await existingWorkspaceFiles(workspacePath, [
          ...originInputs.rtlFiles,
          `origin/${designName}.v`,
          `origin/${designName}.v.gz`,
          `origin/${designName}.sv`,
          `origin/${designName}.sv.gz`,
          `origin/${designName}.vhd`,
          `origin/${designName}.vhdl`,
          ...stringList(dbInput?.rtl_paths),
          ...stringList(dbInput?.rtl_list),
        ])
      : []
  const filelist =
    flowConfig.start_step === 'Synthesis'
      ? await firstExistingWorkspaceFile(workspacePath, [
          ...originInputs.filelists,
          'origin/filelist',
          optionalString(dbInput?.filelist),
          optionalString(dbInput?.filelist_path),
        ])
      : ''
  const originDef =
    flowConfig.start_step === 'Synthesis'
      ? ''
      : await firstExistingWorkspaceFile(workspacePath, [
          ...originInputs.defFiles,
          `origin/${designName}.def`,
          `origin/${designName}.def.gz`,
          optionalString(dbInput?.origin_def),
          optionalString(dbInput?.def_path),
        ])
  const originVerilog =
    flowConfig.start_step === 'Synthesis'
      ? ''
      : await firstExistingWorkspaceFile(workspacePath, [
          ...originInputs.verilogFiles,
          `origin/${designName}.v`,
          `origin/${designName}.v.gz`,
          `origin/${designName}.sv`,
          `origin/${designName}.sv.gz`,
          `origin/${designName}.vg`,
          `origin/${designName}.vg.gz`,
          optionalString(dbInput?.origin_verilog),
          optionalString(dbInput?.verilog_path),
        ])
  const sdc =
    (await firstExistingWorkspaceFile(workspacePath, [
      ...originInputs.sdcFiles,
      `origin/${designName}.sdc`,
      `origin/${designName}.sdc.gz`,
      optionalString(dbInput?.sdc_path),
      optionalString(pdkJson?.sdc),
    ])) || ''

  return {
    directory: workspacePath,
    lockWorkspaceDirectory: true,
    standaloneWorkspace: !resolvedProjectContext,
    pdk:
      optionalString(parametersJson?.PDK) ||
      optionalString(parametersJson?.pdk) ||
      'ics55',
    pdk_root:
      optionalString(parametersJson?.['PDK Root']) ||
      optionalString(parametersJson?.pdk_root),
    parameters: normalizedParameters,
    origin_def: originDef,
    origin_verilog: originVerilog,
    rtl_list: rtlList,
    filelist,
    design_input_mode: flowConfig.start_step === 'Synthesis' ? 'rtl' : 'post_synthesis',
    sdc,
    pdk_config_mode: pdkConfig.mode,
    pdk_config: pdkConfig,
    pdk_json: pdkText ? `${workspacePath}/home/pdk.json` : '',
    flow_config: flowConfig,
    project_context: resolvedProjectContext
      ? {
          mode: 'select',
          project_name:
            resolvedProjectContext.projectName ||
            getPathLeafName(resolvedProjectContext.projectRoot),
          project_root: resolvedProjectContext.projectRoot,
          project_json_path: `${resolvedProjectContext.projectRoot}/project.json`,
        }
      : undefined,
  }
}

function parseOptionalJson(content: string | null): Record<string, unknown> | null {
  if (!content) return null
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeWorkspaceParameters(
  parametersJson: Record<string, unknown> | null,
  workspacePath: string,
): WorkspaceConfig['parameters'] {
  const dieArea = optionalRecord(parametersJson?.['Die Area']) ?? {}
  const die =
    optionalRecord(parametersJson?.Die) ?? optionalRecord(parametersJson?.die) ?? {}
  const core =
    optionalRecord(parametersJson?.Core) ?? optionalRecord(parametersJson?.core) ?? {}
  const dieSize = numberList(die.Size ?? die.size)
  const coreMargin = numberList(core.Margin ?? core.margin)
  const hasDieSize = dieSize.length >= 2

  return {
    design:
      optionalString(parametersJson?.Design) ||
      optionalString(parametersJson?.design) ||
      getPathLeafName(workspacePath),
    description: optionalString(parametersJson?.description),
    top_module:
      optionalString(parametersJson?.['Top module']) ||
      optionalString(parametersJson?.top_module),
    clock: optionalString(parametersJson?.Clock) || optionalString(parametersJson?.clock),
    frequency_max: optionalNumber(
      parametersJson?.['Frequency max [MHz]'] ?? parametersJson?.frequency_max,
      50,
    ),
    max_fanout: optionalNumber(
      parametersJson?.['Max fanout'] ?? parametersJson?.max_fanout,
      32,
    ),
    die_area_mode: normalizeDieAreaMode(
      dieArea.mode ?? parametersJson?.die_area_mode,
      hasDieSize ? 'width_height' : 'utilitization_margin',
    ),
    die_width: optionalNumber(
      dieArea.width ?? dieSize[0] ?? parametersJson?.die_width,
      100,
    ),
    die_height: optionalNumber(
      dieArea.height ?? dieSize[1] ?? parametersJson?.die_height,
      100,
    ),
    utilitization: optionalNumber(
      dieArea.utilitization ??
        core.Utilitization ??
        core.utilitization ??
        parametersJson?.utilitization,
      0.6,
    ),
    margin: optionalNumber(dieArea.margin ?? coreMargin[0] ?? parametersJson?.margin, 0),
  }
}

function normalizeWorkspaceFlowConfig(
  flowText: string | null,
): NonNullable<WorkspaceConfig['flow_config']> {
  const flowJson = parseOptionalJson(flowText)
  const steps = Array.isArray(flowJson?.steps)
    ? flowJson.steps
        .map((step) => {
          if (typeof step === 'string') return step
          if (optionalRecord(step)) return optionalString(optionalRecord(step)?.name)
          return ''
        })
        .filter((step): step is string => step.trim() !== '')
    : []
  const normalizedSteps = steps.length > 0 ? steps : ['Synthesis', 'Harden']

  return {
    start_step: normalizedSteps[0],
    end_step: normalizedSteps[normalizedSteps.length - 1],
    steps: normalizedSteps,
  }
}

function normalizePdkConfig(
  pdkJson: Record<string, unknown> | null,
  dbConfigJson: Record<string, unknown> | null,
): NonNullable<WorkspaceConfig['pdk_config']> & { mode: 'default' | 'manual' } {
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
    mode: hasManualResources ? 'manual' : 'default',
    tech_lef: techLef,
    cell_lef: cellLef,
    liberty,
  }
}

async function firstExistingWorkspaceFile(
  workspacePath: string,
  candidates: string[],
): Promise<string> {
  const files = await existingWorkspaceFiles(workspacePath, candidates)
  return files[0] ?? ''
}

interface WorkspaceOriginDesignInputs {
  rtlFiles: string[]
  filelists: string[]
  defFiles: string[]
  verilogFiles: string[]
  sdcFiles: string[]
}

function emptyWorkspaceOriginDesignInputs(): WorkspaceOriginDesignInputs {
  return {
    rtlFiles: [],
    filelists: [],
    defFiles: [],
    verilogFiles: [],
    sdcFiles: [],
  }
}

async function scanWorkspaceOriginDesignInputs(
  workspacePath: string,
): Promise<WorkspaceOriginDesignInputs> {
  const inputs = emptyWorkspaceOriginDesignInputs()
  try {
    const api = desktopApi.value ?? (await waitForDesktopApi())
    desktopApi.value = api
    const entries = await api.workspace.listProjectDirectory(`${workspacePath}/origin`)
    for (const entry of entries) {
      if (entry.type !== 'file') continue
      const filePath = normalizeLocalPath(entry.path)
      if (hasAnySuffix(filePath, ['.def', '.def.gz'])) {
        inputs.defFiles.push(filePath)
      }
      if (hasAnySuffix(filePath, ['.v', '.v.gz', '.sv', '.sv.gz', '.vg', '.vg.gz'])) {
        inputs.rtlFiles.push(filePath)
        inputs.verilogFiles.push(filePath)
      }
      if (hasAnySuffix(filePath, ['.vhd', '.vhd.gz', '.vhdl', '.vhdl.gz'])) {
        inputs.rtlFiles.push(filePath)
      }
      if (hasAnySuffix(filePath, ['.sdc', '.sdc.gz'])) {
        inputs.sdcFiles.push(filePath)
      }
      const fileName = getPathLeafName(filePath).toLowerCase()
      if (
        fileName === 'filelist' ||
        hasAnySuffix(filePath, [
          '.f',
          '.f.gz',
          '.fl',
          '.fl.gz',
          '.flist',
          '.flist.gz',
          '.filelist',
          '.filelist.gz',
          '.lst',
          '.lst.gz',
          '.txt',
          '.txt.gz',
        ])
      ) {
        inputs.filelists.push(filePath)
      }
    }
    return {
      rtlFiles: uniquePathList(inputs.rtlFiles),
      filelists: uniquePathList(inputs.filelists),
      defFiles: uniquePathList(inputs.defFiles),
      verilogFiles: uniquePathList(inputs.verilogFiles),
      sdcFiles: uniquePathList(inputs.sdcFiles),
    }
  } catch {
    return inputs
  }
}

function hasAnySuffix(filePath: string, suffixes: string[]): boolean {
  const lowerPath = filePath.toLowerCase()
  return suffixes.some((suffix) => lowerPath.endsWith(suffix))
}

function uniquePathList(paths: string[]): string[] {
  return [...new Set(paths)]
}

async function existingWorkspaceFiles(
  workspacePath: string,
  candidates: string[],
): Promise<string[]> {
  const existing: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const relativeOrAbsolute = candidate.trim()
    if (!relativeOrAbsolute) continue
    const path = isAbsoluteLocalPath(relativeOrAbsolute)
      ? normalizeLocalPath(relativeOrAbsolute)
      : `${workspacePath}/${relativeOrAbsolute.replace(/^\/+/, '')}`
    if (seen.has(path)) continue
    seen.add(path)
    if (await workspaceTextFileExists(path)) {
      existing.push(path)
    }
  }
  return existing
}

async function workspaceTextFileExists(path: string): Promise<boolean> {
  try {
    return (await readOptionalProjectTextFile(path)) !== null
  } catch {
    return false
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function optionalString(value: unknown): string {
  return losslessOptionalString(value, 'workspace parameter')
}

function optionalNumber(value: unknown, fallback: number): number {
  const parsed = losslessNumber(value, 'workspace parameter')
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeDieAreaMode(
  value: unknown,
  fallback: NonNullable<WorkspaceConfig['parameters']['die_area_mode']>,
): NonNullable<WorkspaceConfig['parameters']['die_area_mode']> {
  return value === 'width_height' || value === 'utilitization_margin' ? value : fallback
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    )
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => losslessNumber(item, 'workspace parameter'))
    .filter(Number.isFinite)
}

function normalizeLocalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/+$/g, '') : normalized
}

function getPathLeafName(path: string): string {
  return normalizeLocalPath(path).split('/').filter(Boolean).pop() || path
}

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

const openDocumentation = async () => {
  try {
    if (desktopApi.value ?? hasDesktopApi()) {
      const api = desktopApi.value ?? (await waitForDesktopApi())
      desktopApi.value = api
      await api.system.openExternal(documentationUrl)
    } else {
      window.open(documentationUrl, '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    console.error('Failed to open documentation:', error)
    showToast({
      severity: 'error',
      summary: 'Error',
      detail: `Failed to open documentation because of ${error instanceof Error ? error.message : String(error)}`,
      life: 3000,
    })
  }
}

async function setZoomFactor(nextFactor: number): Promise<void> {
  const factor = zoomFactors.includes(nextFactor as (typeof zoomFactors)[number])
    ? (nextFactor as (typeof zoomFactors)[number])
    : 1
  const api = desktopApi.value ?? (await waitForDesktopApi())
  desktopApi.value = api
  await api.window.setZoomFactor(factor)
  zoomFactor.value = factor
  try {
    await api.settings.set(zoomSettingKey, factor)
  } catch (error) {
    console.warn('[App] Failed to persist UI zoom setting:', error)
  }
}

async function adjustZoom(action: AppMenuAction): Promise<void> {
  const index = zoomFactors.indexOf(zoomFactor.value)
  if (action === appMenuActionIds.zoomReset) {
    await setZoomFactor(1)
    return
  }
  const nextIndex = action === appMenuActionIds.zoomIn ? index + 1 : index - 1
  await setZoomFactor(
    zoomFactors[Math.max(0, Math.min(zoomFactors.length - 1, nextIndex))],
  )
}

const { handleMenuAction } = useAppMenuActions({
  createWindow: async () => {
    const api = await waitForDesktopApi()
    await api.window.create({ initialRoute: '/' })
  },
  navigateToWorkspace: () => {
    router.push('/workspace')
  },
  openDocumentation,
  openProject,
  showAboutDialog: () => {
    showAboutDialog.value = true
  },
  showNewProjectWizard: showCreateWorkspaceWizard,
  reconfigureWorkspace: openWorkspaceReconfigureWizard,
  exportSignoffPackage: () => {
    if (isWorkspaceRoute.value) return exportSignoffPackage()
  },
  exportDesignSummary: () => {
    if (isWorkspaceRoute.value) openDesignReportExport()
  },
  exportDesignMetrics: () => {
    if (isWorkspaceRoute.value) openDesignReportExport()
  },
  manageDesignFiles: openManageDialog,
  adjustZoom,
})
useAppWindowClose(closeProject)

let isResizing = false

// 统一管理 `.window-resizing` class：
// - 桌面窗口的 resize 事件任一来源都会打上这个 class
// - 超过 RESIZE_IDLE_MS 没有新尺寸事件即视为结束
const RESIZE_IDLE_MS = 180
let resizeIdleTimer: ReturnType<typeof setTimeout> | undefined
let unlistenWindowResized: (() => void) | undefined
let unlistenWindowMaximizedChanged: (() => void) | undefined

/**
 * 快路径检测"这次 resize 是不是奔着最大化去的"。
 *
 * `.window-maximized` 的权威来源是 `isMaximized()`，但它是一次 IPC 往返、
 * 往往要几 ~ 几十 ms 才 resolve。而最大化在屏幕上是瞬时发生的，这段 IPC
 * 窗口期里 WebKitGTK 的 transparent 已失效（最大化关闭透明），app-container
 * 的边框又还没被 `.window-maximized` 消掉，边缘位置就可能露出 webview
 * 的白画布，即用户看到的"最大化白闪"。
 *
 * 对策：在 onResized 事件回调里同步读 `window.innerWidth/innerHeight` 与
 * `screen.availWidth/availHeight` 比较，视口接近铺满屏幕就直接乐观地挂上
 * `.window-maximized`；随后 `isMaximized()` 的权威结果再由 `syncMaximizedClass`
 * 做修正。边缘拖拽缩放时启发式判为 false，`.window-maximized` 不挂，窗口
 * 常态视觉完整保留。
 *
 * `- 2` 的余量是为了兼容某些 WM（KDE / Hyprland 等）把窗口最大化到不含面板
 * 的工作区时，视口比 availWidth 少 1 ~ 2 px 的 off-by-one。
 */
function detectLikelyMaximized(): boolean {
  if (typeof window === 'undefined' || !window.screen) return false
  const { availWidth, availHeight } = window.screen
  if (!availWidth || !availHeight) return false
  return window.innerWidth >= availWidth - 2 && window.innerHeight >= availHeight - 2
}

const markResizing = () => {
  isResizing = true
  document.body.classList.add('window-resizing')
  // 广播全局状态，组件（如 HomeView 的 ECharts）可据此跳过昂贵重绘
  setWindowResizing(true)
  // 同步快路径：视口已经铺满屏幕就立刻挂 `.window-maximized`，
  // 不等 `isMaximized()` IPC 回来，消除最大化瞬间的边框白闪。
  if (detectLikelyMaximized()) {
    document.body.classList.add('window-maximized')
  }
  // 随后用权威的 `isMaximized()` 修正快路径可能的误判（例如窗口刚好
  // 被用户手动拖到接近屏幕尺寸但并没真的 maximize）。
  void syncMaximizedClass()
  if (resizeIdleTimer) clearTimeout(resizeIdleTimer)
  resizeIdleTimer = setTimeout(() => {
    resizeIdleTimer = undefined
    isResizing = false
    document.body.classList.remove('window-resizing')
    setWindowResizing(false)
    // 停歇时再同步一次，兜底系统贴边 / 快捷键等中间态没覆盖的情况
    void syncMaximizedClass()
  }, RESIZE_IDLE_MS)
}

/**
 * 同步窗口最大化状态到 body.window-maximized。
 *
 * 目的：Linux (WebKitGTK) 下「透明 + 无装饰 + 最大化」组合会让 webview
 * 露出白色画布，因此最大化时需要把根层背景改成主题色、去掉边框，
 * 见 styles/index.css 与本文件 scoped 样式中的 `.window-maximized` 规则。
 */
async function syncMaximizedClass() {
  if (!desktopApi.value) {
    return
  }

  try {
    const maxed = await desktopApi.value.window.isMaximized()
    document.body.classList.toggle('window-maximized', maxed)
  } catch {
    /* ignore: window API unavailable (e.g. SSR / test) */
  }
}

// 阻止拖拽调整窗口大小时的文本选择
const handleSelectStart = (e: Event) => {
  if (isResizing) {
    e.preventDefault()
    return false
  }
}

onMounted(async () => {
  if (!desktopApi.value) {
    try {
      desktopApi.value = await waitForDesktopApi({ timeoutMs: 5000 })
    } catch (error) {
      console.warn('[App] Desktop bridge not available on initial mount:', error)
    }
  }
  console.info('[App] Desktop bridge available:', Boolean(desktopApi.value))

  if (desktopApi.value) {
    try {
      const savedZoom = await desktopApi.value.settings.get<number>(zoomSettingKey)
      if (
        typeof savedZoom === 'number' &&
        zoomFactors.includes(savedZoom as (typeof zoomFactors)[number])
      ) {
        await setZoomFactor(savedZoom)
      }
    } catch (error) {
      console.warn('[App] Failed to restore UI zoom setting:', error)
    }
  }

  themeStore.initTheme()
  // 在应用启动时加载最近项目和已导入的 PDK
  await Promise.all([loadRecentProjects(), loadPdks()])
  loadVersions()

  await consumeOpenWorkspaceLaunchQuery(route.query.openWorkspace, {
    openProject,
    replaceWorkspaceRoute: async () => {
      await router.replace('/workspace')
    },
    clearOpenWorkspaceQuery: async () => {
      const nextQuery = { ...route.query }
      delete nextQuery.openWorkspace
      await router.replace({ path: route.path, query: nextQuery })
    },
  })

  document.addEventListener('selectstart', handleSelectStart)

  // 启动时先同步一次最大化状态（从持久化会话恢复的场景）
  void syncMaximizedClass()

  if (!desktopApi.value) {
    return
  }

  // 由桌面桥接的 resize 事件统一驱动降级状态，覆盖所有缩放来源。
  unlistenWindowResized = desktopApi.value.window.onResized(() => {
    markResizing()
  })
  unlistenWindowMaximizedChanged = desktopApi.value.window.onMaximizedChanged(
    (isMaximized) => {
      document.body.classList.toggle('window-maximized', isMaximized)
    },
  )
})

onUnmounted(() => {
  document.removeEventListener('selectstart', handleSelectStart)
  if (resizeIdleTimer) {
    clearTimeout(resizeIdleTimer)
    resizeIdleTimer = undefined
  }
  unlistenWindowResized?.()
  unlistenWindowMaximizedChanged?.()
  document.body.classList.remove('window-resizing')
  document.body.classList.remove('window-maximized')
  setWindowResizing(false)
})
</script>

<style>
/* Teleport 到 body，需非 scoped 才能作用在传送后的节点上 */
.runtime-backend-overlay {
  position: fixed;
  inset: 0;
  z-index: 20050;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
}

.runtime-backend-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 40px;
  border-radius: 12px;
  background: var(--bg-primary);
  border: 1px solid rgba(128, 128, 128, 0.28);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  min-width: 240px;
}

.runtime-backend-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border-color, rgba(128, 128, 128, 0.35));
  border-top-color: var(--accent-color, #4a9eff);
  border-radius: 50%;
  animation: runtime-backend-spin 0.75s linear infinite;
}

.runtime-backend-title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #e8e8e8);
}

.runtime-backend-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  text-align: center;
  line-height: 1.45;
}

@keyframes runtime-backend-spin {
  to {
    transform: rotate(360deg);
  }
}

.runtime-backend-overlay-enter-active,
.runtime-backend-overlay-leave-active {
  transition: opacity 0.22s ease;
}

.runtime-backend-overlay-enter-active .runtime-backend-panel,
.runtime-backend-overlay-leave-active .runtime-backend-panel {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}

.runtime-backend-overlay-enter-from,
.runtime-backend-overlay-leave-to {
  opacity: 0;
}

.runtime-backend-overlay-enter-from .runtime-backend-panel,
.runtime-backend-overlay-leave-to .runtime-backend-panel {
  transform: scale(0.96);
  opacity: 0.85;
}

/*
 * 窗口 resize 期间的性能降级：
 * 无装饰 + 透明窗口下，每一帧的布局/合成代价都很高，叠加 blur、阴影、
 * 过渡/动画会让拖边界的手感明显卡顿。resize 停歇后（App.vue 里通过
 * onResized + 去抖移除 class）自动恢复，所以视觉上几乎感觉不到差别。
 */
.window-resizing,
.window-resizing * {
  transition: none !important;
  animation: none !important;
  filter: none !important;
  -webkit-filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  scroll-behavior: auto !important;
}

/*
 * 额外降级：隐藏带 background-image 渐变绘制的 HUD 角标 / 栅格线等装饰。
 * 这些元素每帧都需要 repaint，单独一个就抵掉半帧预算，resize 期间不渲染
 * 它们能显著提升拖拽流畅度。
 */
.window-resizing .bg-grid,
.window-resizing .layout-content {
  background-image: none !important;
}

.window-resizing .section-card::after {
  display: none !important;
}

/* resize 期间图片用最快速路径重采样，避免触发高质量重采样造成的抖动 */
.window-resizing img {
  image-rendering: auto;
}

.window-resizing {
  cursor: default;
}

/*
 * PrimeVue Toast is rendered by this root component and its internal markup is
 * not scoped. Keep long backend errors, paths, and command output inside the
 * notification bubble instead of letting them spill past the rounded panel.
 */
.app-toast.p-toast {
  width: min(420px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
}

.app-toast .p-toast-message {
  max-width: 100%;
  overflow: hidden;
}

.app-toast .p-toast-message-content {
  align-items: flex-start;
  min-width: 0;
}

.app-toast .p-toast-message-icon,
.app-toast .p-toast-close-button {
  flex: 0 0 auto;
}

.app-toast .p-toast-message-text {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
}

.app-toast .p-toast-summary,
.app-toast .p-toast-detail {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.app-toast .p-toast-detail {
  line-height: 1.45;
}
</style>

<style scoped>
.app-wrapper {
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}

.app-container {
  width: 100%;
  height: 100%;
  min-height: 0;
  max-width: 100vw;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 0;
  background: var(--bg-primary);
  /* 边框 - 微弱的亮色边框 */
  border: 1px solid rgba(128, 128, 128, 0.3);
}

/*
 * 最大化时取消边框：
 * 最大化后窗口占满屏幕，边框外露出的可能是 webview 白画布（也就是截图里
 * 那片白屏）。去掉边框后 .app-container 能贴住窗口四边，彻底没处可露。
 * body 不会被 scoped 加 data-v 属性（它是 ancestor），`.app-container`
 * 是本组件自身元素，scoped 转换后选择器仍能正确命中。
 */
body.window-maximized .app-container {
  border-radius: 0;
  border: none;
}

.app-main {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: var(--bg-primary);
}

.app-content {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: var(--bg-primary);
}

.app-content--terminal-safe-area {
  scroll-padding-bottom: var(--terminal-panel-height);
}

.app-content--terminal-safe-area::after {
  content: '';
  display: block;
  height: var(--terminal-panel-height);
  pointer-events: none;
}

.step-config-dialog {
  height: min(72vh, 720px);
  min-height: 420px;
}

/* Maximized dialog: the config area fills the window (above the footer)
   instead of stopping at the normal-mode height. */
.p-dialog-maximized .step-config-dialog {
  height: 100%;
}

.workspace-update-backup-overlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.workspace-update-backup-dialog {
  width: min(460px, 100%);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-primary);
  box-shadow: 0 26px 70px rgba(0, 0, 0, 0.42);
  padding: 22px;
  color: var(--text-primary);
}

.workspace-update-backup-eyebrow {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-color);
}

.workspace-update-backup-dialog h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 750;
}

.workspace-update-backup-dialog p:not(.workspace-update-backup-eyebrow) {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.workspace-update-backup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}

.workspace-update-backup-primary,
.workspace-update-backup-secondary {
  min-height: 34px;
  border-radius: 8px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s,
    opacity 0.15s;
}

.workspace-update-backup-primary {
  border: 1px solid var(--accent-color);
  background: var(--accent-color);
  color: #fff;
}

.workspace-update-backup-primary:hover {
  opacity: 0.9;
}

.workspace-update-backup-secondary {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.workspace-update-backup-secondary:hover {
  border-color: var(--accent-color);
}

/* 调整大小的边缘区域 */
.resize-edge,
.resize-corner {
  position: absolute;
  z-index: 9999;
}

/*
 * 四角 resize 区域需要盖过顶栏按钮，否则用户把鼠标甩到窗口角落时总是
 * 命中按钮或边缘条、永远碰不到对角 resize —— 这正是"斜拉只能横/纵向"
 * 那个 bug 的根因。放到更高的 z-index，并且尺寸足够大（16px）让命中
 * 率更高；但右上角要避开关闭按钮的点击主体，所以刻意只保留与顶栏
 * `.window-btn-close` 的 border-radius（10px）相当的小三角，不会抢走
 * 按钮的主要点击区域。
 */

/* 上边缘（左右留出顶栏按钮/菜单区域，避免与自定义标题栏重叠导致点击被当成 resize） */
.resize-top {
  top: 0;
  left: 220px;
  right: 220px;
  height: 6px;
  cursor: ns-resize;
}

/* 下边缘 */
.resize-bottom {
  bottom: 0;
  left: 20px;
  right: 20px;
  height: 6px;
  cursor: ns-resize;
}

/* 左边缘：从四角 resize 区之后开始，避免和对角 resize 打架 */
.resize-left {
  left: 0;
  top: 16px;
  bottom: 16px;
  width: 6px;
  cursor: ew-resize;
}

/* 右边缘：同样让开四角 resize 区 */
.resize-right {
  right: 0;
  top: 16px;
  bottom: 16px;
  width: 6px;
  cursor: ew-resize;
}

/*
 * 左上角：位于窗口真正的左上角。10×10 刚好落在顶栏左侧图标 padding(16px)
 * 之内，不会挡住 app-icon / 菜单按钮点击。
 */
.resize-top-left {
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
  z-index: 10001;
}

/*
 * 右上角：10×10 刚好落在 `.window-btn-close` border-radius(10px) 的视觉
 * 圆角之内，那块区域本来视觉上就是透明的，改成 resize 命中区既符合
 * 用户心理预期，又不影响按钮主要点击区域（46×40）。z-index 高于其他
 * 边缘条，保证角落优先触发对角 resize。
 */
.resize-top-right {
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
  z-index: 10001;
}

/* 左下角 */
.resize-bottom-left {
  bottom: 0;
  left: 0;
  width: 16px;
  height: 16px;
  cursor: nesw-resize;
  z-index: 10001;
}

/* 右下角 */
.resize-bottom-right {
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 10001;
}

/*
 * 最大化时整体禁用 resize 命中区：
 * 1. 最大化状态下触发 resizeDragging 会被 WM 立刻取消最大化，体验很糟；
 * 2. 四角 resize 区（尤其是 `.resize-top-right` 的 10×10）在最大化后会
 *    占着屏幕最右上角那块像素，和 `.window-btn-close` 贴边后的点击区
 *    重叠，导致"按键部分可按动部分不全"—— 这正是 WSL 下反馈的问题。
 * pointer-events:none 让事件直接穿透到下方的按钮，鼠标能准确命中 Close。
 */
body.window-maximized .resize-edge,
body.window-maximized .resize-corner {
  pointer-events: none;
}
</style>
