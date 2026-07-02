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
      <div class="manager-window-controls" aria-label="Project management window controls">
        <button
          type="button"
          class="manager-window-button"
          :aria-label="isDialogMaximized ? 'Restore project management window' : 'Maximize project management window'"
          :title="isDialogMaximized ? 'Restore' : 'Maximize'"
          @click="toggleDialogMaximized"
        >
          <i :class="isDialogMaximized ? 'ri-collapse-diagonal-line' : 'ri-expand-diagonal-line'"></i>
        </button>
        <button type="button" class="manager-window-button" aria-label="Close project management" title="Close" @click="goBack">
          <i class="ri-close-line"></i>
        </button>
      </div>

      <header class="manager-header">
        <div>
          <p class="manager-eyebrow">ECOS Studio</p>
          <h1 id="project-manager-title">Project Management</h1>
          <p>One folder per project. Workspaces are created inside the selected project root.</p>
        </div>
        <div class="manager-header-actions">
          <button type="button" class="icon-button" title="Import Project" @click="importProject">
            <i class="ri-folder-open-line"></i>
          </button>
          <button type="button" class="primary-button" @click="openNewProjectDialog">
            <i class="ri-add-line"></i>
            <span>New Project</span>
          </button>
        </div>
      </header>

      <div class="manager-grid">
        <aside class="manager-sidebar" aria-label="Projects">
          <div class="sidebar-stack">
            <div class="resource-search sidebar-search">
              <i class="ri-search-line"></i>
              <input v-model="searchQuery" type="text" placeholder="Search project" />
            </div>

            <div class="project-list" aria-label="Project list">
              <div
                v-for="project in projectCards"
                :key="project.source.id"
                role="button"
                tabindex="0"
                class="resource-row"
                :class="{ selected: project.model.id === selectedProjectId }"
                @click="selectProject(project.model.id)"
                @keydown.enter.prevent="selectProject(project.model.id)"
                @keydown.space.prevent="selectProject(project.model.id)"
              >
                <span class="resource-icon">
                  <i class="ri-folder-chart-line"></i>
                </span>
                <span class="resource-copy">
                  <strong>{{ project.model.name }}</strong>
                  <small>{{ project.model.pdk }} · {{ project.model.topModule }}</small>
                </span>
                <span class="status-pill" :class="statusBadgeClass(project.source.status)">
                  {{ statusLabel(project.source.status) }}
                </span>
                <button
                  type="button"
                  class="row-remove-btn"
                  title="Remove project history"
                  @click.stop="removeProjectFromHistory(project.source)"
                >
                  <i class="ri-close-line"></i>
                </button>
              </div>

              <div v-if="projectCards.length === 0" class="empty-state">
                No matching projects.
              </div>
            </div>
          </div>
        </aside>

        <main class="manager-table-panel">
          <div class="manager-toolbar">
            <div>
              <h2>{{ selectedProject.name }}</h2>
              <p>{{ selectedProject.objective }} · {{ selectedProject.path }}</p>
            </div>
            <div class="toolbar-actions">
              <button
                type="button"
                class="secondary-button toolbar-action"
                :disabled="!selectedProject.path"
                @click="openBackendDesign"
              >
                <i class="ri-cpu-line"></i>
                <span>Backend Design</span>
              </button>
            </div>
          </div>

          <div class="project-workbench">
            <section class="metrics-panel" aria-labelledby="metrics-summary-title">
              <div class="panel-title-row">
                <div>
                  <h3 id="metrics-summary-title">Metrics Summary</h3>
                  <p>
                    {{ selectedWorkspaceLabel }} row · {{ selectedStep }} column
                  </p>
                </div>
                <div class="axis-chips">
                  <span class="axis-chip workspace">{{ selectedWorkspaceLabel }}</span>
                  <span class="axis-chip step">{{ selectedStep }}</span>
                </div>
              </div>

              <div v-if="hasMetricsData" class="metrics-content">
                <div class="metrics-board" :style="metricsGridStyle">
                  <div class="metric-corner">Metric</div>
                  <div
                    v-for="workspace in selectedProject.workspaces"
                    :key="workspace.id"
                    class="metric-workspace"
                    :class="{ selected: workspace.id === selectedWorkspaceId }"
                    @click="selectWorkspace(workspace.id)"
                  >
                    {{ workspace.id }}
                  </div>

                  <template v-for="row in selectedProject.metricsRows" :key="row.id">
                    <div class="metric-label">
                      <strong>{{ row.label }}</strong>
                      <small>{{ row.hint }}</small>
                    </div>
                    <div
                      v-for="point in row.points"
                      :key="`${row.id}-${point.workspaceId}`"
                      class="metric-point"
                      :class="[metricValueClass(point.state), { selected: point.workspaceId === selectedWorkspaceId }]"
                      @click="selectWorkspace(point.workspaceId)"
                    >
                      <span>{{ point.label }}</span>
                      <div class="metric-track">
                        <i :style="{ width: `${metricInlineWidth(point)}%` }"></i>
                      </div>
                    </div>
                  </template>
                </div>

                <div class="comparison-summary" aria-label="Project comparisonSummary">
                  <div class="summary-best">
                    <strong>Best {{ selectedProject.comparisonSummary.bestWorkspaceId || '-' }}</strong>
                    <span>{{ selectedProject.comparisonSummary.bestReason || 'No recommendation yet' }}</span>
                  </div>
                  <div class="comparison-grid">
                    <div>
                      <h4>Parameter Diff</h4>
                      <p v-if="selectedProject.comparisonSummary.parameterDiffs.length === 0">-</p>
                      <p
                        v-for="diff in selectedProject.comparisonSummary.parameterDiffs.slice(0, 3)"
                        :key="`${diff.workspaceId}-${diff.name}`"
                      >
                        {{ diff.workspaceId }} · {{ diff.name }}: {{ diff.from ?? '-' }} -> {{ diff.to ?? '-' }}
                      </p>
                    </div>
                    <div>
                      <h4>Metric Delta</h4>
                      <p v-if="selectedProject.comparisonSummary.metricDiffs.length === 0">-</p>
                      <p
                        v-for="diff in selectedProject.comparisonSummary.metricDiffs.slice(0, 3)"
                        :key="`${diff.fromWorkspaceId}-${diff.toWorkspaceId}-${diff.metric}`"
                        :class="metricValueClass(diff.state)"
                      >
                        {{ diff.metric }} {{ signedDelta(diff.delta) }}
                      </p>
                    </div>
                    <div>
                      <h4>Risk</h4>
                      <p v-if="selectedProject.comparisonSummary.riskLabels.length === 0">-</p>
                      <p
                        v-for="risk in selectedProject.comparisonSummary.riskLabels.slice(0, 3)"
                        :key="risk"
                      >
                        {{ risk }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="metrics-empty-state">
                <i class="ri-line-chart-line"></i>
                <strong>No project data available</strong>
                <span>Build or import a project manifest to populate metrics.</span>
              </div>
            </section>

            <section class="flow-panel" aria-labelledby="flow-matrix-title">
              <div class="panel-title-row compact">
                <div>
                  <h3 id="flow-matrix-title">Workspace Flow Matrix</h3>
                  <p>{{ selectedProject.workspaces.length }} workspaces · {{ FLOW_STEPS.length }} steps</p>
                </div>
                <div class="legend-list">
                  <span v-for="item in legendItems" :key="item.label">
                    <i :class="item.class"></i>{{ item.label }}
                  </span>
                </div>
              </div>

              <div class="flow-scroll">
                <div class="flow-matrix" :style="matrixGridStyle">
                  <div class="flow-header workspace-header">Workspace</div>
                  <button
                    v-for="step in FLOW_STEPS"
                    :key="step"
                    type="button"
                    class="flow-header step-header"
                    :class="{ selected: step === selectedStep }"
                    @click="selectStep(step)"
                  >
                    {{ step }}
                  </button>
                  <div class="flow-header open-header">Open</div>

                  <div v-if="hasProjectData" class="flow-rows">
                    <svg class="flow-link-layer" :viewBox="branchLinkViewBox" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <marker id="branch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                          <path d="M0,0 L8,4 L0,8 Z"></path>
                        </marker>
                      </defs>
                      <path
                        v-for="link in selectedProject.branchLinks"
                        :key="`${link.fromWorkspaceId}-${link.fromStep}-${link.toWorkspaceId}-${link.toStep}`"
                        class="branch-link"
                        :d="branchLinkPath(link)"
                      ></path>
                    </svg>

                    <div
                      v-for="workspace in selectedProject.workspaces"
                      :key="workspace.id"
                      class="flow-row"
                      :class="{ selected: workspace.id === selectedWorkspaceId }"
                      :style="matrixGridStyle"
                      @click="selectWorkspace(workspace.id)"
                    >
                      <button type="button" class="workspace-cell" @click.stop="selectWorkspace(workspace.id)">
                        <strong>{{ workspace.id }}</strong>
                        <small>{{ workspace.description }}</small>
                      </button>

                      <div
                        v-for="cell in workspace.steps"
                        :key="cell.step"
                        class="flow-cell-wrap"
                        :class="{ selected: cell.step === selectedStep }"
                      >
                        <button
                          type="button"
                          class="flow-cell"
                          :class="stepStatusClass(cell.status)"
                          @click.stop="selectStep(cell.step); selectWorkspace(workspace.id)"
                        >
                          {{ cell.label }}
                        </button>
                        <button
                          v-if="cell.canCreateWorkspace && cell.step === selectedStep && workspace.id === selectedWorkspaceId"
                          type="button"
                          class="cell-add-button"
                          title="Create workspace from this step"
                          @click.stop="startWorkspaceFromCell(workspace.id, cell.step)"
                        >
                          <i class="ri-add-line"></i>
                        </button>
                      </div>

                      <button
                        type="button"
                        class="row-action-btn"
                        title="Open workspace"
                        @click.stop="openWorkspace(workspace)"
                      >
                        <i class="ri-external-link-line"></i>
                      </button>
                    </div>
                  </div>
                  <div v-else class="flow-empty-state">
                    <i class="ri-node-tree"></i>
                    <strong>No project data available</strong>
                    <span>Workspace rows will appear after a real project is constructed.</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>

        <aside class="selected-panel" aria-label="Selected context">
          <section class="selected-section">
            <h2>Project</h2>
            <dl>
              <div>
                <dt>Root</dt>
                <dd>{{ selectedProject.path }}</dd>
              </div>
              <div>
                <dt>Best</dt>
                <dd>{{ selectedProject.bestWorkspaceId || '-' }}</dd>
              </div>
              <div>
                <dt>PDK</dt>
                <dd>{{ selectedProject.pdk || '-' }}</dd>
              </div>
            </dl>
          </section>

          <section class="selected-section">
            <h2>Selection</h2>
            <dl>
              <div>
                <dt>Path</dt>
                <dd>{{ selectedWorkspacePathLabel }}</dd>
              </div>
              <div>
                <dt>Step</dt>
                <dd>{{ selectedStep }}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{{ selectedWorkspaceLabel }}</dd>
              </div>
            </dl>
          </section>

          <section class="selected-section">
            <h2>Project Storage Location</h2>
            <p class="side-note">{{ selectedProject.path || '<project_root>' }}/&lt;workspace_name&gt;</p>
          </section>

          <section v-if="selectedWorkspace" class="selected-section">
            <h2>Workspace Actions</h2>
            <div class="action-row">
              <button type="button" class="secondary-button" @click="archiveSelectedWorkspace">
                <i class="ri-archive-line"></i>
                <span>Archive</span>
              </button>
              <button type="button" class="secondary-button danger" @click="deleteSelectedWorkspace">
                <i class="ri-delete-bin-line"></i>
                <span>Delete</span>
              </button>
            </div>
          </section>

          <section v-if="branchDraft" class="selected-section branch-draft-card">
            <h2>Create Workspace</h2>
            <p>
              {{ branchDraft.sourceWorkspaceId }} / {{ branchDraft.step }} output
            </p>
            <code>{{ branchDraft.targetWorkspacePath }}</code>
            <button type="button" class="primary-button full" @click="continueWorkspaceDraft">
              <i class="ri-arrow-right-line"></i>
              <span>Continue</span>
            </button>
          </section>
        </aside>
      </div>
    </section>

    <div v-if="showNewProjectDialog" class="project-modal-scrim" role="presentation">
      <section class="project-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <button type="button" class="manager-close modal-close" aria-label="Close new project" @click="closeNewProjectDialog">
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
          <button type="button" class="secondary-button" @click="closeNewProjectDialog">Cancel</button>
          <button type="button" class="primary-button" @click="createProjectFolderDraft">
            <i class="ri-check-line"></i>
            <span>Create</span>
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Project, ProjectStatus } from '../types'
import { useWorkspace } from '../composables/useWorkspace'
import { waitForDesktopApi } from '@/platform/desktop'
import {
  FLOW_STEPS,
  archiveWorkspaceInManifest,
  buildProjectManagementProject,
  createSelectionState,
  createProjectManifestDraft,
  createWorkspaceBranchDraft,
  deleteWorkspaceFromManifest,
  parseWorkspaceFlowStateMap,
  parseProjectManifest,
  serializeProjectManifest,
  type FlowStep,
  type ProjectBranchLink,
  type ProjectManifest,
  type ProjectManagementProject,
  type ProjectMetricPoint,
  type ProjectStepStatus,
  type ProjectWorkspace,
  type ProjectWorkspaceFlowStatesById,
  type WorkspaceBranchDraft,
} from '@/utils/projectManagement'
import { readOptionalProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import {
  loadProjectHistory,
  rememberProjectHistoryEntry,
  removeProjectHistoryEntry,
} from '@/utils/projectHistory'

type BranchDraft = WorkspaceBranchDraft

const router = useRouter()
const {
  openProject,
  showToast,
} = useWorkspace()

const searchQuery = ref('')
const selectedProjectId = ref<string | null>(null)
const selectedWorkspaceId = ref('')
const selectedStep = ref<FlowStep>('DRC')
const branchDraft = ref<BranchDraft | null>(null)
const isDialogMaximized = ref(false)
const projectHistory = ref<Project[]>([])
const projectManifests = ref<Record<string, ProjectManifest>>({})
const workspaceFlowStates = ref<Record<string, ProjectWorkspaceFlowStatesById>>({})
const showNewProjectDialog = ref(false)
const projectRootError = ref('')
const projectRootDraft = ref({
  name: '',
  directory: '',
})

onMounted(async () => {
  projectHistory.value = await loadProjectHistory()
  await refreshProjectManifests()
  if (!selectedProjectId.value) selectedProjectId.value = projectCards.value[0]?.model.id ?? selectedProject.value.id
})

const projectSources = computed<Project[]>(() => projectHistory.value)

const projectCards = computed(() => {
  let projects = [...projectSources.value]
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    projects = projects.filter(project =>
      project.name.toLowerCase().includes(query)
      || project.path.toLowerCase().includes(query)
      || project.topModule?.toLowerCase().includes(query)
      || project.pdk?.toLowerCase().includes(query),
    )
  }

  return projects
    .sort((left, right) => new Date(right.lastOpened).getTime() - new Date(left.lastOpened).getTime())
    .map(project => ({
      source: project,
      model: buildProjectManagementProject(
        project,
        projectManifests.value[project.path] ?? null,
        workspaceFlowStates.value[project.path] ?? {},
      ),
    }))
})

const selectedProject = computed<ProjectManagementProject>(() => {
  const selected = projectCards.value.find(project => project.model.id === selectedProjectId.value)
  return selected?.model ?? projectCards.value[0]?.model ?? buildProjectManagementProject(null)
})

const selectedWorkspace = computed<ProjectWorkspace | null>(() => {
  return selectedProject.value.workspaces.find(workspace => workspace.id === selectedWorkspaceId.value)
    ?? selectedProject.value.workspaces.find(workspace => workspace.id === selectedProject.value.bestWorkspaceId)
    ?? selectedProject.value.workspaces[0]
    ?? null
})

const hasProjectData = computed(() => selectedProject.value.workspaces.length > 0)
const hasMetricsData = computed(() => hasProjectData.value && selectedProject.value.metricsRows.length > 0)
const selectedWorkspaceLabel = computed(() => selectedWorkspace.value?.id ?? 'No workspace')
const selectedWorkspacePathLabel = computed(() => selectedWorkspace.value?.workspacePath ?? 'No workspace')
const selectedProjectManifest = computed(() => projectManifests.value[selectedProject.value.path] ?? null)

const matrixGridStyle = computed(() => ({
  gridTemplateColumns: `150px repeat(${FLOW_STEPS.length}, minmax(54px, 1fr)) 48px`,
}))

const metricsGridStyle = computed(() => ({
  gridTemplateColumns: `94px repeat(${Math.max(selectedProject.value.workspaces.length, 1)}, minmax(74px, 1fr))`,
}))

const projectManifestPreview = computed(() => {
  const root = normalizePath(projectRootDraft.value.directory.trim())
  if (!root) return '<project_root>/project.json'
  return `${root}/project.json`
})

const branchLinkViewBox = computed(() => {
  const height = Math.max(54, selectedProject.value.workspaces.length * 54)
  return `0 0 1120 ${height}`
})

const legendItems = [
  { label: 'success', class: 'legend-success' },
  { label: 'reused', class: 'legend-reused' },
  { label: 'skipped', class: 'legend-skipped' },
  { label: 'unstart', class: 'legend-unstart' },
  { label: 'running', class: 'legend-running' },
  { label: 'failed / count', class: 'legend-failed' },
]

watch(selectedProject, (project) => {
  const selection = createSelectionState(project)
  selectedWorkspaceId.value = selection.selectedWorkspaceId
  selectedStep.value = selection.selectedStep
}, { immediate: true })

watch(projectSources, () => {
  void refreshProjectManifests()
})

function selectProject(projectId: string) {
  selectedProjectId.value = projectId
  branchDraft.value = null
}

function selectWorkspace(workspaceId: string) {
  selectedWorkspaceId.value = workspaceId
  branchDraft.value = null
}

function selectStep(step: FlowStep) {
  selectedStep.value = step
  branchDraft.value = null
}

function toggleDialogMaximized() {
  isDialogMaximized.value = !isDialogMaximized.value
}

function startWorkspaceFromCell(workspaceId: string, step: FlowStep) {
  branchDraft.value = createWorkspaceBranchDraft(selectedProject.value, workspaceId, step)
}

async function openBackendDesign() {
  if (!selectedProject.value.path) return
  await router.push({
    path: '/ecc',
    query: {
      projectRoot: selectedProject.value.path,
      projectName: selectedProject.value.name,
    },
  })
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
      sourceStep: branchDraft.value.step,
      sourceOutputPath: branchDraft.value.sourceOutputPath,
      sourceOutputType: branchDraft.value.sourceOutputType,
      originDef: branchDraft.value.originDef,
      originVerilog: branchDraft.value.originVerilog,
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

async function refreshProjectManifests() {
  const entries = await Promise.all(projectSources.value.map(async (project) => {
    try {
      const projectRoot = await registerProjectRootForProjectManagement(project.path)
      if (!projectRoot) return null
      const manifestText = await readOptionalProjectTextFile('project.json', { projectPath: projectRoot })
      if (!manifestText) return null
      const manifest = parseProjectManifest(manifestText)
      const flowStates = await readWorkspaceFlowStates(manifest)
      return [project.path, manifest, flowStates] as const
    } catch (error) {
      console.warn(`Failed to load project manifest: ${project.path}`, error)
      return null
    }
  }))

  const validEntries = entries.filter(entry => entry !== null)
  projectManifests.value = Object.fromEntries(validEntries.map(([path, manifest]) => [path, manifest]))
  workspaceFlowStates.value = Object.fromEntries(validEntries.map(([path, _manifest, flowStates]) => [path, flowStates]))
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
        detail: 'The selected project folder could not be registered for local file access.',
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
      [project.path]: await readWorkspaceFlowStates(manifest),
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

async function archiveSelectedWorkspace() {
  const workspaceId = selectedWorkspace.value?.id
  if (!workspaceId || !selectedProject.value.path) return
  try {
    const manifest = selectedProjectManifest.value
      ?? await readOrCreateProjectManifest(selectedProject.value.path, selectedProject.value.name)
    const updated = archiveWorkspaceInManifest(manifest, workspaceId)
    await writeSelectedProjectManifest(updated, selectedProject.value.path)
    branchDraft.value = null
  } catch (error) {
    console.warn('Failed to archive selected workspace.', error)
    showToast({
      severity: 'warn',
      summary: 'Workspace not archived',
      detail: 'project.json could not be updated.',
    })
  }
}

async function deleteSelectedWorkspace() {
  const workspaceId = selectedWorkspace.value?.id
  if (!workspaceId || !selectedProject.value.path) return
  try {
    const manifest = selectedProjectManifest.value
      ?? await readOrCreateProjectManifest(selectedProject.value.path, selectedProject.value.name)
    const updated = deleteWorkspaceFromManifest(manifest, workspaceId)
    await writeSelectedProjectManifest(updated, selectedProject.value.path)
    selectedWorkspaceId.value = updated.workspaces[0]?.workspace_id ?? ''
    branchDraft.value = null
  } catch (error) {
    console.warn('Failed to delete selected workspace.', error)
    showToast({
      severity: 'warn',
      summary: 'Workspace not deleted',
      detail: 'project.json could not be updated.',
    })
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
    const manualPath = typeof window !== 'undefined'
      ? window.prompt('Project Storage Location')
      : null
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

  const name = projectRootDraft.value.name.trim() || basenamePath(projectRoot) || 'project'
  const manifest = createProjectManifestDraft({
    rootPath: projectRoot,
    name,
  })
  await writeProjectTextFile('project.json', serializeProjectManifest(manifest), { projectPath: projectRoot })
  const createdProject: Project = {
    id: projectRoot,
    name,
    path: projectRoot,
    lastOpened: new Date(),
    status: 'not_started',
  }

  projectHistory.value = await rememberProjectHistoryEntry(createdProject)
  projectManifests.value = {
    ...projectManifests.value,
    [projectRoot]: manifest,
  }
  workspaceFlowStates.value = {
    ...workspaceFlowStates.value,
    [projectRoot]: {},
  }
  selectedProjectId.value = createdProject.id
  closeNewProjectDialog()
}

const goBack = () => router.push('/')

function statusBadgeClass(status?: ProjectStatus): string {
  if (!status) return 'status-neutral'
  const map: Record<ProjectStatus, string> = {
    success: 'status-success',
    failed: 'status-failed',
    running: 'status-running',
    in_progress: 'status-progress',
    not_started: 'status-neutral',
  }
  return map[status]
}

function statusLabel(status?: ProjectStatus): string {
  if (!status) return 'Not Started'
  const map: Record<ProjectStatus, string> = {
    success: 'Success',
    failed: 'Failed',
    running: 'Running',
    in_progress: 'In Progress',
    not_started: 'Not Started',
  }
  return map[status]
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

function metricValueClass(state: ProjectMetricPoint['state']): string {
  const map: Record<ProjectMetricPoint['state'], string> = {
    good: 'metric-good',
    warn: 'metric-warn',
    bad: 'metric-bad',
    pending: 'metric-pending',
  }
  return map[state]
}

function metricInlineWidth(point: ProjectMetricPoint): number {
  if (point.value === null) return 28
  return Math.max(8, Math.min(100, Math.abs(point.value) * 12))
}

function signedDelta(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function branchLinkPath(link: ProjectBranchLink): string {
  const fromRowIndex = selectedProject.value.workspaces.findIndex(workspace => workspace.id === link.fromWorkspaceId)
  const toRowIndex = selectedProject.value.workspaces.findIndex(workspace => workspace.id === link.toWorkspaceId)
  const fromStepIndex = FLOW_STEPS.indexOf(link.fromStep)
  const toStepIndex = FLOW_STEPS.indexOf(link.toStep)
  if (fromRowIndex < 0 || toRowIndex < 0 || fromStepIndex < 0 || toStepIndex < 0) return ''

  const fromX = 170 + fromStepIndex * 72 + 36
  const toX = 170 + toStepIndex * 72 + 36
  const fromY = 27 + fromRowIndex * 54
  const toY = 27 + toRowIndex * 54
  const bend = Math.max(70, Math.abs(toX - fromX) * 0.4)
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

async function loadProjectFromRoot(projectRoot: string): Promise<Project> {
  const root = normalizePath(projectRoot)
  const manifest = await readProjectManifest(root)
  return projectFromManifest(manifest, root)
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

async function readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  const manifestText = await readOptionalProjectTextFile('project.json', { projectPath: projectRoot })
  if (!manifestText) throw new Error('Project manifest does not exist.')
  return parseProjectManifest(manifestText)
}

async function readWorkspaceFlowStates(manifest: ProjectManifest): Promise<ProjectWorkspaceFlowStatesById> {
  const entries = await Promise.all(manifest.workspaces.map(async (workspace) => {
    try {
      const flowText = await readOptionalProjectTextFile('home/flow.json', { projectPath: workspace.workspace_path })
      return [
        workspace.workspace_id,
        flowText ? parseWorkspaceFlowStateMap(flowText) : {},
      ] as const
    } catch (error) {
      console.warn(`Failed to load workspace flow.json: ${workspace.workspace_path}`, error)
      return [workspace.workspace_id, {}] as const
    }
  }))

  return Object.fromEntries(entries)
}

async function readOrCreateProjectManifest(projectRoot: string, projectName: string): Promise<ProjectManifest> {
  const manifestText = await readOptionalProjectTextFile('project.json', { projectPath: projectRoot })
  if (manifestText) return parseProjectManifest(manifestText)
  return createProjectManifestDraft({
    rootPath: projectRoot,
    name: projectName || basenamePath(projectRoot) || 'project',
  })
}

async function writeSelectedProjectManifest(manifest: ProjectManifest, projectRoot: string) {
  const registeredProjectRoot = await registerProjectRootForProjectManagement(projectRoot)
  if (!registeredProjectRoot) throw new Error('Project root could not be registered.')

  await writeProjectTextFile('project.json', serializeProjectManifest(manifest), { projectPath: registeredProjectRoot })
  const normalizedRoot = normalizePath(registeredProjectRoot)
  projectManifests.value = {
    ...projectManifests.value,
    [selectedProject.value.path]: manifest,
    [normalizedRoot]: manifest,
  }
  workspaceFlowStates.value = {
    ...workspaceFlowStates.value,
    [selectedProject.value.path]: workspaceFlowStates.value[selectedProject.value.path] ?? {},
    [normalizedRoot]: workspaceFlowStates.value[normalizedRoot] ?? {},
  }
  projectHistory.value = projectHistory.value.map(project =>
    project.path === selectedProject.value.path || project.path === normalizedRoot
      ? {
          ...project,
          pdk: manifest.base_design.pdk,
          topModule: manifest.base_design.top_module,
          status: projectStatusFromManifest(manifest),
          lastOpened: new Date(),
        }
      : project,
  )
}

function workspaceRouteQuery(workspacePath?: string, workspaceId?: string) {
  return {
    projectRoot: selectedProject.value.path,
    projectName: selectedProject.value.name,
    workspaceId: workspaceId || basenamePath(workspacePath ?? '') || selectedWorkspace.value?.id || '',
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
  if (manifest.workspaces.some(workspace => workspace.status === 'running')) return 'running'
  if (manifest.workspaces.some(workspace => workspace.status === 'failed')) return 'failed'
  if (manifest.workspaces.some(workspace => workspace.status === 'in_progress')) return 'in_progress'
  if (manifest.workspaces.length > 0 && manifest.workspaces.every(workspace => workspace.status === 'success')) return 'success'
  return manifest.workspaces.length > 0 ? 'in_progress' : 'not_started'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function basenamePath(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? ''
}
</script>

<style scoped>
.resource-manager-view {
  --success-color: #2f9f6f;
  --success-bg: color-mix(in srgb, var(--success-color) 14%, transparent);
  --info-color: var(--accent-color);
  --info-bg: color-mix(in srgb, var(--info-color) 14%, transparent);
  --warn-color: #d99a2b;
  --warn-bg: color-mix(in srgb, var(--warn-color) 14%, transparent);
  --danger-color: #d85d5d;
  --danger-bg: color-mix(in srgb, var(--danger-color) 14%, transparent);
  --dialog-inline-gutter: clamp(16px, 3vw, 48px);
  --dialog-block-gutter: clamp(16px, 4vh, 36px);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-secondary);
  isolation: isolate;
}

.blurred-home {
  position: absolute;
  inset: 0;
  overflow: hidden;
  filter: blur(1.5px) brightness(0.82);
  transform: translateZ(0) scale(1.006);
  background:
    radial-gradient(circle at 50% 16%, color-mix(in srgb, var(--accent-color) 12%, transparent), transparent 28%),
    linear-gradient(color-mix(in srgb, var(--border-color) 50%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 50%, transparent) 1px, transparent 1px),
    var(--bg-secondary);
  background-size: auto, 52px 52px, 52px 52px, auto;
}

.blurred-brand {
  position: absolute;
  top: 58px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 24px;
  transform: translateX(-50%);
  font-size: 36px;
  font-weight: 800;
}

.blurred-brand i {
  color: var(--accent-color);
  font-size: 56px;
}

.blurred-cards {
  position: absolute;
  top: 290px;
  left: 10%;
  right: 10%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.blurred-card,
.blurred-lines div {
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: 0 24px 90px rgba(15, 23, 42, 0.06);
}

.blurred-card {
  height: 170px;
  border-radius: 16px;
}

.blurred-card.is-active {
  border-color: color-mix(in srgb, var(--accent-color) 28%, transparent);
}

.blurred-lines {
  position: absolute;
  top: 570px;
  left: 10%;
  right: 10%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 32px;
}

.blurred-lines div {
  height: 58px;
  border-radius: 12px;
}

.manager-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(17, 24, 39, 0.32);
}

.manager-dialog {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: min(1520px, calc(100% - var(--dialog-inline-gutter)));
  height: min(920px, calc(100% - var(--dialog-block-gutter)));
  min-height: min(600px, calc(100% - var(--dialog-block-gutter)));
  padding: clamp(22px, 3vh, 32px) clamp(22px, 2.8vw, 34px) clamp(22px, 3vh, 34px);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
  box-shadow: 0 34px 90px rgba(15, 23, 42, 0.24);
  transition: width 0.18s ease, height 0.18s ease, border-radius 0.18s ease;
}

.manager-dialog.maximized {
  width: calc(100% - 16px);
  height: calc(100% - 16px);
  min-height: 0;
  border-radius: 10px;
}

.manager-window-controls {
  position: absolute;
  top: 28px;
  right: 28px;
  z-index: 4;
  display: inline-flex;
  gap: 6px;
}

.manager-window-button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.manager-window-button:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

.manager-close {
  position: absolute;
  top: 34px;
  right: 34px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.manager-close:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

.manager-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-right: 82px;
  margin-bottom: 18px;
}

.manager-eyebrow {
  margin: 0 0 4px;
  color: var(--accent-color);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.manager-header h1,
.manager-toolbar h2,
.selected-section h2,
.project-modal-dialog h2 {
  margin: 0;
  color: var(--text-primary);
  font-weight: 750;
  letter-spacing: 0;
}

.manager-header h1 {
  font-size: 22px;
}

.manager-header p,
.manager-toolbar p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.manager-header-actions,
.modal-actions,
.axis-chips {
  display: flex;
  align-items: center;
  gap: 10px;
}

.manager-grid {
  display: grid;
  grid-template-columns: minmax(230px, 270px) minmax(620px, 1fr) minmax(230px, 260px);
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

.manager-sidebar,
.manager-table-panel,
.selected-panel {
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.manager-sidebar,
.selected-panel {
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.sidebar-stack {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
}

.resource-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
}

.resource-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  background: transparent;
  font-size: 12px;
}

.form-field input {
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
  outline: 0;
}

.project-list {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.resource-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto 26px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 54px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 64%, transparent);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.resource-row:hover,
.resource-row.selected {
  border-color: color-mix(in srgb, var(--accent-color) 56%, transparent);
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
}

.row-remove-btn {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  opacity: 0.68;
  transition: color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.row-remove-btn:hover {
  color: var(--danger-color);
  background: var(--danger-bg);
  opacity: 1;
}

.resource-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.resource-copy {
  min-width: 0;
}

.resource-copy strong,
.resource-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-copy strong {
  font-size: 13px;
}

.resource-copy small {
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 11px;
}

.status-pill {
  border-radius: 999px;
  padding: 3px 7px;
  font-size: 10px;
  font-weight: 750;
  white-space: nowrap;
}

.status-success { color: var(--success-color); background: var(--success-bg); }
.status-failed { color: var(--danger-color); background: var(--danger-bg); }
.status-running { color: var(--info-color); background: var(--info-bg); }
.status-progress { color: var(--warn-color); background: var(--warn-bg); }
.status-neutral { color: var(--text-secondary); background: color-mix(in srgb, var(--text-secondary) 12%, transparent); }

.manager-table-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.manager-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.toolbar-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.manager-toolbar h2 {
  font-size: 18px;
}

.project-workbench {
  display: grid;
  grid-template-rows: minmax(280px, 3fr) minmax(190px, 2fr);
  gap: 12px;
  min-height: 0;
  flex: 1 1 auto;
}

.metrics-panel,
.flow-panel {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
}

.metrics-panel {
  display: flex;
  flex-direction: column;
  padding: 14px;
}

.flow-panel {
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.panel-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.panel-title-row.compact {
  margin-bottom: 8px;
}

.panel-title-row h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 760;
}

.panel-title-row p {
  margin: 3px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.axis-chip {
  border-radius: 999px;
  padding: 5px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.axis-chip.workspace {
  color: var(--info-color);
  background: var(--info-bg);
}

.axis-chip.step {
  color: var(--success-color);
  background: var(--success-bg);
}

.metrics-board {
  display: grid;
  grid-auto-rows: minmax(48px, 1fr);
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 42%, transparent);
}

.metrics-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
}

.metrics-empty-state,
.flow-empty-state {
  display: grid;
  min-height: 0;
  place-items: center;
  align-content: center;
  gap: 6px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 34%, transparent);
  text-align: center;
}

.metrics-empty-state {
  flex: 1 1 auto;
}

.comparison-summary {
  display: grid;
  grid-template-columns: minmax(120px, 0.7fr) minmax(0, 2.3fr);
  gap: 10px;
  min-height: 86px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 34%, transparent);
}

.summary-best,
.comparison-grid > div {
  min-width: 0;
}

.summary-best {
  display: grid;
  align-content: center;
  gap: 4px;
  padding-right: 10px;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
}

.summary-best strong,
.comparison-grid h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 760;
}

.summary-best span,
.comparison-grid p {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
}

.flow-empty-state {
  grid-column: 1 / -1;
  min-height: 132px;
  margin-top: 8px;
}

.metrics-empty-state i,
.flow-empty-state i {
  color: var(--accent-color);
  font-size: 22px;
}

.metrics-empty-state strong,
.flow-empty-state strong {
  color: var(--text-primary);
  font-size: 13px;
}

.metrics-empty-state span,
.flow-empty-state span {
  max-width: 320px;
  font-size: 12px;
}

.metric-corner,
.metric-workspace,
.metric-label,
.metric-point {
  min-width: 0;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
}

.metric-corner,
.metric-workspace {
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 750;
}

.metric-workspace {
  cursor: pointer;
}

.metric-workspace.selected,
.metric-point.selected {
  background: color-mix(in srgb, var(--accent-color) 9%, transparent);
}

.metric-label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 8px 10px;
}

.metric-label strong {
  font-size: 13px;
}

.metric-label small {
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 10px;
}

.metric-point {
  display: grid;
  align-content: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
}

.metric-point span {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
}

.metric-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary) 14%, transparent);
}

.metric-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: currentColor;
}

.metric-good { color: var(--success-color); }
.metric-warn { color: var(--warn-color); }
.metric-bad { color: var(--danger-color); }
.metric-pending { color: var(--text-secondary); }

.legend-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px 12px;
  color: var(--text-secondary);
  font-size: 11px;
}

.legend-list span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-list i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

.legend-success { background: var(--success-color); }
.legend-reused { background: #7a8798; }
.legend-skipped { background: #303846; }
.legend-unstart { background: #596679; }
.legend-running { background: var(--info-color); }
.legend-failed { background: var(--danger-color); }

.flow-scroll {
  min-height: 0;
  overflow: auto;
  flex: 1 1 auto;
}

.flow-matrix {
  display: grid;
  min-width: 1060px;
  gap: 0;
}

.flow-header {
  display: grid;
  min-height: 28px;
  place-items: center;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 38%, transparent);
  font-size: 11px;
  font-weight: 750;
}

.workspace-header {
  justify-items: start;
  padding-left: 10px;
}

.step-header {
  border: 0;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.step-header.selected {
  color: var(--success-color);
  background: var(--success-bg);
}

.open-header {
  font-size: 0;
}

.open-header::after {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary) 50%, transparent);
}

.flow-rows {
  position: relative;
  display: grid;
  grid-column: 1 / -1;
  gap: 6px;
  padding-top: 8px;
}

.flow-link-layer {
  position: absolute;
  inset: 8px 0 0;
  width: 100%;
  height: calc(100% - 8px);
  pointer-events: none;
  z-index: 1;
}

.branch-link {
  fill: none;
  stroke: color-mix(in srgb, var(--accent-color) 72%, white 8%);
  stroke-width: 2.3;
  stroke-linecap: round;
  stroke-linejoin: round;
  marker-end: url(#branch-arrow);
  opacity: 0.7;
}

#branch-arrow path {
  fill: color-mix(in srgb, var(--accent-color) 72%, white 8%);
}

.flow-row {
  position: relative;
  z-index: 2;
  display: grid;
  align-items: center;
  min-height: 48px;
  border: 1px solid color-mix(in srgb, var(--border-color) 85%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.flow-row.selected {
  border-color: color-mix(in srgb, var(--accent-color) 60%, transparent);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
}

.workspace-cell {
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 0 10px;
  border: 0;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.workspace-cell strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.workspace-cell small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-cell-wrap {
  position: relative;
  display: grid;
  place-items: center;
}

.flow-cell-wrap.selected::before {
  position: absolute;
  inset: -6px 4px;
  border: 1px solid color-mix(in srgb, var(--success-color) 58%, transparent);
  border-radius: 8px;
  content: "";
  pointer-events: none;
}

.flow-cell {
  display: grid;
  width: 34px;
  height: 28px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.flow-cell:hover {
  transform: translateY(-1px);
}

.step-success { color: var(--success-color); background: var(--success-bg); }
.step-reused { color: #7a8798; background: color-mix(in srgb, #7a8798 16%, transparent); }
.step-skipped { color: color-mix(in srgb, var(--text-secondary) 60%, transparent); background: color-mix(in srgb, var(--bg-secondary) 58%, transparent); }
.step-unstart { color: #596679; background: color-mix(in srgb, #596679 14%, transparent); }
.step-running { color: var(--info-color); background: var(--info-bg); }
.step-failed { color: var(--danger-color); background: var(--danger-bg); }

.cell-add-button {
  position: absolute;
  top: -8px;
  right: 2px;
  display: grid;
  width: 19px;
  height: 19px;
  place-items: center;
  border: 2px solid color-mix(in srgb, var(--bg-primary) 92%, transparent);
  border-radius: 999px;
  color: white;
  background: var(--accent-color);
  cursor: pointer;
  font-size: 13px;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.24);
}

.row-action-btn,
.icon-button {
  display: grid;
  place-items: center;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 84%, transparent);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.row-action-btn {
  width: 30px;
  height: 30px;
  justify-self: center;
}

.icon-button {
  width: 34px;
  height: 34px;
}

.row-action-btn:hover,
.icon-button:hover {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 58%, transparent);
  background: color-mix(in srgb, var(--accent-color) 9%, transparent);
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 13px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 750;
}

.primary-button {
  border: 1px solid color-mix(in srgb, var(--accent-color) 70%, transparent);
  color: white;
  background: var(--accent-color);
}

.primary-button.full {
  width: 100%;
  margin-top: 12px;
}

.secondary-button {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
}

.secondary-button:hover {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 56%, transparent);
}

.secondary-button.danger:hover {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 56%, transparent);
  background: var(--danger-bg);
}

.secondary-button:disabled,
.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.selected-panel {
  gap: 12px;
  overflow-y: auto;
}

.selected-section {
  padding: 13px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.selected-section h2 {
  margin-bottom: 10px;
  font-size: 13px;
}

.selected-section dl {
  display: grid;
  gap: 10px;
  margin: 0;
}

.selected-section dl div {
  min-width: 0;
}

.selected-section dt {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 750;
  text-transform: uppercase;
}

.selected-section dd,
.selected-section p,
.selected-section code {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 12px;
}

.selected-section code {
  display: block;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--bg-secondary) 44%, transparent);
}

.side-note {
  color: var(--text-secondary) !important;
}

.action-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.branch-draft-card {
  border-color: color-mix(in srgb, var(--accent-color) 50%, transparent);
  background: color-mix(in srgb, var(--accent-color) 9%, var(--bg-primary));
}

.empty-state {
  padding: 18px 10px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.project-modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.48);
}

.project-modal-dialog {
  position: relative;
  display: grid;
  width: min(520px, calc(100vw - 36px));
  gap: 16px;
  padding: 24px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-primary) 98%, transparent);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.32);
}

.modal-close {
  top: 18px;
  right: 18px;
}

.project-modal-dialog h2 {
  font-size: 20px;
}

.form-field {
  display: grid;
  gap: 7px;
}

.form-field span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 750;
}

.form-field input {
  height: 36px;
  padding: 0 11px;
  font-size: 13px;
}

.path-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.path-picker button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.modal-help,
.modal-error {
  margin: 0;
  font-size: 12px;
}

.modal-help {
  color: var(--text-secondary);
}

.modal-error {
  color: var(--danger-color);
}

.modal-actions {
  justify-content: flex-end;
}

@media (max-width: 1180px) {
  .manager-grid {
    grid-template-columns: minmax(220px, 250px) minmax(560px, 1fr);
  }

  .selected-panel {
    display: none;
  }
}

@media (max-width: 900px) {
  .manager-dialog {
    width: calc(100% - 18px);
    height: calc(100% - 18px);
    padding: 18px;
  }

  .manager-grid {
    grid-template-columns: 1fr;
  }

  .manager-sidebar {
    display: none;
  }

  .manager-header {
    flex-direction: column;
  }
}
</style>
