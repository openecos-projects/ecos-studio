<template>
  <div class="resource-manager-view">
    <div class="blurred-home" aria-hidden="true">
      <div class="blurred-brand">
        <i class="ri-folder-chart-line"></i>
        <span>Project Management</span>
      </div>
      <div class="blurred-cards">
        <div class="blurred-card is-active"></div>
        <div class="blurred-card"></div>
        <div class="blurred-card"></div>
      </div>
      <div class="blurred-lines">
        <div></div>
        <div></div>
        <div></div>
        <div></div>
      </div>
    </div>

    <div class="manager-scrim" aria-hidden="true"></div>

    <section
      class="manager-dialog"
      :class="{ maximized: isDialogMaximized }"
      aria-labelledby="project-manager-title"
    >
      <div
        class="manager-window-controls"
        aria-label="Project management window controls"
      >
        <button
          type="button"
          class="manager-window-button"
          :aria-label="
            isDialogMaximized
              ? 'Restore project management window'
              : 'Maximize project management window'
          "
          :title="isDialogMaximized ? 'Restore' : 'Maximize'"
          @click="toggleDialogMaximized"
        >
          <i
            :class="
              isDialogMaximized ? 'ri-collapse-diagonal-line' : 'ri-expand-diagonal-line'
            "
          ></i>
        </button>
        <button
          type="button"
          class="manager-window-button"
          aria-label="Close project management"
          title="Close"
          @click="goBack"
        >
          <i class="ri-close-line"></i>
        </button>
      </div>

      <header class="manager-header">
        <div>
          <p class="manager-eyebrow">ECOS Studio</p>
          <h1 id="project-manager-title">Project Management</h1>
        </div>
      </header>

      <div class="manager-grid">
        <aside class="manager-sidebar" aria-label="Projects">
          <div class="project-list-panel" aria-label="Project list panel">
            <div class="project-list-title">
              <h2>Projects</h2>
              <div class="project-list-actions">
                <button
                  type="button"
                  class="circle-action primary header-action-button"
                  title="Import Project"
                  aria-label="Import Project"
                  @click="importProject"
                >
                  <i class="circle-glyph file"></i>
                </button>
                <button
                  type="button"
                  class="circle-action primary header-action-button"
                  title="New Project"
                  aria-label="New Project"
                  @click="openNewProjectDialog"
                >
                  <i class="circle-glyph add"></i>
                </button>
              </div>
            </div>
            <div class="resource-search sidebar-search">
              <i class="ri-search-line"></i>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search project or workspace"
              />
            </div>

            <div
              class="project-list"
              :class="{ 'project-list--popover-open': Boolean(popoverWorkspaceId) }"
              aria-label="Project list"
            >
              <article
                v-for="project in projectCards"
                :key="project.source.id"
                class="project-workspace-tree"
                :class="{ selected: project.model.id === selectedProjectId }"
              >
                <div
                  role="button"
                  tabindex="0"
                  class="resource-row project-tree-row mockup-project-row"
                  :class="{ selected: project.model.id === selectedProjectId }"
                  @click="selectProject(project.model.id)"
                  @keydown.enter.prevent="selectProject(project.model.id)"
                  @keydown.space.prevent="selectProject(project.model.id)"
                >
                  <span class="resource-icon">
                    <i class="ri-layout-grid-line"></i>
                  </span>
                  <span class="resource-copy">
                    <strong>{{ project.model.name }}</strong>
                    <small>{{
                      workspaceCountLabel(project.model.workspaces.length)
                    }}</small>
                  </span>
                  <span class="project-tree-actions">
                    <button
                      type="button"
                      class="circle-action primary"
                      title="Import or open workspace"
                      :aria-label="`Import or open workspace for ${project.model.name}`"
                      @click.stop="importWorkspaceIntoProject(project.model)"
                    >
                      <i class="circle-glyph file"></i>
                    </button>
                    <button
                      type="button"
                      class="circle-action primary"
                      title="New workspace"
                      :aria-label="`New workspace in ${project.model.name}`"
                      @click.stop="createWorkspaceForProject(project.model)"
                    >
                      <i class="circle-glyph add"></i>
                    </button>
                    <button
                      type="button"
                      class="circle-action danger"
                      title="Remove from Project Management"
                      :aria-label="`Remove ${project.model.name} from Project Management`"
                      @click.stop="requestDeleteProject(project.source)"
                    >
                      <i class="circle-glyph remove"></i>
                    </button>
                  </span>
                </div>

                <div
                  v-if="
                    project.model.id === selectedProjectId &&
                    project.model.workspaces.length > 0
                  "
                  class="workspace-tree-list"
                  aria-label="Project workspaces"
                >
                  <div
                    v-for="workspace in project.model.workspaces"
                    :key="workspace.id"
                    class="workspace-tree-item"
                    :class="flowStatusHintClass(workspace.flowStatusHint.state)"
                    :style="workspaceDepthStyle(workspace)"
                  >
                    <div
                      class="workspace-tree-row"
                      @click="selectWorkspace(workspace.id)"
                    >
                      <span class="workspace-tree-copy">
                        <strong>{{ workspace.id }}</strong>
                        <small
                          >{{ workspace.startStep }} -> {{ workspace.endStep }}</small
                        >
                        <em v-if="workspace.sourceWorkspaceId"
                          >from {{ workspace.sourceWorkspaceId }} /
                          {{ workspace.branchStep }}</em
                        >
                      </span>
                      <span
                        class="workspace-flow-hint"
                        :class="flowStatusHintClass(workspace.flowStatusHint.state)"
                      >
                        {{ workspace.flowStatusHint.label }}
                      </span>
                      <span class="workspace-tree-actions">
                        <button
                          type="button"
                          class="circle-action primary"
                          title="Open workspace"
                          :aria-label="`Open workspace ${workspace.id}`"
                          @click.stop="openWorkspace(workspace)"
                        >
                          <i class="circle-glyph open"></i>
                        </button>
                        <button
                          type="button"
                          class="circle-action primary workspace-flow-trigger"
                          title="Create workspace from step output"
                          :aria-label="`Create workspace from ${workspace.id}`"
                          @click.stop="toggleWorkspaceFlowPopover(workspace.id)"
                        >
                          <i class="circle-glyph add"></i>
                        </button>
                        <button
                          type="button"
                          class="circle-action danger"
                          title="Delete workspace"
                          :aria-label="`Delete workspace ${workspace.id}`"
                          @click.stop="requestDeleteWorkspace(workspace.id)"
                        >
                          <i class="circle-glyph remove"></i>
                        </button>
                      </span>
                    </div>

                    <div
                      v-if="
                        popoverWorkspaceId === workspace.id && selectedPopoverWorkspace
                      "
                      class="workspace-flow-popover"
                      :class="workspacePopoverPlacementClass(workspace.id)"
                      role="dialog"
                      aria-label="Workspace Flow Steps"
                    >
                      <header>
                        <strong>Workspace Flow Steps</strong>
                        <small
                          >{{ selectedPopoverWorkspace.id }} ·
                          {{ selectedPopoverWorkspace.startStep }} ->
                          {{ selectedPopoverWorkspace.endStep }}</small
                        >
                      </header>
                      <button
                        v-for="cell in workspaceConfiguredSteps(selectedPopoverWorkspace)"
                        :key="`${selectedPopoverWorkspace.id}-${cell.step}`"
                        type="button"
                        class="popover-step-row"
                        :disabled="!cell.canCreateWorkspace"
                        @click.stop="
                          cell.canCreateWorkspace &&
                          startWorkspaceFromPopoverStep(
                            selectedPopoverWorkspace.id,
                            cell.step,
                          )
                        "
                      >
                        <span>{{ cell.step }}</span>
                        <em :class="stepStatusClass(cell.status)">{{ cell.label }}</em>
                        <span v-if="cell.canCreateWorkspace" class="popover-step-add">
                          <i class="circle-glyph add"></i>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  v-else-if="project.model.id === selectedProjectId"
                  class="workspace-tree-empty"
                >
                  No project data available
                </div>
              </article>

              <div v-if="projectCards.length === 0" class="empty-state">
                No matching projects.
              </div>
            </div>
          </div>
        </aside>

        <main class="manager-table-panel">
          <div class="project-analysis-shell">
            <ProjectAnalysisPanel
              :project="selectedProject"
              :selected-analysis-tab="selectedAnalysisTab"
              :selected-step="selectedStep"
              :selected-workspace-id="selectedWorkspaceId"
              @select-analysis-tab="handleAnalysisTabSelection"
              @select-step="selectStep"
              @select-workspace="selectWorkspace"
              @export-report="exportQorTrendReport"
              @set-baseline="setQorBaseline"
            />
          </div>
        </main>
      </div>
    </section>

    <div v-if="showNewProjectDialog" class="project-modal-scrim" role="presentation">
      <section
        class="project-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <button
          type="button"
          class="manager-close modal-close"
          aria-label="Close new project"
          @click="closeNewProjectDialog"
        >
          <i class="ri-close-line"></i>
        </button>
        <header>
          <p class="manager-eyebrow">Project root</p>
          <h2 id="new-project-title">New Project</h2>
        </header>

        <label class="form-field">
          <span>Project Name</span>
          <input v-model="projectRootDraft.name" type="text" placeholder="project_name" />
        </label>

        <label class="form-field">
          <span>Project Storage Location</span>
          <div class="path-picker">
            <input
              v-model="projectRootDraft.directory"
              type="text"
              readonly
              placeholder="/path/to/project_root"
              @click="selectProjectStorageLocation"
            />
            <button type="button" @click="selectProjectStorageLocation">Browse</button>
          </div>
        </label>

        <p class="modal-help">Project manifest: {{ projectManifestPreview }}</p>
        <p v-if="projectRootError" class="modal-error">{{ projectRootError }}</p>

        <footer class="modal-actions">
          <button type="button" class="secondary-button" @click="closeNewProjectDialog">
            Cancel
          </button>
          <button type="button" class="primary-button" @click="createProjectFolderDraft">
            <i class="ri-check-line"></i>
            <span>Create</span>
          </button>
        </footer>
      </section>
    </div>

    <div v-if="branchDraft" class="project-modal-scrim" role="presentation">
      <section
        class="project-modal-dialog branch-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-draft-title"
      >
        <button
          type="button"
          class="manager-close modal-close"
          aria-label="Close create workspace dialog"
          @click="closeWorkspaceDraftDialog"
        >
          <i class="ri-close-line"></i>
        </button>
        <header>
          <p class="manager-eyebrow">Workspace branch</p>
          <h2 id="branch-draft-title">Create Workspace</h2>
          <p>{{ branchDraft.sourceWorkspaceId }} / {{ branchDraft.step }} output</p>
        </header>

        <code class="modal-path">{{ branchDraft.targetWorkspacePath }}</code>

        <div class="branch-artifacts">
          <strong>Input Artifacts</strong>
          <dl>
            <div>
              <dt>Source output</dt>
              <dd>{{ branchDraft.sourceOutputPath }}</dd>
            </div>
            <div v-if="branchDraft.originDef">
              <dt>DEF</dt>
              <dd>{{ branchDraft.originDef }}</dd>
            </div>
            <div v-if="branchDraft.originVerilog">
              <dt>Verilog</dt>
              <dd>{{ branchDraft.originVerilog }}</dd>
            </div>
            <div v-if="branchDraft.originSdc">
              <dt>SDC</dt>
              <dd>{{ branchDraft.originSdc }}</dd>
            </div>
          </dl>
        </div>

        <footer class="modal-actions">
          <button
            type="button"
            class="secondary-button"
            @click="closeWorkspaceDraftDialog"
          >
            Cancel
          </button>
          <button type="button" class="primary-button" @click="continueWorkspaceDraft">
            <i class="ri-arrow-right-line"></i>
            <span>Continue</span>
          </button>
        </footer>
      </section>
    </div>

    <div v-if="pendingDeleteWorkspaceId" class="project-modal-scrim" role="presentation">
      <section
        class="project-modal-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-workspace-title"
      >
        <button
          type="button"
          class="manager-close modal-close"
          aria-label="Close delete workspace dialog"
          @click="closeDeleteWorkspaceDialog"
        >
          <i class="ri-close-line"></i>
        </button>
        <header>
          <p class="manager-eyebrow">Confirm delete</p>
          <h2 id="delete-workspace-title">Delete Workspace</h2>
        </header>
        <p class="modal-help">
          Remove {{ pendingDeleteWorkspaceId }} from project.json. Keep workspace data is
          checked by default.
        </p>
        <label class="workspace-delete-option">
          <input v-model="keepWorkspaceDataOnDelete" type="checkbox" />
          <span>
            <strong>Keep workspace data</strong>
            <small v-if="keepWorkspaceDataOnDelete">
              Workspace folder will remain at
              {{ pendingDeleteWorkspace?.workspacePath || '-' }}.
            </small>
            <small v-else>
              Workspace folder {{ pendingDeleteWorkspace?.workspacePath || '-' }} will be
              deleted.
            </small>
          </span>
        </label>
        <footer class="modal-actions">
          <button
            type="button"
            class="secondary-button"
            @click="closeDeleteWorkspaceDialog"
          >
            Cancel
          </button>
          <button
            type="button"
            class="secondary-button danger"
            @click="confirmDeleteWorkspace"
          >
            <i class="ri-delete-bin-line"></i>
            <span>Delete</span>
          </button>
        </footer>
      </section>
    </div>

    <div v-if="pendingDeleteProject" class="project-modal-scrim" role="presentation">
      <section
        class="project-modal-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-project-title"
      >
        <button
          type="button"
          class="manager-close modal-close"
          aria-label="Close remove project dialog"
          @click="closeDeleteProjectDialog"
        >
          <i class="ri-close-line"></i>
        </button>
        <header>
          <p class="manager-eyebrow">Confirm removal</p>
          <h2 id="remove-project-title">Remove from Project Management</h2>
        </header>
        <p class="modal-help">
          Remove {{ pendingDeleteProject.name }} from this list? The project folder and
          project.json on disk will be kept. Use Import Project to add it back later.
        </p>
        <footer class="modal-actions">
          <button
            type="button"
            class="secondary-button"
            @click="closeDeleteProjectDialog"
          >
            Cancel
          </button>
          <button
            type="button"
            class="secondary-button danger"
            @click="confirmDeleteProject"
          >
            <i class="ri-subtract-line"></i>
            <span>Remove</span>
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Project, ProjectStatus } from '../types'
import { useWorkspace } from '../composables/useWorkspace'
import ProjectAnalysisPanel from './project-management/ProjectAnalysisPanel.vue'
import {
  readProjectWorkspaceAnalysisInputs,
  readProjectWorkspaceFlowStates,
} from './project-management/projectWorkspaceAnalysisData'
import { waitForDesktopApi } from '@/platform/desktop'
import { mutateProjectManifest } from '@/api/projectManifest'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createWorkspaceBranchDraft,
  resolveProjectSelectionUpdate,
  nextWorkspaceId,
  parseProjectManifest,
  serializeProjectManifest,
  setQorBaselineInManifest,
  type FlowStep,
  type ProjectFlowStatusHint,
  type ProjectManifest,
  type ProjectManagementProject,
  type ProjectStepStatus,
  type ProjectWorkspace,
  type ProjectWorkspaceAnalysisInputsById,
  type ProjectWorkspaceFlowStatesById,
  type WorkspaceBranchDraft,
} from '@/utils/projectManagement'
import { readOptionalProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import {
  loadProjectHistory,
  rememberProjectHistoryEntry,
  removeProjectHistoryEntry,
} from '@/utils/projectHistory'
import { serializeProjectQorTrendReport } from '@/utils/projectQorTrend'

type BranchDraft = WorkspaceBranchDraft

const router = useRouter()
const { openProject, showToast } = useWorkspace()

const searchQuery = ref('')
const selectedProjectId = ref<string | null>(null)
const selectedWorkspaceId = ref('')
const selectedStep = ref<FlowStep>('DRC')
const selectedAnalysisTab = ref<'dashboard' | 'step'>('dashboard')
const hasOpenedStepAnalysis = ref(false)
const branchDraft = ref<BranchDraft | null>(null)
const popoverWorkspaceId = ref('')
const pendingDeleteWorkspaceId = ref<string | null>(null)
const keepWorkspaceDataOnDelete = ref(true)
const pendingDeleteProject = ref<Project | null>(null)
const isDialogMaximized = ref(false)
const projectHistory = ref<Project[]>([])
const projectManifests = ref<Record<string, ProjectManifest>>({})
const workspaceFlowStates = ref<Record<string, ProjectWorkspaceFlowStatesById>>({})
const workspaceAnalysisInputs = ref<Record<string, ProjectWorkspaceAnalysisInputsById>>(
  {},
)
const showNewProjectDialog = ref(false)
const projectRootError = ref('')
const projectRootDraft = ref({
  name: '',
  directory: '',
})

onMounted(async () => {
  document.addEventListener('pointerdown', handleWorkspacePopoverPointerDown)
  document.addEventListener('keydown', handleWorkspacePopoverKeydown)
  projectHistory.value = await loadProjectHistory()
  await refreshProjectManifests()
  if (!selectedProjectId.value)
    selectedProjectId.value = projectCards.value[0]?.model.id ?? selectedProject.value.id
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleWorkspacePopoverPointerDown)
  document.removeEventListener('keydown', handleWorkspacePopoverKeydown)
})

const projectSources = computed<Project[]>(() => projectHistory.value)

const projectCards = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const cards = [...projectSources.value]
    .sort(
      (left, right) =>
        new Date(right.lastOpened).getTime() - new Date(left.lastOpened).getTime(),
    )
    .map((project) => ({
      source: project,
      model: buildProjectManagementProject(
        project,
        projectManifests.value[project.path] ?? null,
        workspaceFlowStates.value[project.path] ?? {},
        workspaceAnalysisInputs.value[project.path] ?? {},
      ),
    }))

  if (!query) return cards
  return cards.filter((project) => projectCardMatchesSearch(project, query))
})

function projectCardMatchesSearch(
  project: { source: Project; model: ProjectManagementProject },
  query: string,
): boolean {
  const projectFields = [
    project.source.name,
    project.source.path,
    project.source.topModule,
    project.source.pdk,
    project.model.name,
    project.model.path,
  ]
  return (
    projectFields.some((value) => textMatchesSearch(value, query)) ||
    project.model.workspaces.some((workspace) => workspaceMatchesSearch(workspace, query))
  )
}

function workspaceMatchesSearch(workspace: ProjectWorkspace, query: string): boolean {
  return [
    workspace.id,
    workspace.name,
    workspace.workspacePath,
    workspace.sourceWorkspaceId,
    workspace.branchStep,
    workspace.startStep,
    workspace.endStep,
    workspace.flowStatusHint.label,
  ].some((value) => textMatchesSearch(value, query))
}

function textMatchesSearch(value: unknown, query: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(query)
}

const selectedProject = computed<ProjectManagementProject>(() => {
  const selected = projectCards.value.find(
    (project) => project.model.id === selectedProjectId.value,
  )
  return (
    selected?.model ?? projectCards.value[0]?.model ?? buildProjectManagementProject(null)
  )
})

const selectedWorkspace = computed<ProjectWorkspace | null>(() => {
  return (
    selectedProject.value.workspaces.find(
      (workspace) => workspace.id === selectedWorkspaceId.value,
    ) ??
    selectedProject.value.workspaces.find(
      (workspace) => workspace.id === selectedProject.value.bestWorkspaceId,
    ) ??
    selectedProject.value.workspaces[0] ??
    null
  )
})

const selectedPopoverWorkspace = computed<ProjectWorkspace | null>(() => {
  return (
    selectedProject.value.workspaces.find(
      (workspace) => workspace.id === popoverWorkspaceId.value,
    ) ?? null
  )
})
const pendingDeleteWorkspace = computed<ProjectWorkspace | null>(() => {
  return (
    selectedProject.value.workspaces.find(
      (workspace) => workspace.id === pendingDeleteWorkspaceId.value,
    ) ?? null
  )
})

const projectManifestPreview = computed(() => {
  const root = normalizePath(projectRootDraft.value.directory.trim())
  if (!root) return '<project_root>/project.json'
  return `${root}/project.json`
})

let activeProjectKey: string | null = null
let projectManifestRefreshQueue = Promise.resolve()

watch(
  selectedProject,
  (project) => {
    const update = resolveProjectSelectionUpdate(
      activeProjectKey,
      project,
      selectedWorkspaceId.value,
    )
    activeProjectKey = update.nextProjectKey

    if (update.mode === 'reset' && update.selection) {
      selectedWorkspaceId.value = update.selection.selectedWorkspaceId
      selectedStep.value = update.selection.selectedStep
      hasOpenedStepAnalysis.value = false
      popoverWorkspaceId.value = ''
      branchDraft.value = null
      return
    }

    if (update.mode === 'reconcile-workspace') {
      selectedWorkspaceId.value = update.nextWorkspaceId ?? ''
    }
  },
  { immediate: true },
)

watch(projectSources, () => {
  void refreshProjectManifests()
})

function selectProject(projectId: string) {
  selectedProjectId.value = projectId
  branchDraft.value = null
  popoverWorkspaceId.value = ''
}

function selectWorkspace(workspaceId: string) {
  selectedWorkspaceId.value = workspaceId
  branchDraft.value = null
}

function selectStep(step: FlowStep) {
  selectedStep.value = step
  hasOpenedStepAnalysis.value = true
  branchDraft.value = null
}

function openStepAnalysis() {
  selectedAnalysisTab.value = 'step'
  if (!hasOpenedStepAnalysis.value) {
    selectedStep.value = 'Synth'
    hasOpenedStepAnalysis.value = true
  }
}

function handleAnalysisTabSelection(tab: 'dashboard' | 'step') {
  if (tab === 'step') {
    openStepAnalysis()
    return
  }
  selectedAnalysisTab.value = tab
}

async function exportQorTrendReport() {
  const project = selectedProject.value
  if (!project.path) return

  try {
    await writeProjectTextFile(
      'qor_trend.json',
      serializeProjectQorTrendReport(project.qorTrendSummary, {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
      }),
      { projectPath: project.path },
    )
    showToast({
      severity: 'success',
      summary: 'QoR report exported',
      detail: 'qor_trend.json was written to the project root.',
    })
  } catch (error) {
    console.warn('Failed to export QoR trend report.', error)
    showToast({
      severity: 'warn',
      summary: 'QoR report not exported',
      detail: 'qor_trend.json could not be written.',
    })
  }
}

async function setQorBaseline(payload: { workspaceId: string }) {
  const project = selectedProject.value
  if (!project.path) return

  try {
    const manifest =
      projectManifests.value[project.path] ?? (await readProjectManifest(project.path))
    const updated = setQorBaselineInManifest(
      manifest,
      payload.workspaceId,
      'Selected from Dashboard QoR Overview',
    )
    if (updated === manifest) {
      throw new Error(
        `Workspace ${payload.workspaceId} is not registered in project.json.`,
      )
    }
    await writeProjectTextFile('project.json', serializeProjectManifest(updated), {
      projectPath: project.path,
    })
    await applyProjectManifestForProject(updated, project.path)
    selectedWorkspaceId.value = payload.workspaceId
    showToast({
      severity: 'success',
      summary: 'QoR baseline updated',
      detail: `${payload.workspaceId} is now the project QoR baseline.`,
    })
  } catch (error) {
    console.warn('Failed to update QoR baseline.', error)
    showToast({
      severity: 'warn',
      summary: 'QoR baseline not updated',
      detail: 'project.json could not be updated.',
    })
  }
}

function toggleDialogMaximized() {
  isDialogMaximized.value = !isDialogMaximized.value
}

async function startWorkspaceFromCell(workspaceId: string, step: FlowStep) {
  const targetWorkspaceId = await nextAvailableWorkspaceId(selectedProject.value)
  if (!targetWorkspaceId) return
  branchDraft.value = createWorkspaceBranchDraft(
    selectedProject.value,
    workspaceId,
    step,
    targetWorkspaceId,
  )
}

function toggleWorkspaceFlowPopover(workspaceId: string) {
  selectedWorkspaceId.value = workspaceId
  branchDraft.value = null
  popoverWorkspaceId.value = popoverWorkspaceId.value === workspaceId ? '' : workspaceId
}

function closeWorkspaceFlowPopover() {
  popoverWorkspaceId.value = ''
}

function handleWorkspacePopoverPointerDown(event: PointerEvent) {
  if (!popoverWorkspaceId.value) return
  const target = event.target
  if (!(target instanceof Element)) {
    closeWorkspaceFlowPopover()
    return
  }
  if (target.closest('.workspace-flow-popover')) return
  if (target.closest('.workspace-flow-trigger')) return
  closeWorkspaceFlowPopover()
}

function handleWorkspacePopoverKeydown(event: KeyboardEvent) {
  if (!popoverWorkspaceId.value || event.key !== 'Escape') return
  closeWorkspaceFlowPopover()
}

async function startWorkspaceFromPopoverStep(workspaceId: string, step: FlowStep) {
  await startWorkspaceFromCell(workspaceId, step)
  closeWorkspaceFlowPopover()
}

function workspaceConfiguredSteps(
  workspace: ProjectWorkspace,
): ProjectWorkspace['steps'] {
  const startIndex = FLOW_STEPS.indexOf(workspace.startStep)
  const endIndex = FLOW_STEPS.indexOf(workspace.endStep)
  if (startIndex < 0 || endIndex < startIndex) return workspace.steps
  return workspace.steps.filter((cell) => {
    const stepIndex = FLOW_STEPS.indexOf(cell.step)
    return stepIndex >= startIndex && stepIndex <= endIndex
  })
}

function closeWorkspaceDraftDialog() {
  branchDraft.value = null
}

async function continueWorkspaceDraft() {
  if (!branchDraft.value) return
  await router.push({
    path: '/ecc',
    query: {
      workspacePath: branchDraft.value.targetWorkspacePath,
      projectRoot: selectedProject.value.path,
      projectName: selectedProject.value.name,
      sourceWorkspace: branchDraft.value.sourceWorkspaceId,
      sourceWorkspacePath: branchDraft.value.sourceWorkspacePath,
      sourceStep: branchDraft.value.step,
      sourceOutputPath: branchDraft.value.sourceOutputPath,
      sourceOutputType: branchDraft.value.sourceOutputType,
      originDef: branchDraft.value.originDef,
      originVerilog: branchDraft.value.originVerilog,
      sdc: branchDraft.value.originSdc,
      startStep: branchDraft.value.targetStartStep,
      endStep: branchDraft.value.targetEndStep,
      workspaceId: branchDraft.value.targetWorkspaceId,
    },
  })
}

async function openWorkspace(workspace: ProjectWorkspace) {
  const success = await openProject({
    id: workspace.workspacePath,
    name: `${selectedProject.value.name}/${workspace.id}`,
    path: workspace.workspacePath,
    lastOpened: new Date(),
  })
  if (success) {
    await router.push({
      path: '/workspace/home',
      query: workspaceRouteQuery(workspace.workspacePath, workspace.id),
    })
  } else {
    showToast({
      severity: 'warn',
      summary: 'Workspace not opened',
      detail: `${workspace.workspacePath} is not available yet.`,
    })
  }
}

function refreshProjectManifests(): Promise<void> {
  const refresh = projectManifestRefreshQueue.then(
    refreshProjectManifestsNow,
    refreshProjectManifestsNow,
  )
  projectManifestRefreshQueue = refresh.then(
    () => undefined,
    () => undefined,
  )
  return refresh
}

async function refreshProjectManifestsNow() {
  const entries: Array<
    [
      string,
      ProjectManifest,
      ProjectWorkspaceFlowStatesById,
      ProjectWorkspaceAnalysisInputsById,
    ]
  > = []

  for (const project of projectSources.value) {
    try {
      const projectRoot = await registerProjectRootForProjectManagement(project.path)
      if (!projectRoot) continue
      const manifestText = await readOptionalProjectTextFile('project.json', {
        projectPath: projectRoot,
      })
      if (!manifestText) continue
      const manifest = parseProjectManifest(manifestText)
      const flowStates = await readProjectWorkspaceFlowStates(manifest)
      const analysisInputs = await readProjectWorkspaceAnalysisInputs(manifest)
      entries.push([project.path, manifest, flowStates, analysisInputs])
    } catch (error) {
      console.warn(`Failed to load project manifest: ${project.path}`, error)
    }
  }

  projectManifests.value = Object.fromEntries(
    entries.map(([path, manifest]) => [path, manifest]),
  )
  workspaceFlowStates.value = Object.fromEntries(
    entries.map(([path, _manifest, flowStates]) => [path, flowStates]),
  )
  workspaceAnalysisInputs.value = Object.fromEntries(
    entries.map(([path, _manifest, _flowStates, analysisInputs]) => [
      path,
      analysisInputs,
    ]),
  )
}

async function importProject() {
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const directory = await desktopApi.dialog.pickDirectory({
      title: 'Select Project Folder',
    })
    if (!directory) return

    const projectRoot = await registerProjectRootForProjectManagement(directory)
    if (!projectRoot) {
      showToast({
        severity: 'warn',
        summary: 'Project not imported',
        detail:
          'The selected project folder could not be registered for local file access.',
      })
      return
    }

    const project = await loadProjectFromRoot(projectRoot)
    const manifest = await readProjectManifest(project.path)
    projectHistory.value = await rememberProjectHistoryEntry(project)
    projectManifests.value = {
      ...projectManifests.value,
      [project.path]: manifest,
    }
    workspaceFlowStates.value = {
      ...workspaceFlowStates.value,
      [project.path]: await readProjectWorkspaceFlowStates(manifest),
    }
    workspaceAnalysisInputs.value = {
      ...workspaceAnalysisInputs.value,
      [project.path]: await readProjectWorkspaceAnalysisInputs(manifest),
    }
    selectedProjectId.value = project.id
  } catch (error) {
    console.warn('Failed to import project root.', error)
    showToast({
      severity: 'warn',
      summary: 'Project not imported',
      detail: 'Select a folder that contains a valid project.json.',
    })
  }
}

async function importWorkspaceIntoProject(project: ProjectManagementProject) {
  if (!project.path) return
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const directory = await desktopApi.dialog.pickDirectory({
      title: 'Select Workspace Folder',
    })
    if (!directory) return

    const projectRoot = await registerProjectRootForProjectManagement(project.path)
    if (!projectRoot) {
      showToast({
        severity: 'warn',
        summary: 'Workspace not imported',
        detail: 'The project root could not be registered for local file access.',
      })
      return
    }

    const updated = await mutateProjectManifest(projectRoot, {
      type: 'register-workspace',
      input: {
        projectRoot,
        projectName: project.name,
        workspacePath: directory,
      },
    })
    await applyProjectManifestForProject(updated, projectRoot)
    selectedProjectId.value = project.id
  } catch (error) {
    console.warn('Failed to import workspace into project.', error)
    showToast({
      severity: 'warn',
      summary: 'Workspace not imported',
      detail: 'project.json could not be updated.',
    })
  }
}

async function createWorkspaceForProject(project: ProjectManagementProject) {
  if (!project.path) return
  const workspaceId = await nextAvailableWorkspaceId(project)
  if (!workspaceId) return
  await router.push({
    path: '/ecc',
    query: {
      projectRoot: project.path,
      projectName: project.name,
      workspacePath: joinProjectPath(project.path, workspaceId),
      workspaceId,
    },
  })
}

function requestDeleteWorkspace(workspaceId: string) {
  pendingDeleteWorkspaceId.value = workspaceId
  keepWorkspaceDataOnDelete.value = true
}

function closeDeleteWorkspaceDialog() {
  pendingDeleteWorkspaceId.value = null
  keepWorkspaceDataOnDelete.value = true
}

async function confirmDeleteWorkspace() {
  const workspaceId = pendingDeleteWorkspaceId.value
  const deleted = await deleteWorkspace(workspaceId ?? undefined, {
    keepWorkspaceData: keepWorkspaceDataOnDelete.value,
  })
  if (deleted) closeDeleteWorkspaceDialog()
}

function requestDeleteProject(project: Project) {
  pendingDeleteProject.value = project
}

function closeDeleteProjectDialog() {
  pendingDeleteProject.value = null
}

async function confirmDeleteProject() {
  if (!pendingDeleteProject.value) return
  await removeProjectFromHistory(pendingDeleteProject.value)
  closeDeleteProjectDialog()
}

async function deleteWorkspace(
  workspaceId?: string,
  options: { keepWorkspaceData?: boolean } = {},
): Promise<boolean> {
  if (!workspaceId || !selectedProject.value.path) return false
  try {
    const updated = await mutateProjectManifest(selectedProject.value.path, {
      type: 'delete-workspace',
      workspaceId,
      deleteDirectory: !options.keepWorkspaceData,
    })

    try {
      await applyProjectManifestForProject(updated, selectedProject.value.path)
    } catch (error) {
      console.warn(
        'Workspace deletion succeeded but project cache refresh failed.',
        error,
      )
    }

    if (
      selectedWorkspaceId.value === workspaceId ||
      !updated.workspaces.some(
        (workspace) => workspace.workspace_id === selectedWorkspaceId.value,
      )
    ) {
      selectedWorkspaceId.value = updated.workspaces[0]?.workspace_id ?? ''
    }
    branchDraft.value = null
    return true
  } catch (error) {
    console.warn('Failed to delete selected workspace.', error)
    showToast({
      severity: 'warn',
      summary: 'Workspace not deleted',
      detail: 'project.json could not be updated.',
    })
    return false
  }
}

async function nextAvailableWorkspaceId(
  project: ProjectManagementProject,
): Promise<string | null> {
  try {
    const projectRoot = await registerProjectRootForProjectManagement(project.path)
    if (!projectRoot) throw new Error('Project root could not be registered.')
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const entries = await desktopApi.workspace.listProjectDirectory(projectRoot)
    const occupiedWorkspaceIds = entries.map((entry) => entry.name)
    return nextWorkspaceId(project, occupiedWorkspaceIds)
  } catch (error) {
    console.warn('Failed to inspect existing workspace directories.', error)
    showToast({
      severity: 'warn',
      summary: 'Workspace not created',
      detail: 'The project directory could not be inspected safely.',
    })
    return null
  }
}

async function removeProjectFromHistory(project: Project) {
  projectHistory.value = await removeProjectHistoryEntry(project.path)
  const nextManifests = { ...projectManifests.value }
  delete nextManifests[project.path]
  projectManifests.value = nextManifests
  const nextWorkspaceFlowStates = { ...workspaceFlowStates.value }
  delete nextWorkspaceFlowStates[project.path]
  workspaceFlowStates.value = nextWorkspaceFlowStates
  const nextWorkspaceAnalysisInputs = { ...workspaceAnalysisInputs.value }
  delete nextWorkspaceAnalysisInputs[project.path]
  workspaceAnalysisInputs.value = nextWorkspaceAnalysisInputs
  if (selectedProjectId.value === project.id) {
    selectedProjectId.value = projectCards.value[0]?.model.id ?? null
  }
}

function openNewProjectDialog() {
  projectRootError.value = ''
  projectRootDraft.value = {
    name: '',
    directory: '',
  }
  showNewProjectDialog.value = true
}

function closeNewProjectDialog() {
  showNewProjectDialog.value = false
  projectRootError.value = ''
}

async function selectProjectStorageLocation() {
  projectRootError.value = ''
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const directory = await desktopApi.dialog.pickDirectory({
      title: 'Select Project Storage Location',
    })
    if (directory) projectRootDraft.value.directory = normalizePath(directory)
  } catch {
    const manualPath =
      typeof window !== 'undefined' ? window.prompt('Project Storage Location') : null
    if (manualPath) projectRootDraft.value.directory = normalizePath(manualPath)
  }
}

async function createProjectFolderDraft() {
  const directory = normalizePath(projectRootDraft.value.directory.trim())
  if (!directory) {
    projectRootError.value = 'Project Storage Location is required.'
    return
  }

  const projectRoot = await registerProjectRootForProjectManagement(directory)
  if (!projectRoot) {
    projectRootError.value = 'Project Storage Location could not be registered.'
    showToast({
      severity: 'warn',
      summary: 'Project not created',
      detail: 'The selected project root could not be registered for local file access.',
    })
    return
  }

  const name =
    projectRootDraft.value.name.trim() || basenamePath(projectRoot) || 'project'
  const manifest = await mutateProjectManifest(projectRoot, {
    type: 'create',
    name,
  })
  await applyProjectManifestForProject(manifest, projectRoot)
  selectedProjectId.value = projectRoot
  closeNewProjectDialog()
}

const goBack = () => router.push('/')

function workspaceCountLabel(count: number): string {
  return `${count} workspace${count === 1 ? '' : 's'}`
}

function workspaceDepthStyle(workspace: ProjectWorkspace) {
  return {
    '--workspace-depth': String(workspace.depth),
  }
}

function flowStatusHintClass(state: ProjectFlowStatusHint['state']): string {
  return `flow-hint-${state}`
}

function workspacePopoverPlacementClass(_workspaceId: string): string {
  return ''
}

function stepStatusClass(status: ProjectStepStatus): string {
  const map: Record<ProjectStepStatus, string> = {
    success: 'step-success',
    reused: 'step-reused',
    skipped: 'step-skipped',
    unstart: 'step-unstart',
    running: 'step-running',
    failed: 'step-failed',
  }
  return map[status]
}

function joinProjectPath(rootPath: string, name: string): string {
  const root = normalizePath(rootPath)
  const child = name.replace(/^\/+/, '')
  return root ? `${root}/${child}` : child
}

async function loadProjectFromRoot(projectRoot: string): Promise<Project> {
  const root = normalizePath(projectRoot)
  const manifest = await readProjectManifest(root)
  return projectFromManifest(manifest, root)
}

async function registerProjectRootForProjectManagement(
  projectRoot: string,
): Promise<string | null> {
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const registeredRoot = await desktopApi.workspace.registerProjectRoot(projectRoot)
    return normalizePath(registeredRoot || projectRoot)
  } catch (error) {
    console.warn('Failed to register project root for Project Management.', error)
    return null
  }
}

async function readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  const manifestText = await readOptionalProjectTextFile('project.json', {
    projectPath: projectRoot,
  })
  if (!manifestText) throw new Error('Project manifest does not exist.')
  return parseProjectManifest(manifestText)
}

async function applyProjectManifestForProject(
  manifest: ProjectManifest,
  projectRoot: string,
) {
  const registeredProjectRoot = await registerProjectRootForProjectManagement(projectRoot)
  if (!registeredProjectRoot) throw new Error('Project root could not be registered.')
  const normalizedRoot = normalizePath(registeredProjectRoot)
  const flowStates = await readProjectWorkspaceFlowStates(manifest)
  const analysisInputs = await readProjectWorkspaceAnalysisInputs(manifest)
  projectManifests.value = {
    ...projectManifests.value,
    [projectRoot]: manifest,
    [normalizedRoot]: manifest,
  }
  workspaceFlowStates.value = {
    ...workspaceFlowStates.value,
    [projectRoot]: flowStates,
    [normalizedRoot]: flowStates,
  }
  workspaceAnalysisInputs.value = {
    ...workspaceAnalysisInputs.value,
    [projectRoot]: analysisInputs,
    [normalizedRoot]: analysisInputs,
  }
  projectHistory.value = await rememberProjectHistoryEntry(
    projectFromManifest(manifest, normalizedRoot),
  )
}

function workspaceRouteQuery(workspacePath?: string, workspaceId?: string) {
  return {
    projectRoot: selectedProject.value.path,
    projectName: selectedProject.value.name,
    workspaceId:
      workspaceId ||
      basenamePath(workspacePath ?? '') ||
      selectedWorkspace.value?.id ||
      '',
  }
}

function projectFromManifest(manifest: ProjectManifest, fallbackRoot: string): Project {
  const path = normalizePath(manifest.root_path || fallbackRoot)
  return {
    id: path,
    name: manifest.name || basenamePath(path) || 'project',
    path,
    lastOpened: new Date(),
    pdk: manifest.base_design.pdk,
    topModule: manifest.base_design.top_module,
    status: projectStatusFromManifest(manifest),
  }
}

function projectStatusFromManifest(manifest: ProjectManifest): ProjectStatus {
  if (manifest.workspaces.some((workspace) => workspace.status === 'running'))
    return 'running'
  if (manifest.workspaces.some((workspace) => workspace.status === 'failed'))
    return 'failed'
  if (manifest.workspaces.some((workspace) => workspace.status === 'in_progress'))
    return 'in_progress'
  if (
    manifest.workspaces.length > 0 &&
    manifest.workspaces.every((workspace) => workspace.status === 'success')
  )
    return 'success'
  return manifest.workspaces.length > 0 ? 'in_progress' : 'not_started'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function basenamePath(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? ''
}
</script>

<style scoped src="./project-management/projectsView.css"></style>
