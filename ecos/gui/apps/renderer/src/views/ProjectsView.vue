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

            <div class="project-list" aria-label="Project list">
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
                      title="Delete project"
                      :aria-label="`Delete project ${project.model.name}`"
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
            <section
              class="analysis-panel mockup-analysis-panel"
              aria-labelledby="project-analysis-title"
            >
              <div class="panel-title-row analysis-heading">
                <div>
                  <h3 id="project-analysis-title">Project Analysis</h3>
                  <p>
                    {{ selectedProject.workspaces.length }} workspaces ·
                    {{ selectedStep }} comparison
                  </p>
                </div>
                <div class="analysis-header-actions">
                  <div
                    class="analysis-tabs"
                    role="tablist"
                    aria-label="Project analysis pages"
                  >
                    <button
                      type="button"
                      role="tab"
                      :aria-selected="selectedAnalysisTab === 'dashboard'"
                      :class="{ selected: selectedAnalysisTab === 'dashboard' }"
                      @click="selectedAnalysisTab = 'dashboard'"
                    >
                      Dashboard
                    </button>
                    <button
                      type="button"
                      role="tab"
                      :aria-selected="selectedAnalysisTab === 'step'"
                      :class="{ selected: selectedAnalysisTab === 'step' }"
                      @click="openStepAnalysis"
                    >
                      Step Analysis
                    </button>
                  </div>
                </div>
              </div>

              <div
                v-if="hasProjectData && selectedAnalysisTab === 'dashboard'"
                class="dashboard-grid"
              >
                <section class="dashboard-card dashboard-run-state-card">
                  <span>Workspace Run State</span>
                  <div class="run-state-layout">
                    <div
                      class="run-state-pie"
                      :style="{ background: runStatePieBackground }"
                      aria-hidden="true"
                    ></div>
                    <div class="run-state-copy">
                      <div class="dashboard-stat-row">
                        <strong>{{
                          selectedProject.dashboardSummary.workspaceCount
                        }}</strong>
                        <small>workspaces</small>
                      </div>
                      <div
                        class="run-state-legend"
                        aria-label="Workspace run state pie legend"
                      >
                        <span
                          v-for="slice in selectedProject.dashboardSummary.runStateSlices"
                          :key="slice.state"
                        >
                          <i :class="runStateSliceClass(slice.state)"></i>
                          {{ slice.label }} {{ slice.count }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="dashboard-pill-row">
                    <span class="dashboard-pill success"
                      >{{ selectedProject.dashboardSummary.drcCleanCount }} DRC
                      clean</span
                    >
                    <span class="dashboard-pill success"
                      >{{ selectedProject.dashboardSummary.timingCleanCount }} timing
                      clean</span
                    >
                    <span class="dashboard-pill info"
                      >{{ selectedProject.dashboardSummary.signoffReadyCount }} signoff
                      ready</span
                    >
                  </div>
                </section>

                <section class="dashboard-card dashboard-best-card">
                  <header>
                    <span>Best</span>
                    <small>frequency best workspace PPA</small>
                  </header>
                  <div class="best-workspace-summary">
                    <div>
                      <span>Best Frequency Workspace</span>
                      <strong>{{ bestFrequencyWorkspace?.workspaceId ?? 'N/A' }}</strong>
                    </div>
                    <span class="dashboard-pill success"
                      >{{ selectedProject.dashboardSummary.drcCleanCount }} DRC
                      clean</span
                    >
                  </div>
                  <div v-if="bestWorkspacePpaMetrics.length > 0" class="best-ppa-grid">
                    <div
                      v-for="metric in bestWorkspacePpaMetrics"
                      :key="metric.id"
                      class="best-ppa-item"
                    >
                      <span>{{ metric.label }}</span>
                      <strong :class="metricValueClass(metric.state)">{{
                        metric.display
                      }}</strong>
                    </div>
                  </div>
                  <div v-else class="dashboard-empty-note">
                    No frequency data available.
                  </div>
                </section>

                <section
                  class="dashboard-card dashboard-chart-card dashboard-key-metric-card"
                >
                  <header>
                    <span>Key Metric Snapshot</span>
                    <small>workspace comparison table</small>
                  </header>
                  <div
                    class="dashboard-key-metric-table"
                    :style="{
                      '--dashboard-metric-count': String(dashboardMetricRows.length),
                    }"
                    aria-label="Key metrics include Die Area, Core Util, Frequency [MHz], WNS, TNS, DRC, Runtime, Memory"
                  >
                    <div class="dashboard-key-header dashboard-key-workspace-header">
                      Workspace
                    </div>
                    <div
                      v-for="metric in dashboardMetricRows"
                      :key="metric.id"
                      class="dashboard-key-header"
                    >
                      {{ metric.label }}
                    </div>
                    <template
                      v-for="row in dashboardWorkspaceMetricRows"
                      :key="row.workspaceId"
                    >
                      <button
                        type="button"
                        class="dashboard-key-workspace-cell"
                        :class="{ selected: row.workspaceId === selectedWorkspaceId }"
                        @click="selectWorkspace(row.workspaceId)"
                      >
                        {{ row.workspaceId }}
                      </button>
                      <button
                        v-for="cell in row.cells"
                        :key="`${row.workspaceId}-${cell.metric.id}`"
                        type="button"
                        class="dashboard-key-metric-cell"
                        :class="metricValueClass(cell.point.state)"
                        :title="`${row.workspaceId} ${cell.metric.label}: ${cell.point.label}`"
                        @click="selectWorkspace(row.workspaceId)"
                      >
                        <strong>{{ cell.point.label }}</strong>
                        <span class="metric-track">
                          <i
                            :style="{
                              width: `${metricInlineWidth(cell.point, cell.metric.points)}%`,
                            }"
                          ></i>
                        </span>
                      </button>
                    </template>
                  </div>
                </section>
              </div>

              <div v-else-if="hasProjectData" class="step-analysis-view">
                <div class="step-selector" aria-label="Flow step selector">
                  <button
                    v-for="step in FLOW_STEPS"
                    :key="step"
                    type="button"
                    :class="{ selected: step === selectedStep }"
                    @click="selectStep(step)"
                  >
                    {{ step }}
                  </button>
                </div>

                <div class="analysis-grid">
                  <div class="step-compare-overview">
                    <div>
                      <span>Configured</span>
                      <strong>{{
                        selectedStepCompareSummary?.configuredCount ?? 0
                      }}</strong>
                    </div>
                    <div>
                      <span>Success</span>
                      <strong>{{ selectedStepCompareSummary?.successCount ?? 0 }}</strong>
                    </div>
                    <div>
                      <span>Missing</span>
                      <strong>{{ selectedStepCompareSummary?.missingCount ?? 0 }}</strong>
                    </div>
                  </div>

                  <div
                    class="step-compare-metric-table"
                    :style="{
                      '--step-compare-metric-count': String(
                        selectedStepCompareMetrics.length,
                      ),
                    }"
                    aria-label="Selected step metrics by workspace"
                  >
                    <div class="step-compare-header step-compare-workspace-header">
                      Workspace
                    </div>
                    <div
                      v-for="metric in selectedStepCompareMetrics"
                      :key="metric.id"
                      class="step-compare-header"
                      :title="metric.hint"
                    >
                      {{ metric.label }}
                    </div>
                    <template
                      v-for="row in selectedStepWorkspaceMetricRows"
                      :key="row.workspaceId"
                    >
                      <button
                        type="button"
                        class="step-compare-workspace-cell"
                        :class="{ selected: row.workspaceId === selectedWorkspaceId }"
                        @click="selectWorkspace(row.workspaceId)"
                      >
                        {{ row.workspaceId }}
                      </button>
                      <button
                        v-for="cell in row.cells"
                        :key="`${row.workspaceId}-${cell.metric.id}`"
                        type="button"
                        class="step-compare-metric-cell"
                        :class="metricValueClass(cell.point.state)"
                        :title="`${row.workspaceId} ${cell.metric.label}: ${cell.point.label}`"
                        @click="selectWorkspace(row.workspaceId)"
                      >
                        <strong>{{ cell.point.label }}</strong>
                        <span class="metric-track">
                          <i
                            :style="{
                              width: `${metricInlineWidth(cell.point, cell.metric.points)}%`,
                            }"
                          ></i>
                        </span>
                      </button>
                    </template>
                  </div>
                </div>
              </div>

              <div v-else class="metrics-empty-state">
                <i class="ri-line-chart-line"></i>
                <strong>No project data available</strong>
                <span
                  >Build or import a project manifest to populate project analysis.</span
                >
              </div>
            </section>
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
          Remove {{ pendingDeleteWorkspaceId }} from project.json? Keep workspace data is
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
        aria-labelledby="delete-project-title"
      >
        <button
          type="button"
          class="manager-close modal-close"
          aria-label="Close delete project dialog"
          @click="closeDeleteProjectDialog"
        >
          <i class="ri-close-line"></i>
        </button>
        <header>
          <p class="manager-eyebrow">Confirm delete</p>
          <h2 id="delete-project-title">Delete Project</h2>
        </header>
        <p class="modal-help">
          Remove {{ pendingDeleteProject.name }} from Project Management? This will not
          delete the project directory.
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
            <i class="ri-delete-bin-line"></i>
            <span>Delete</span>
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
import { waitForDesktopApi } from '@/platform/desktop'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createSelectionState,
  createProjectManifestDraft,
  createWorkspaceBranchDraft,
  deleteWorkspaceFromManifest,
  nextWorkspaceId,
  parseWorkspaceFlowStateMap,
  parseProjectManifest,
  registerWorkspaceInManifest,
  serializeProjectManifest,
  type FlowStep,
  type ProjectFlowStatusHint,
  type ProjectFeatureFileKey,
  type ProjectManifest,
  type ProjectManagementProject,
  type ProjectMetricRow,
  type ProjectMetricPoint,
  type ProjectRunStateSlice,
  type ProjectStepCompareMetric,
  type ProjectStepStatus,
  type ProjectWorkspace,
  type ProjectWorkspaceAnalysisInput,
  type ProjectWorkspaceAnalysisInputsById,
  type ProjectWorkspaceFlowStatesById,
  type WorkspaceBranchDraft,
} from '@/utils/projectManagement'
import {
  readOptionalProjectTextFile,
  removeProjectDirectory,
  writeProjectTextFile,
} from '@/utils/projectFiles'
import {
  loadProjectHistory,
  rememberProjectHistoryEntry,
  removeProjectHistoryEntry,
} from '@/utils/projectHistory'

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

const hasProjectData = computed(() => selectedProject.value.workspaces.length > 0)
const selectedProjectManifest = computed(
  () => projectManifests.value[selectedProject.value.path] ?? null,
)
const selectedStepCompareSummary = computed(() => {
  return (
    selectedProject.value.stepCompareSummaries.find(
      (summary) => summary.step === selectedStep.value,
    ) ??
    selectedProject.value.stepCompareSummaries[0] ??
    null
  )
})
const selectedStepCompareMetrics = computed<ProjectStepCompareMetric[]>(
  () => selectedStepCompareSummary.value?.metrics ?? [],
)
const selectedStepWorkspaceMetricRows = computed(() => {
  return selectedProject.value.workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    cells: selectedStepCompareMetrics.value.map((metric) => ({
      metric,
      point:
        metric.points.find((point) => point.workspaceId === workspace.id) ??
        pendingMetricPoint(workspace.id),
    })),
  }))
})
const dashboardMetricRows = computed<ProjectMetricRow[]>(() => {
  const metricOrder = ['die_area', 'core_util', 'frequency', 'wns', 'tns', 'drc']
  const chipMetricRows = metricOrder.flatMap(
    (metricId) =>
      selectedProject.value.metricsRows.find((metric) => metric.id === metricId) ?? [],
  )
  return [
    ...chipMetricRows,
    {
      id: 'runtime',
      label: 'Runtime',
      hint: 'workspace flow total runtime',
      kind: 'bar',
      points: selectedProject.value.dashboardSummary.flowMetricSummary.runtimePoints,
    },
    {
      id: 'memory',
      label: 'Memory',
      hint: 'workspace flow peak memory',
      kind: 'bar',
      points: selectedProject.value.dashboardSummary.flowMetricSummary.memoryPoints,
    },
  ]
})
const dashboardWorkspaceMetricRows = computed(() => {
  return selectedProject.value.workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    cells: dashboardMetricRows.value.map((metric) => ({
      metric,
      point:
        metric.points.find((point) => point.workspaceId === workspace.id) ??
        pendingMetricPoint(workspace.id),
    })),
  }))
})
const bestFrequencyWorkspace = computed<ProjectMetricPoint | null>(() => {
  const frequency = dashboardMetricRows.value.find((metric) => metric.id === 'frequency')
  return (
    frequency?.points
      .filter(
        (point): point is ProjectMetricPoint & { value: number } => point.value !== null,
      )
      .sort((left, right) => right.value - left.value)[0] ?? null
  )
})
const bestWorkspacePpaMetrics = computed(() => {
  const workspaceId = bestFrequencyWorkspace.value?.workspaceId
  if (!workspaceId) return []
  const metricIds = ['frequency', 'wns', 'tns', 'drc', 'die_area', 'core_util']
  return metricIds.flatMap((metricId) => {
    const metric = dashboardMetricRows.value.find((row) => row.id === metricId)
    const point = metric?.points.find((item) => item.workspaceId === workspaceId)
    if (!metric || !point) return []
    return [
      {
        id: metric.id,
        label: metric.label,
        display: point.label,
        state: point.state,
      },
    ]
  })
})
const runStatePieBackground = computed(() =>
  buildRunStatePieBackground(selectedProject.value.dashboardSummary.runStateSlices),
)

const projectManifestPreview = computed(() => {
  const root = normalizePath(projectRootDraft.value.directory.trim())
  if (!root) return '<project_root>/project.json'
  return `${root}/project.json`
})

const WORKSPACE_ANALYSIS_FILE_SPECS: Array<{ key: ProjectFeatureFileKey; path: string }> =
  [
    { key: 'synthesisStat', path: 'Synthesis_yosys/feature/Synthesis_stat.json' },
    { key: 'floorplanDb', path: 'Floorplan_ecc/feature/Floorplan.db.json' },
    { key: 'fanoutDb', path: 'fixFanout_ecc/feature/fixFanout.db.json' },
    { key: 'fanoutStep', path: 'fixFanout_ecc/feature/fixFanout.step.json' },
    { key: 'placeDb', path: 'place_dreamplace/feature/place.db.json' },
    { key: 'placeMap', path: 'place_dreamplace/feature/place.map.json' },
    { key: 'ctsDb', path: 'CTS_ecc/feature/CTS.db.json' },
    { key: 'ctsStep', path: 'CTS_ecc/feature/CTS.step.json' },
    { key: 'ctsMap', path: 'CTS_ecc/feature/CTS.map.json' },
    { key: 'legalDb', path: 'legalization_dreamplace/feature/legalization.db.json' },
    { key: 'routeDb', path: 'route_ecc/feature/route.db.json' },
    { key: 'routeStep', path: 'route_ecc/feature/route.step.json' },
    { key: 'drcDb', path: 'drc_ecc/feature/drc.db.json' },
    { key: 'drcStep', path: 'drc_ecc/feature/drc.step.json' },
    { key: 'fillerDb', path: 'filler_ecc/feature/filler.db.json' },
    { key: 'fillerStep', path: 'filler_ecc/feature/filler.step.json' },
    { key: 'rcxDb', path: 'RCX_ecc/feature/RCX.db.json' },
    { key: 'staDb', path: 'sta_ecc/feature/sta.db.json' },
  ]

const WORKSPACE_STEP_METRICS_FILE_SPECS: Array<{ step: FlowStep; path: string }> = [
  { step: 'Synth', path: 'Synthesis_yosys/analysis/Synthesis_metrics.json' },
  { step: 'Floor', path: 'Floorplan_ecc/analysis/Floorplan_metrics.json' },
  { step: 'Fanout', path: 'fixFanout_ecc/analysis/fixFanout_metrics.json' },
  { step: 'Place', path: 'place_dreamplace/analysis/place_metrics.json' },
  { step: 'CTS', path: 'CTS_ecc/analysis/CTS_metrics.json' },
  { step: 'Legal', path: 'legalization_dreamplace/analysis/legalization_metrics.json' },
  { step: 'Route', path: 'route_ecc/analysis/route_metrics.json' },
  { step: 'DRC', path: 'drc_ecc/analysis/drc_metrics.json' },
  { step: 'Filler', path: 'filler_ecc/analysis/filler_metrics.json' },
  { step: 'RCX', path: 'RCX_ecc/analysis/RCX_metrics.json' },
  { step: 'STA', path: 'sta_ecc/analysis/sta_metrics.json' },
  { step: 'Harden', path: 'Harden_ecc/analysis/Harden_metrics.json' },
]

const STA_CORNER_PATHS = [
  'MAX_125/Cworst',
  'MAX_125/RCworst',
  'TYP_25/TYPICAL',
  'ML_125/Cworst',
  'ML_125/RCworst',
  'ML_125/Cbest',
  'ML_125/RCbest',
  'MIN_m40/Cworst',
  'MIN_m40/RCworst',
  'MIN_m40/Cbest',
  'MIN_m40/RCbest',
  'WCL_m40/Cworst',
  'WCL_m40/RCworst',
]

watch(
  selectedProject,
  (project) => {
    const selection = createSelectionState(project)
    selectedWorkspaceId.value = selection.selectedWorkspaceId
    selectedStep.value = selection.selectedStep
    hasOpenedStepAnalysis.value = false
    popoverWorkspaceId.value = ''
    branchDraft.value = null
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

function toggleDialogMaximized() {
  isDialogMaximized.value = !isDialogMaximized.value
}

function startWorkspaceFromCell(workspaceId: string, step: FlowStep) {
  branchDraft.value = createWorkspaceBranchDraft(selectedProject.value, workspaceId, step)
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

function startWorkspaceFromPopoverStep(workspaceId: string, step: FlowStep) {
  startWorkspaceFromCell(workspaceId, step)
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

async function refreshProjectManifests() {
  const entries = await Promise.all(
    projectSources.value.map(async (project) => {
      try {
        const projectRoot = await registerProjectRootForProjectManagement(project.path)
        if (!projectRoot) return null
        const manifestText = await readOptionalProjectTextFile('project.json', {
          projectPath: projectRoot,
        })
        if (!manifestText) return null
        const manifest = parseProjectManifest(manifestText)
        const flowStates = await readWorkspaceFlowStates(manifest)
        const analysisInputs = await readWorkspaceAnalysisInputs(manifest)
        return [project.path, manifest, flowStates, analysisInputs] as const
      } catch (error) {
        console.warn(`Failed to load project manifest: ${project.path}`, error)
        return null
      }
    }),
  )

  const validEntries = entries.filter((entry) => entry !== null)
  projectManifests.value = Object.fromEntries(
    validEntries.map(([path, manifest]) => [path, manifest]),
  )
  workspaceFlowStates.value = Object.fromEntries(
    validEntries.map(([path, _manifest, flowStates]) => [path, flowStates]),
  )
  workspaceAnalysisInputs.value = Object.fromEntries(
    validEntries.map(([path, _manifest, _flowStates, analysisInputs]) => [
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
      [project.path]: await readWorkspaceFlowStates(manifest),
    }
    workspaceAnalysisInputs.value = {
      ...workspaceAnalysisInputs.value,
      [project.path]: await readWorkspaceAnalysisInputs(manifest),
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

    const manifest =
      projectManifests.value[project.path] ??
      (await readOrCreateProjectManifest(projectRoot, project.name))
    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot,
      projectName: project.name,
      workspacePath: directory,
    })
    await writeProjectManifestForProject(updated, projectRoot)
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
  const workspaceId = nextWorkspaceId(project)
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
    const workspace =
      selectedProject.value.workspaces.find((item) => item.id === workspaceId) ?? null
    const manifest =
      selectedProjectManifest.value ??
      (await readOrCreateProjectManifest(
        selectedProject.value.path,
        selectedProject.value.name,
      ))
    const updated = deleteWorkspaceFromManifest(manifest, workspaceId)
    await writeSelectedProjectManifest(updated, selectedProject.value.path)
    if (!options.keepWorkspaceData && workspace?.workspacePath) {
      try {
        await removeProjectDirectory(workspace.workspacePath)
      } catch (error) {
        console.warn('Failed to remove workspace directory.', error)
        showToast({
          severity: 'warn',
          summary: 'Workspace directory not deleted',
          detail: `${workspace.workspacePath} could not be removed. The project.json entry was deleted.`,
        })
      }
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
  const manifest = createProjectManifestDraft({
    rootPath: projectRoot,
    name,
  })
  await writeProjectTextFile('project.json', serializeProjectManifest(manifest), {
    projectPath: projectRoot,
  })
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
  workspaceAnalysisInputs.value = {
    ...workspaceAnalysisInputs.value,
    [projectRoot]: {},
  }
  selectedProjectId.value = createdProject.id
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

function metricValueClass(state: ProjectMetricPoint['state']): string {
  const map: Record<ProjectMetricPoint['state'], string> = {
    good: 'metric-good',
    warn: 'metric-warn',
    bad: 'metric-bad',
    pending: 'metric-pending',
  }
  return map[state]
}

function pendingMetricPoint(workspaceId: string): ProjectMetricPoint {
  return {
    workspaceId,
    label: 'N/A',
    value: null,
    state: 'pending',
  }
}

function runStateSliceClass(state: ProjectRunStateSlice['state']): string {
  return `run-state-${state}`
}

function buildRunStatePieBackground(slices: ProjectRunStateSlice[]): string {
  if (slices.length === 0) {
    return 'conic-gradient(color-mix(in srgb, var(--text-secondary) 14%, transparent) 0deg 360deg)'
  }

  let cursor = 0
  const segments = slices.map((slice) => {
    const end = cursor + (slice.percent / 100) * 360
    const segment = `${runStateSliceColor(slice.state)} ${cursor}deg ${end}deg`
    cursor = end
    return segment
  })
  return `conic-gradient(${segments.join(', ')})`
}

function runStateSliceColor(state: ProjectRunStateSlice['state']): string {
  const map: Record<ProjectRunStateSlice['state'], string> = {
    success: 'var(--success-color)',
    failed: 'var(--danger-color)',
    running: 'var(--warn-color)',
    unstart: 'color-mix(in srgb, var(--text-secondary) 62%, transparent)',
    skipped: 'color-mix(in srgb, var(--text-secondary) 36%, transparent)',
  }
  return map[state]
}

function joinProjectPath(rootPath: string, name: string): string {
  const root = normalizePath(rootPath)
  const child = name.replace(/^\/+/, '')
  return root ? `${root}/${child}` : child
}

function metricInlineWidth(
  point: ProjectMetricPoint,
  points: ProjectMetricPoint[] = [],
): number {
  if (point.value === null) return 28
  const values = points
    .map((item) => Math.abs(item.value ?? 0))
    .filter((value) => value > 0)
  const maxValue = Math.max(...values, 0)
  if (maxValue === 0) return 8
  return Math.max(8, Math.min(100, (Math.abs(point.value) / maxValue) * 100))
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

async function readWorkspaceFlowStates(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  const entries = await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      try {
        const flowText = await readOptionalProjectTextFile('home/flow.json', {
          projectPath: workspace.workspace_path,
        })
        return [
          workspace.workspace_id,
          flowText ? parseWorkspaceFlowStateMap(flowText) : {},
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load workspace flow.json: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, {}] as const
      }
    }),
  )

  return Object.fromEntries(entries)
}

async function readWorkspaceAnalysisInputs(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceAnalysisInputsById> {
  const designName = normalizeArtifactDesignName(
    manifest.base_design.top_module || manifest.name || 'design',
  )
  const entries = await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      try {
        return [
          workspace.workspace_id,
          await readWorkspaceAnalysisInput(workspace.workspace_path, designName),
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load workspace feature summary: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, {}] as const
      }
    }),
  )

  return Object.fromEntries(entries)
}

async function readWorkspaceAnalysisInput(
  workspacePath: string,
  designName: string,
): Promise<ProjectWorkspaceAnalysisInput> {
  const [
    fileEntries,
    stepMetricEntries,
    staReports,
    flowText,
    checklistText,
    parametersText,
  ] = await Promise.all([
    Promise.all(
      WORKSPACE_ANALYSIS_FILE_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.path, {
          projectPath: workspacePath,
        })
        return [spec.key, content] as const
      }),
    ),
    Promise.all(
      WORKSPACE_STEP_METRICS_FILE_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.path, {
          projectPath: workspacePath,
        })
        return [spec.step, content] as const
      }),
    ),
    Promise.all(
      STA_CORNER_PATHS.map(async (corner) => {
        const content = await readOptionalProjectTextFile(
          `sta_ecc/output/${corner}/${designName}.rpt.json`,
          { projectPath: workspacePath },
        )
        return { corner, content }
      }),
    ),
    readOptionalProjectTextFile('home/flow.json', { projectPath: workspacePath }),
    readOptionalProjectTextFile('home/checklist.json', { projectPath: workspacePath }),
    readOptionalProjectTextFile('home/parameters.json', { projectPath: workspacePath }),
  ])

  return {
    files: Object.fromEntries(fileEntries),
    stepMetricTexts: Object.fromEntries(stepMetricEntries),
    staReports,
    flowText,
    checklistText,
    parametersText,
  }
}

async function readOrCreateProjectManifest(
  projectRoot: string,
  projectName: string,
): Promise<ProjectManifest> {
  const manifestText = await readOptionalProjectTextFile('project.json', {
    projectPath: projectRoot,
  })
  if (manifestText) return parseProjectManifest(manifestText)
  return createProjectManifestDraft({
    rootPath: projectRoot,
    name: projectName || basenamePath(projectRoot) || 'project',
  })
}

async function writeSelectedProjectManifest(
  manifest: ProjectManifest,
  projectRoot: string,
) {
  await writeProjectManifestForProject(manifest, projectRoot)
}

async function writeProjectManifestForProject(
  manifest: ProjectManifest,
  projectRoot: string,
) {
  const registeredProjectRoot = await registerProjectRootForProjectManagement(projectRoot)
  if (!registeredProjectRoot) throw new Error('Project root could not be registered.')

  await writeProjectTextFile('project.json', serializeProjectManifest(manifest), {
    projectPath: registeredProjectRoot,
  })
  const normalizedRoot = normalizePath(registeredProjectRoot)
  const flowStates = await readWorkspaceFlowStates(manifest)
  const analysisInputs = await readWorkspaceAnalysisInputs(manifest)
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

function normalizeArtifactDesignName(value: string): string {
  return value.trim().replace(/[\\/]/g, '_').replace(/\s+/g, '_') || 'design'
}
</script>

<style scoped>
.resource-manager-view {
  --project-manager-bg: color-mix(in srgb, var(--bg-secondary) 92%, var(--bg-primary));
  --project-list-bg: color-mix(in srgb, var(--bg-secondary) 82%, var(--bg-primary));
  --project-tree-bg: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));
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
  background: var(--project-manager-bg);
  isolation: isolate;
}

.blurred-home {
  display: none;
  position: absolute;
  inset: 0;
  overflow: hidden;
  filter: blur(1.5px) brightness(0.82);
  transform: translateZ(0) scale(1.006);
  background:
    radial-gradient(
      circle at 50% 16%,
      color-mix(in srgb, var(--accent-color) 12%, transparent),
      transparent 28%
    ),
    linear-gradient(
      color-mix(in srgb, var(--border-color) 50%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--border-color) 50%, transparent) 1px,
      transparent 1px
    ),
    var(--bg-secondary);
  background-size:
    auto,
    52px 52px,
    52px 52px,
    auto;
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
  display: none;
  background: transparent;
}

.manager-dialog {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: min(1652px, calc(100% - 44px));
  height: min(980px, calc(100% - 44px));
  min-height: min(600px, calc(100% - var(--dialog-block-gutter)));
  padding: 24px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  border-radius: 14px;
  background: var(--bg-primary);
  box-shadow: 0 18px 28px rgba(17, 24, 39, 0.12);
  transition:
    width 0.18s ease,
    height 0.18s ease,
    border-radius 0.18s ease;
}

.manager-dialog.maximized {
  width: calc(100% - 8px);
  height: calc(100% - 8px);
  min-height: 0;
  border-radius: 8px;
}

.manager-window-controls {
  position: absolute;
  top: 24px;
  right: 22px;
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
  transition:
    color 0.15s ease,
    background 0.15s ease;
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
  transition:
    color 0.15s ease,
    background 0.15s ease;
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
  gap: 14px;
  min-height: 54px;
  padding: 0 156px 12px 0;
  margin: 0 -24px 14px;
  padding-left: 24px;
  border-bottom: 1px solid var(--border-color);
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
.project-modal-dialog h2 {
  margin: 0;
  color: var(--text-primary);
  font-weight: 750;
  letter-spacing: 0;
}

.manager-header h1 {
  font-size: 23px;
  font-weight: 820;
  line-height: 1.1;
}

.manager-header p,
.manager-toolbar p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.modal-actions,
.axis-chips {
  display: flex;
  align-items: center;
  gap: 10px;
}

.manager-grid {
  display: grid;
  grid-template-columns: minmax(330px, 390px) minmax(780px, 1fr);
  gap: 18px;
  min-height: 0;
  overflow: visible;
  flex: 1 1 auto;
}

.manager-sidebar,
.manager-table-panel {
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.manager-sidebar {
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow: visible;
  background: var(--project-list-bg);
}

.project-list-panel {
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.project-list-panel {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 14px;
  padding: 0;
  overflow: visible;
}

.project-list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.project-list-title h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 850;
}

.project-list-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.resource-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
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
  align-content: start;
  grid-auto-rows: max-content;
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
  overflow: visible;
}

.project-workspace-tree {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
}

.project-workspace-tree.selected {
  padding: 10px 10px 14px 14px;
  overflow: visible;
  border: 1px solid color-mix(in srgb, var(--accent-color) 24%, var(--border-color));
  border-radius: 10px;
  background: var(--project-tree-bg);
  box-shadow: 0 10px 18px rgba(17, 24, 39, 0.06);
}

.project-workspace-tree.selected::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  border-radius: 10px 0 0 10px;
  background: var(--accent-color);
  content: '';
}

.project-tree-row {
  grid-template-columns: 28px minmax(0, 1fr) auto;
  height: 62px;
  min-height: 62px;
  padding: 9px 8px 9px 10px;
  border-color: transparent;
  background: transparent;
}

.project-tree-actions,
.workspace-tree-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}

.header-action-button {
  width: 30px;
  height: 30px;
}

.header-action-button .circle-glyph {
  width: 13px;
  height: 13px;
}

.resource-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 54px;
  min-height: 54px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 52%, var(--bg-secondary));
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.resource-row:hover,
.resource-row.selected {
  border-color: color-mix(in srgb, var(--accent-color) 56%, transparent);
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
}

.project-workspace-tree.selected .project-tree-row.selected {
  border-color: color-mix(in srgb, var(--accent-color) 38%, transparent);
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
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
  transition:
    color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
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

.workspace-tree-list {
  position: relative;
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 4px 0 0 28px;
  overflow: visible;
}

.workspace-tree-list::before {
  position: absolute;
  top: 14px;
  bottom: 12px;
  left: 14px;
  width: 1.3px;
  background: color-mix(in srgb, var(--text-secondary) 30%, transparent);
  content: '';
}

.workspace-tree-item {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
  padding-left: calc(var(--workspace-depth, 0) * 14px);
  overflow: visible;
}

.workspace-tree-item::before {
  position: absolute;
  top: 28px;
  left: -14px;
  width: 14px;
  border-top: 1.3px solid color-mix(in srgb, var(--text-secondary) 30%, transparent);
  content: '';
}

.workspace-tree-item::after {
  position: absolute;
  top: 24px;
  left: -18px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text-secondary);
  content: '';
}

.workspace-tree-item.flow-hint-success::after {
  background: var(--success-color);
}

.workspace-tree-item.flow-hint-running::after {
  background: var(--warn-color);
}

.workspace-tree-item.flow-hint-failed::after {
  background: var(--danger-color);
}

.workspace-tree-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 64px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 86%, transparent);
  border-radius: 8px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 74%, var(--bg-secondary));
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.workspace-tree-item.flow-hint-failed .workspace-tree-row {
  border-color: color-mix(in srgb, var(--danger-color) 22%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 7%, var(--bg-primary));
}

.workspace-tree-item.flow-hint-running .workspace-tree-row {
  border-color: color-mix(in srgb, var(--warn-color) 26%, var(--border-color));
  background: color-mix(in srgb, var(--warn-color) 7%, var(--bg-primary));
}

.workspace-tree-row:hover {
  border-color: color-mix(in srgb, var(--accent-color) 42%, transparent);
  background: color-mix(in srgb, var(--accent-color) 7%, var(--bg-primary));
}

.workspace-tree-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.workspace-tree-copy strong,
.workspace-tree-copy small,
.workspace-tree-copy em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-tree-copy strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-style: normal;
}

.workspace-tree-copy small,
.workspace-tree-copy em {
  color: var(--text-secondary);
  font-size: 10px;
}

.workspace-tree-copy em {
  font-style: normal;
}

.workspace-flow-hint {
  max-width: 82px;
  overflow: hidden;
  border-radius: 999px;
  padding: 4px 7px;
  font-size: 10px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-flow-hint.flow-hint-success {
  color: var(--success-color);
  background: var(--success-bg);
}

.workspace-flow-hint.flow-hint-running {
  color: var(--warn-color);
  background: var(--warn-bg);
}

.workspace-flow-hint.flow-hint-failed {
  color: var(--danger-color);
  background: var(--danger-bg);
}

.workspace-flow-hint.flow-hint-unstart,
.workspace-flow-hint.flow-hint-skipped {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 62%, transparent);
}

.circle-action {
  position: relative;
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 70%, var(--bg-secondary));
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.circle-action:hover,
.circle-action:focus-visible {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 58%, transparent);
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
  transform: translateY(-1px);
}

.circle-action.primary {
  color: #fff;
  border-color: color-mix(in srgb, var(--accent-color) 70%, transparent);
  background: var(--accent-color);
}

.circle-action.danger:hover,
.circle-action.danger:focus-visible {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 58%, transparent);
  background: var(--danger-bg);
}

.circle-glyph {
  position: relative;
  display: block;
  width: 12px;
  height: 12px;
  color: currentColor;
}

.circle-glyph::before,
.circle-glyph::after {
  position: absolute;
  content: '';
}

.circle-glyph.add::before,
.circle-glyph.add::after,
.circle-glyph.remove::before {
  top: 50%;
  left: 50%;
  width: 10px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transform: translate(-50%, -50%);
}

.circle-glyph.add::before {
  transform: translate(-50%, -50%) rotate(90deg);
}

.circle-glyph.open::before {
  top: 5px;
  left: 1px;
  width: 10px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transform: rotate(-45deg);
  transform-origin: center;
}

.circle-glyph.open::after {
  top: 1px;
  right: 1px;
  width: 6px;
  height: 6px;
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  transform: rotate(0deg);
}

.circle-glyph.file::before {
  top: 1px;
  left: 2px;
  width: 8px;
  height: 10px;
  border: 1.8px solid currentColor;
  border-radius: 2px;
  clip-path: polygon(0 0, 68% 0, 100% 32%, 100% 100%, 0 100%);
}

.circle-glyph.file::after {
  top: 1px;
  right: 2px;
  width: 3px;
  height: 3px;
  border-top: 1.8px solid currentColor;
  border-right: 1.8px solid currentColor;
  transform: rotate(0deg);
}

.workspace-flow-popover {
  position: absolute;
  left: calc(100% + 14px);
  top: -44px;
  z-index: 8;
  display: grid;
  width: 322px;
  max-width: min(322px, calc(100vw - 80px));
  max-height: min(456px, calc(100vh - 160px));
  gap: 10px;
  padding: 18px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-primary) 98%, transparent);
  box-shadow: 0 10px 18px rgba(17, 24, 39, 0.1);
}

.workspace-flow-popover::before {
  position: absolute;
  top: 74px;
  left: -11px;
  width: 20px;
  height: 20px;
  border-left: 1px solid color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  border-bottom: 1px solid
    color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  background: color-mix(in srgb, var(--bg-primary) 98%, transparent);
  content: '';
  transform: rotate(45deg);
}

.workspace-flow-popover header {
  display: grid;
  gap: 2px;
  padding-bottom: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
}

.workspace-flow-popover strong {
  font-size: 17px;
  font-weight: 850;
}

.workspace-flow-popover small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popover-step-row {
  display: grid;
  grid-template-columns: minmax(86px, 1fr) auto 26px;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  border: 0;
  border-radius: 7px;
  padding: 5px 8px;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.popover-step-row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

.popover-step-row:disabled {
  cursor: not-allowed;
  opacity: 0.54;
}

.popover-step-row span {
  font-size: 13px;
  font-weight: 800;
}

.popover-step-row em {
  border-radius: 999px;
  padding: 3px 6px;
  font-size: 11px;
  font-style: normal;
}

.popover-step-add {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: var(--accent-color);
}

.workspace-tree-empty {
  margin-left: 12px;
  padding: 12px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
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

.manager-table-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 24px;
  overflow: hidden;
  background: var(--bg-primary);
}

.manager-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.manager-toolbar h2 {
  font-size: 16px;
}

.project-workbench {
  display: grid;
  grid-template-rows: minmax(250px, 0.8fr) minmax(360px, 1.2fr);
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
}

.project-analysis-shell {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
}

.analysis-panel,
.flow-panel {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
}

.analysis-panel {
  display: flex;
  flex-direction: column;
  padding: 10px;
}

.mockup-analysis-panel {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.flow-panel {
  display: flex;
  flex-direction: column;
  padding: 10px;
}

.panel-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.panel-title-row.compact {
  margin-bottom: 6px;
}

.panel-title-row h3 {
  margin: 0;
  font-size: 22px;
  font-weight: 850;
}

.panel-title-row p {
  margin: 3px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.analysis-heading {
  align-items: center;
  justify-content: space-between;
}

.analysis-header-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-left: auto;
  min-width: 0;
}

.analysis-tabs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 48%, transparent);
}

.analysis-tabs button {
  min-height: 26px;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 750;
}

.analysis-tabs button.selected {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(166px, auto);
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.dashboard-card {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  min-height: 166px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.mockup-dashboard-card {
  min-height: 166px;
}

.dashboard-card > span,
.dashboard-card header span {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 780;
  text-transform: uppercase;
}

.dashboard-card header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.dashboard-card header small,
.dashboard-card small {
  color: var(--text-secondary);
  font-size: 11px;
}

.dashboard-stat-row {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.dashboard-stat-row strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 28px;
}

.dashboard-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dashboard-pill {
  border-radius: 999px;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 750;
}

.dashboard-pill.success {
  color: var(--success-color);
  background: var(--success-bg);
}

.dashboard-pill.info {
  color: var(--info-color);
  background: var(--info-bg);
}

.dashboard-best-card {
  min-height: 166px;
}

.best-workspace-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.best-workspace-summary div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.best-workspace-summary span:not(.dashboard-pill) {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 780;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.best-workspace-summary strong {
  overflow: hidden;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.best-ppa-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.best-ppa-item {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 46%, transparent);
}

.best-ppa-item span,
.best-ppa-item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.best-ppa-item span {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 760;
}

.best-ppa-item strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
}

.run-state-layout {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  min-height: 92px;
}

.run-state-pie {
  position: relative;
  width: 92px;
  aspect-ratio: 1;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-color) 66%, transparent);
}

.run-state-pie::after {
  position: absolute;
  inset: 22px;
  border-radius: inherit;
  background: var(--bg-primary);
  content: '';
}

.run-state-copy {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.run-state-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.run-state-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.run-state-legend i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.run-state-success {
  background: var(--success-color);
}
.run-state-failed {
  background: var(--danger-color);
}
.run-state-running {
  background: var(--warn-color);
}
.run-state-unstart {
  background: color-mix(in srgb, var(--text-secondary) 62%, transparent);
}
.run-state-skipped {
  background: color-mix(in srgb, var(--text-secondary) 36%, transparent);
}

.dashboard-chart-card {
  min-height: 246px;
}

.dashboard-key-metric-card {
  grid-column: 1 / -1;
  min-height: 336px;
}

.dashboard-key-metric-table {
  display: grid;
  grid-template-columns: minmax(132px, 0.9fr) repeat(
      var(--dashboard-metric-count),
      minmax(92px, 1fr)
    );
  min-width: min(100%, calc(132px + (var(--dashboard-metric-count) * 92px)));
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 34%, transparent);
}

.dashboard-key-header,
.dashboard-key-workspace-cell,
.dashboard-key-metric-cell {
  min-width: 0;
  min-height: 42px;
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: transparent;
}

.dashboard-key-header {
  display: grid;
  place-items: center;
  padding: 0 8px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  text-align: center;
  text-transform: uppercase;
}

.dashboard-key-workspace-header {
  justify-items: start;
}

.dashboard-key-workspace-cell,
.dashboard-key-metric-cell {
  cursor: pointer;
}

.dashboard-key-workspace-cell {
  overflow: hidden;
  padding: 0 10px;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 760;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-key-workspace-cell.selected,
.dashboard-key-workspace-cell:hover,
.dashboard-key-metric-cell:hover {
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

.dashboard-key-metric-cell {
  display: grid;
  align-content: center;
  gap: 5px;
  padding: 7px 9px;
  color: var(--text-secondary);
  text-align: left;
}

.dashboard-key-metric-cell strong {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-empty-note {
  display: grid;
  min-height: 72px;
  place-items: center;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.step-analysis-view {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
}

.step-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.step-selector button {
  min-height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0 12px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
  cursor: pointer;
  font-size: 11px;
  font-weight: 760;
}

.step-selector button.selected {
  color: var(--success-color);
  border-color: color-mix(in srgb, var(--success-color) 42%, transparent);
  background: var(--success-bg);
}

.flow-title-actions {
  display: inline-flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

.axis-chip {
  border-radius: 999px;
  padding: 5px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.axis-chip.step {
  color: var(--success-color);
  background: var(--success-bg);
}

.analysis-grid {
  display: grid;
  grid-template-rows: 54px minmax(330px, 1fr);
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
}

.step-compare-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.step-compare-overview div {
  display: grid;
  gap: 4px;
  min-height: 48px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
}

.step-compare-overview span {
  color: var(--text-secondary);
  font-size: 10px;
}

.step-compare-overview strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 18px;
}

.step-compare-metric-table {
  display: grid;
  grid-template-columns: minmax(132px, 0.9fr) repeat(
      var(--step-compare-metric-count),
      minmax(92px, 1fr)
    );
  grid-auto-rows: 42px;
  min-height: 0;
  min-width: min(100%, calc(132px + (var(--step-compare-metric-count) * 92px)));
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 34%, transparent);
}

.step-compare-header,
.step-compare-workspace-cell,
.step-compare-metric-cell {
  min-width: 0;
  height: 42px;
  min-height: 42px;
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: transparent;
}

.step-compare-header {
  display: grid;
  place-items: center;
  padding: 0 8px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  text-align: center;
  text-transform: uppercase;
}

.step-compare-workspace-header {
  justify-items: start;
}

.step-compare-workspace-cell,
.step-compare-metric-cell {
  cursor: pointer;
}

.step-compare-workspace-cell {
  overflow: hidden;
  padding: 0 10px;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 760;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-compare-workspace-cell.selected,
.step-compare-workspace-cell:hover,
.step-compare-metric-cell:hover {
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

.step-compare-metric-cell {
  display: grid;
  align-content: center;
  gap: 5px;
  padding: 7px 9px;
  color: var(--text-secondary);
  text-align: left;
}

.step-compare-metric-cell strong {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.metric-good {
  color: var(--success-color);
}
.metric-warn {
  color: var(--warn-color);
}
.metric-bad {
  color: var(--danger-color);
}
.metric-pending {
  color: var(--text-secondary);
}

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

.legend-success {
  background: var(--success-color);
}
.legend-reused {
  background: #7a8798;
}
.legend-skipped {
  background: #303846;
}
.legend-unstart {
  background: #596679;
}
.legend-running {
  background: var(--info-color);
}
.legend-failed {
  background: var(--danger-color);
}

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

.actions-header {
  font-size: 11px;
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

.branch-link-group {
  --branch-link-color: #2f7df6;
  --branch-link-halo: color-mix(in srgb, var(--bg-primary) 90%, white 22%);
  filter: drop-shadow(0 2px 5px rgba(15, 23, 42, 0.22));
}

.branch-link-blue {
  --branch-link-color: #2f7df6;
}

.branch-link-teal {
  --branch-link-color: #00a7a7;
}

.branch-link-amber {
  --branch-link-color: #d97706;
}

.branch-link-rose {
  --branch-link-color: #e03a7a;
}

.branch-link,
.branch-link-halo {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.branch-link-halo {
  stroke: var(--branch-link-halo);
  stroke-width: 6.4;
  opacity: 0.82;
}

.branch-link {
  stroke: var(--branch-link-color);
  stroke-width: 3.2;
  opacity: 0.96;
}

.branch-arrow path {
  fill: var(--branch-link-color);
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
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.workspace-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 3px;
  padding: 0 8px 0 10px;
  border: 0;
  outline: none;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.workspace-cell-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.workspace-cell-copy strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.workspace-cell-copy small {
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
  content: '';
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
  transition:
    transform 0.15s ease,
    border-color 0.15s ease;
}

.flow-cell:hover {
  transform: translateY(-1px);
}

.step-success {
  color: var(--success-color);
  background: var(--success-bg);
}
.step-reused {
  color: #7a8798;
  background: color-mix(in srgb, #7a8798 16%, transparent);
}
.step-skipped {
  color: color-mix(in srgb, var(--text-secondary) 60%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 58%, transparent);
}
.step-unstart {
  color: #596679;
  background: color-mix(in srgb, #596679 14%, transparent);
}
.step-running {
  color: var(--info-color);
  background: var(--info-bg);
}
.step-failed {
  color: var(--danger-color);
  background: var(--danger-bg);
}

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

.flow-row-actions {
  display: flex;
  justify-content: center;
  gap: 6px;
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
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
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

.row-action-btn.danger:hover,
.row-action-btn.danger:focus-visible {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 56%, transparent);
  background: var(--danger-bg);
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

.branch-artifacts {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 28%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
}

.branch-artifacts strong {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 760;
}

.branch-artifacts dl {
  display: grid;
  gap: 7px;
  margin: 0;
}

.branch-artifacts dt {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 750;
  text-transform: uppercase;
}

.branch-artifacts dd {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
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

.project-modal-dialog header p:not(.manager-eyebrow) {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.modal-path {
  display: block;
  padding: 10px;
  overflow-wrap: anywhere;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--bg-secondary) 44%, transparent);
  font-size: 12px;
}

.branch-draft-dialog {
  width: min(620px, calc(100vw - 36px));
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

.workspace-delete-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: flex-start;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 42%, transparent);
}

.workspace-delete-option input {
  width: 15px;
  height: 15px;
  margin: 2px 0 0;
  accent-color: var(--accent-color);
}

.workspace-delete-option span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.workspace-delete-option strong {
  color: var(--text-primary);
  font-size: 12px;
}

.workspace-delete-option small {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-size: 11px;
}

.modal-actions {
  justify-content: flex-end;
}

@media (max-width: 1180px) {
  .manager-grid {
    grid-template-columns: minmax(220px, 250px) minmax(560px, 1fr);
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
