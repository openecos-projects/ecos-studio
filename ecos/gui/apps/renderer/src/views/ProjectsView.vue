<template>
  <div class="resource-manager-view">
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
          <h1 id="project-manager-title">Project Management</h1>
        </div>
      </header>

      <div class="manager-grid">
        <aside class="manager-sidebar" aria-label="Projects">
          <div class="project-list-panel" aria-label="Projects">
            <div class="project-list-toolbar">
              <div class="resource-search sidebar-search">
                <i class="ri-search-line"></i>
                <input
                  v-model="searchQuery"
                  type="text"
                  aria-label="Search projects or workspaces"
                  placeholder="Search project or workspace"
                />
              </div>
              <div class="project-list-actions">
                <button
                  type="button"
                  class="project-toolbar-action"
                  @click="importProject"
                >
                  <i class="ri-file-add-line" aria-hidden="true"></i>
                  <span>Import</span>
                </button>
                <button
                  type="button"
                  class="project-toolbar-action primary"
                  @click="openNewProjectDialog"
                >
                  <i class="ri-add-line" aria-hidden="true"></i>
                  <span>New project</span>
                </button>
              </div>
            </div>

            <div class="project-list" aria-label="Project list">
              <article
                v-for="project in visibleProjectCards"
                :key="project.source.id"
                class="project-workspace-tree"
                :class="{
                  selected: project.model.id === selectedProjectId,
                  collapsed:
                    project.model.id === selectedProjectId &&
                    !projectWorkspaceListExpanded(project.model.id),
                }"
              >
                <div class="project-tree-row-shell">
                  <button
                    v-if="
                      project.model.id === selectedProjectId &&
                      project.model.workspaces.length > 0
                    "
                    type="button"
                    class="circle-action project-collapse-toggle"
                    :aria-expanded="projectWorkspaceListExpanded(project.model.id)"
                    :aria-controls="projectWorkspaceListId(project.model.id)"
                    :aria-label="
                      projectWorkspaceListExpanded(project.model.id)
                        ? `Collapse workspaces for ${project.model.name}`
                        : `Expand workspaces for ${project.model.name}`
                    "
                    :title="
                      projectWorkspaceListExpanded(project.model.id)
                        ? 'Collapse workspaces'
                        : 'Expand workspaces'
                    "
                    @click="toggleProjectWorkspaceList(project.model.id)"
                  >
                    <i
                      :class="
                        projectWorkspaceListExpanded(project.model.id)
                          ? 'ri-arrow-down-s-line'
                          : 'ri-arrow-right-s-line'
                      "
                      aria-hidden="true"
                    ></i>
                  </button>
                  <span
                    v-else
                    class="project-tree-disclosure-spacer"
                    aria-hidden="true"
                  ></span>
                  <button
                    type="button"
                    class="resource-row project-tree-row mockup-project-row"
                    :class="{ selected: project.model.id === selectedProjectId }"
                    :aria-pressed="project.model.id === selectedProjectId"
                    @click="selectProject(project.model.id)"
                  >
                    <span class="resource-icon">
                      <i class="ri-layout-grid-line" aria-hidden="true"></i>
                    </span>
                    <span class="resource-copy">
                      <strong>{{ project.model.name }}</strong>
                      <small>{{
                        workspaceCountLabel(project.model.workspaces.length)
                      }}</small>
                    </span>
                  </button>
                  <div
                    class="project-tree-actions"
                    :aria-label="`Actions for ${project.model.name}`"
                  >
                    <button
                      type="button"
                      class="row-primary-action"
                      :aria-label="`New workspace in ${project.model.name}`"
                      @click="createWorkspaceForProject(project.model)"
                    >
                      <i class="ri-add-line" aria-hidden="true"></i>
                      <span>New</span>
                    </button>
                    <button
                      type="button"
                      class="circle-action row-action-menu-trigger"
                      :aria-expanded="projectActionMenuId === project.model.id"
                      :aria-label="`More actions for ${project.model.name}`"
                      aria-haspopup="menu"
                      @click="toggleProjectActionMenu(project.model.id)"
                    >
                      <i class="ri-more-2-fill" aria-hidden="true"></i>
                    </button>
                    <div
                      v-if="projectActionMenuId === project.model.id"
                      class="row-action-menu"
                      role="group"
                      :aria-label="`More actions for ${project.model.name}`"
                    >
                      <button
                        type="button"
                        class="row-action-menu-item"
                        @click="importWorkspaceIntoProject(project.model)"
                      >
                        <i class="ri-file-add-line" aria-hidden="true"></i>
                        <span>Import workspace</span>
                      </button>
                      <button
                        type="button"
                        class="row-action-menu-item danger"
                        @click="requestDeleteProject(project.source)"
                      >
                        <i class="ri-delete-bin-line" aria-hidden="true"></i>
                        <span>Remove project</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  v-if="
                    projectWorkspaceListExpanded(project.model.id) &&
                    project.model.workspaces.length > 0
                  "
                  :id="projectWorkspaceListId(project.model.id)"
                  class="workspace-tree-list"
                  :class="{
                    'has-preview-control': workspaceListCanToggle(project.model),
                  }"
                  aria-label="Project workspaces"
                >
                  <div
                    v-for="workspace in visibleProjectWorkspaces(project.model)"
                    :key="workspace.id"
                    class="workspace-tree-item"
                    :class="flowStatusHintClass(workspace.flowStatusHint.state)"
                    :style="workspaceDepthStyle(workspace)"
                  >
                    <div
                      class="workspace-tree-row-shell"
                      :data-workspace-id="workspace.id"
                    >
                      <button
                        type="button"
                        class="workspace-tree-row"
                        :class="{ selected: workspace.id === selectedWorkspaceId }"
                        :aria-pressed="workspace.id === selectedWorkspaceId"
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
                      </button>
                      <div
                        class="workspace-tree-actions"
                        :aria-label="`Actions for ${workspace.id}`"
                      >
                        <button
                          type="button"
                          class="row-primary-action"
                          :aria-label="`Open workspace ${workspace.id}`"
                          @click="openWorkspace(workspace)"
                        >
                          <i class="ri-arrow-right-up-line" aria-hidden="true"></i>
                          <span>Open</span>
                        </button>
                        <button
                          type="button"
                          class="circle-action row-action-menu-trigger"
                          :aria-expanded="workspaceActionMenuId === workspace.id"
                          :aria-label="`More actions for ${workspace.id}`"
                          aria-haspopup="menu"
                          @click="toggleWorkspaceActionMenu(workspace.id)"
                        >
                          <i class="ri-more-2-fill" aria-hidden="true"></i>
                        </button>
                        <div
                          v-if="workspaceActionMenuId === workspace.id"
                          class="row-action-menu"
                          role="group"
                          :aria-label="`More actions for ${workspace.id}`"
                        >
                          <button
                            type="button"
                            class="row-action-menu-item workspace-flow-trigger"
                            @click="toggleWorkspaceFlowPopover(workspace.id)"
                          >
                            <i class="ri-git-branch-line" aria-hidden="true"></i>
                            <span>Create from output</span>
                          </button>
                          <button
                            type="button"
                            class="row-action-menu-item danger"
                            @click="requestDeleteWorkspace(workspace.id)"
                          >
                            <i class="ri-delete-bin-line" aria-hidden="true"></i>
                            <span>Delete workspace</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="
                        popoverWorkspaceId === workspace.id && selectedPopoverWorkspace
                      "
                      class="workspace-flow-popover workspace-flow-popover--floating"
                      :class="workspacePopoverPlacementClass(workspace.id)"
                      :style="workspacePopoverStyle"
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
                          <i class="ri-add-line"></i>
                        </span>
                      </button>
                    </div>
                  </div>
                  <button
                    v-if="workspaceListCanToggle(project.model)"
                    type="button"
                    class="list-preview-toggle workspace-list-preview-toggle"
                    :aria-expanded="workspacePreviewShowsAll(project.model.id)"
                    :aria-label="
                      workspacePreviewShowsAll(project.model.id)
                        ? `Show fewer workspaces in ${project.model.name}`
                        : `Show all ${project.model.workspaces.length} workspaces in ${project.model.name}`
                    "
                    @click="toggleWorkspacePreview(project.model.id)"
                  >
                    <i
                      :class="
                        workspacePreviewShowsAll(project.model.id)
                          ? 'ri-arrow-up-s-line'
                          : 'ri-arrow-down-s-line'
                      "
                      aria-hidden="true"
                    ></i>
                    <span>{{
                      workspacePreviewShowsAll(project.model.id)
                        ? 'Show fewer workspaces'
                        : `Show all ${project.model.workspaces.length} workspaces`
                    }}</span>
                  </button>
                </div>

                <div
                  v-else-if="
                    projectWorkspaceListExpanded(project.model.id) &&
                    project.model.id === selectedProjectId
                  "
                  class="workspace-tree-empty"
                >
                  <strong>No workspaces yet</strong>
                  <span>Create a workspace or import one into this project.</span>
                  <div class="empty-state-actions">
                    <button
                      type="button"
                      class="empty-state-action primary"
                      @click="createWorkspaceForProject(project.model)"
                    >
                      New workspace
                    </button>
                    <button
                      type="button"
                      class="empty-state-action"
                      @click="importWorkspaceIntoProject(project.model)"
                    >
                      Import workspace
                    </button>
                  </div>
                </div>
              </article>

              <button
                v-if="projectListCanToggle"
                type="button"
                class="list-preview-toggle project-list-preview-toggle"
                :aria-expanded="projectPreviewShowsAll"
                :aria-label="
                  projectPreviewShowsAll
                    ? 'Show fewer projects'
                    : `Show all ${projectCards.length} projects`
                "
                @click="projectPreviewShowsAll = !projectPreviewShowsAll"
              >
                <i
                  :class="
                    projectPreviewShowsAll ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'
                  "
                  aria-hidden="true"
                ></i>
                <span>{{
                  projectPreviewShowsAll
                    ? 'Show fewer projects'
                    : `Show all ${projectCards.length} projects`
                }}</span>
              </button>

              <div v-if="projectCards.length === 0" class="empty-state">
                <template v-if="searchQuery.trim()">
                  <i class="ri-search-line" aria-hidden="true"></i>
                  <strong>No matching projects</strong>
                  <span>Try another name, or clear the search to see all projects.</span>
                  <div class="empty-state-actions">
                    <button
                      type="button"
                      class="empty-state-action"
                      @click="searchQuery = ''"
                    >
                      Clear search
                    </button>
                  </div>
                </template>
                <template v-else>
                  <i class="ri-folder-chart-line" aria-hidden="true"></i>
                  <strong>No projects yet</strong>
                  <span
                    >Import an existing project or create a new one to get started.</span
                  >
                  <div class="empty-state-actions">
                    <button
                      type="button"
                      class="empty-state-action primary"
                      @click="importProject"
                    >
                      Import Project
                    </button>
                    <button
                      type="button"
                      class="empty-state-action"
                      @click="openNewProjectDialog"
                    >
                      New Project
                    </button>
                  </div>
                </template>
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
              :selected-issue-metric="selectedIssueMetric"
              @select-analysis-tab="handleAnalysisTabSelection"
              @select-step="selectStep"
              @select-workspace="selectWorkspace"
              @select-issue-metric="selectIssueMetric"
              @set-baseline="setQorBaseline"
              @import-project="importProject"
              @new-project="openNewProjectDialog"
            />
          </div>
        </main>
      </div>
    </section>

    <div v-if="showNewProjectDialog" class="project-modal-scrim" role="presentation">
      <section
        ref="newProjectDialog"
        class="project-modal-dialog new-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        @keydown="handleModalKeydown($event, 'new-project')"
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
          <input
            v-model="projectRootDraft.name"
            type="text"
            placeholder="project_name"
            data-dialog-initial-focus
          />
        </label>

        <label class="form-field">
          <span>Design Name</span>
          <input v-model="projectRootDraft.designName" type="text" placeholder="gcd" />
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

        <label class="form-field">
          <span>Managed MPC</span>
          <select v-model="projectRootDraft.mpcId" :disabled="isLoadingProjectMpcs">
            <option value="">No MPC</option>
            <option
              v-for="mpc in projectMpcs"
              :key="mpc.resource_id"
              :value="mpc.resource_id"
            >
              {{ mpc.display_name }} ({{ mpc.installed_version }})
            </option>
          </select>
        </label>
        <p v-if="isLoadingProjectMpcs" class="modal-help">Loading managed MPCs...</p>
        <p v-else-if="projectMpcLoadError" class="modal-help">
          Managed MPCs could not be loaded. You can still create this project without one.
        </p>
        <p v-else-if="projectMpcs.length === 0" class="modal-help">
          No eligible managed MPCs are installed.
        </p>
        <p v-if="isLoadingProjectMpcSpec" class="modal-help">
          Loading MPC design specification...
        </p>
        <p v-else-if="projectMpcSpecError" class="modal-error">
          {{ projectMpcSpecError }}
        </p>
        <template v-else-if="selectedProjectMpcCandidate && selectedProjectMpcDesign">
          <label v-if="projectMpcDesigns.length > 1" class="form-field">
            <span>MPC Design</span>
            <select v-model="selectedProjectMpcDesignIndex">
              <option
                v-for="design in projectMpcDesigns"
                :key="design.index"
                :value="design.index"
              >
                {{ design.designName }}
              </option>
            </select>
          </label>
          <MpcTemplatePreview :design="selectedProjectMpcDesign" />
        </template>

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
        ref="workspaceDraftDialog"
        class="project-modal-dialog branch-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-draft-title"
        @keydown="handleModalKeydown($event, 'workspace-draft')"
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
            data-dialog-initial-focus
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
        ref="deleteWorkspaceDialog"
        class="project-modal-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-workspace-title"
        @keydown="handleModalKeydown($event, 'delete-workspace')"
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
        <p v-if="deleteWorkspaceError" class="modal-error" role="alert">
          {{ deleteWorkspaceError }}
        </p>
        <footer class="modal-actions">
          <button
            type="button"
            class="secondary-button"
            data-dialog-initial-focus
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
            <span>{{ deleteWorkspaceError ? 'Retry delete' : 'Delete' }}</span>
          </button>
        </footer>
      </section>
    </div>

    <div v-if="pendingDeleteProject" class="project-modal-scrim" role="presentation">
      <section
        ref="deleteProjectDialog"
        class="project-modal-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-project-title"
        @keydown="handleModalKeydown($event, 'delete-project')"
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
            data-dialog-initial-focus
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Project, ProjectStatus } from '../types'
import { useWorkspace } from '../composables/useWorkspace'
import ProjectAnalysisPanel from './project-management/ProjectAnalysisPanel.vue'
import MpcTemplatePreview from '@/components/MpcTemplatePreview.vue'
import { previewList } from './project-management/projectListPreview'
import { resolveProjectManagementRouteFocus } from './project-management/projectRouteFocus'
import { readProjectManagementWorkspaceData } from './project-management/projectWorkspaceAnalysisData'
import { mapWithConcurrency } from './project-management/asyncConcurrency'
import { waitForDesktopApi } from '@/platform/desktop'
import { listResourcesApi, readMpcSpecApi } from '@/api/plugin'
import { mutateProjectManifest } from '@/api/projectManifest'
import {
  parseProjectManifest,
  type ProjectManifest,
  type ProjectManifestMpc,
} from '@ecos-studio/shared'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createWorkspaceBranchDraft,
  type ProjectManifestMpcCandidate,
  projectMpcOptionFromResource,
  resolveProjectSelectionUpdate,
  nextWorkspaceId,
  type FlowStep,
  type ProjectFlowStatusHint,
  type ProjectManagementProject,
  type ProjectStepStatus,
  type ProjectWorkspace,
  type ProjectWorkspaceAnalysisInputsById,
  type ProjectWorkspaceFlowStatesById,
  type WorkspaceBranchDraft,
} from '@/utils/projectManagement'
import {
  createProjectManifestMpcSnapshot,
  parseMpcSpecDesigns,
  type MpcSpecDesign,
} from '@/utils/mpcSpec'
import {
  listProjectManagementEntries,
  readProjectManagementManifest,
} from '@/utils/projectManagementRead'
import {
  loadProjectHistory,
  rememberProjectHistoryEntry,
  removeProjectHistoryEntry,
} from '@/utils/projectHistory'

type BranchDraft = WorkspaceBranchDraft
type ModalId = 'new-project' | 'workspace-draft' | 'delete-workspace' | 'delete-project'
type ProjectCard = { source: Project; model: ProjectManagementProject }

const PROJECT_PREVIEW_LIMIT = 20
const WORKSPACE_PREVIEW_LIMIT = 20
const PROJECT_MANIFEST_READ_CONCURRENCY = 2

const route = useRoute()
const router = useRouter()
const { openProject, showToast } = useWorkspace()

const searchQuery = ref('')
const selectedProjectId = ref<string | null>(null)
const selectedWorkspaceId = ref('')
const collapsedProjectIds = ref<Set<string>>(new Set())
const workspacePreviewProjectIds = ref<Set<string>>(new Set())
const projectPreviewShowsAll = ref(false)
const selectedStep = ref<FlowStep>('DRC')
const selectedIssueMetric = ref<string | null>(null)
const selectedAnalysisTab = ref<'dashboard' | 'step'>('dashboard')
const hasOpenedStepAnalysis = ref(false)
const branchDraft = ref<BranchDraft | null>(null)
const popoverWorkspaceId = ref('')
const workspacePopoverStyle = ref<Record<string, string>>({})
const projectActionMenuId = ref<string | null>(null)
const workspaceActionMenuId = ref<string | null>(null)
const pendingDeleteWorkspaceId = ref<string | null>(null)
const keepWorkspaceDataOnDelete = ref(true)
const deleteWorkspaceError = ref('')
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
  designName: '',
  directory: '',
  mpcId: '',
})
const projectMpcs = ref<ProjectManifestMpcCandidate[]>([])
const isLoadingProjectMpcs = ref(false)
const projectMpcLoadError = ref('')
const projectMpcDesigns = ref<MpcSpecDesign[]>([])
const selectedProjectMpcDesignIndex = ref<number | null>(null)
const isLoadingProjectMpcSpec = ref(false)
const projectMpcSpecError = ref('')
const newProjectDialog = ref<HTMLElement | null>(null)
const workspaceDraftDialog = ref<HTMLElement | null>(null)
const deleteWorkspaceDialog = ref<HTMLElement | null>(null)
const deleteProjectDialog = ref<HTMLElement | null>(null)
const modalFocusReturnTarget = ref<HTMLElement | null>(null)

onMounted(async () => {
  document.addEventListener('pointerdown', handleWorkspacePopoverPointerDown)
  document.addEventListener('keydown', handleWorkspacePopoverKeydown)
  window.addEventListener('resize', updateWorkspaceFlowPopoverPosition)
  window.addEventListener('scroll', updateWorkspaceFlowPopoverPosition, true)
  projectHistory.value = await loadProjectHistory()
  await refreshProjectManifests()
  const focused = await applyRouteProjectFocus()
  if (!focused && !selectedProjectId.value) {
    selectedProjectId.value = projectCards.value[0]?.model.id ?? selectedProject.value.id
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleWorkspacePopoverPointerDown)
  document.removeEventListener('keydown', handleWorkspacePopoverKeydown)
  window.removeEventListener('resize', updateWorkspaceFlowPopoverPosition)
  window.removeEventListener('scroll', updateWorkspaceFlowPopoverPosition, true)
})

watch(
  () => [route.query.projectRoot, route.query.workspaceId] as const,
  () => {
    void applyRouteProjectFocus()
  },
)

const projectSources = computed<Project[]>(() => projectHistory.value)

const activeModal = computed<ModalId | null>(() => {
  if (showNewProjectDialog.value) return 'new-project'
  if (branchDraft.value) return 'workspace-draft'
  if (pendingDeleteWorkspaceId.value) return 'delete-workspace'
  if (pendingDeleteProject.value) return 'delete-project'
  return null
})

watch(activeModal, async (modal, previousModal) => {
  if (modal) {
    if (!previousModal && document.activeElement instanceof HTMLElement) {
      modalFocusReturnTarget.value = document.activeElement
    }
    await nextTick()
    focusInitialModalElement(modal)
    return
  }

  if (!previousModal) return
  await nextTick()
  const trigger = modalFocusReturnTarget.value
  modalFocusReturnTarget.value = null
  if (trigger?.isConnected) trigger.focus()
})

const projectCards = computed<ProjectCard[]>(() => {
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

const searchShowsAll = computed(() => Boolean(searchQuery.value.trim()))
const visibleProjectCards = computed(() =>
  previewList(projectCards.value, {
    limit: PROJECT_PREVIEW_LIMIT,
    showAll: searchShowsAll.value || projectPreviewShowsAll.value,
    selectedId: selectedProjectId.value,
    getId: (project) => project.model.id,
  }),
)
const projectListCanToggle = computed(
  () => !searchShowsAll.value && projectCards.value.length > PROJECT_PREVIEW_LIMIT,
)

function projectCardMatchesSearch(project: ProjectCard, query: string): boolean {
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
const selectedProjectMpcCandidate = computed<ProjectManifestMpcCandidate | null>(() => {
  return (
    projectMpcs.value.find((mpc) => mpc.resource_id === projectRootDraft.value.mpcId) ??
    null
  )
})
const selectedProjectMpcDesign = computed<MpcSpecDesign | null>(() => {
  return (
    projectMpcDesigns.value.find(
      (design) => design.index === selectedProjectMpcDesignIndex.value,
    ) ?? null
  )
})
const selectedProjectMpc = computed<ProjectManifestMpc | null>(() => {
  const candidate = selectedProjectMpcCandidate.value
  const design = selectedProjectMpcDesign.value
  return candidate && design ? createProjectManifestMpcSnapshot(candidate, design) : null
})

let activeProjectKey: string | null = null
let projectManifestRefreshQueue = Promise.resolve()
let projectMpcLoadGeneration = 0
let projectMpcSpecLoadGeneration = 0
let selectedProjectSummaryLoadGeneration = 0

watch(
  () => projectRootDraft.value.mpcId,
  (resourceId) => {
    void loadProjectMpcSpec(resourceId)
  },
)

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
      selectedIssueMetric.value = null
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

watch(selectedProjectId, () => {
  void loadSelectedProjectWorkspaceData()
})

watch(projectSources, () => {
  void refreshProjectManifests()
})

function selectProject(projectId: string) {
  selectedProjectId.value = projectId
  expandProjectWorkspaceList(projectId)
  branchDraft.value = null
  popoverWorkspaceId.value = ''
  closeRowActionMenus()
}

function workspacePreviewShowsAll(projectId: string): boolean {
  return searchShowsAll.value || workspacePreviewProjectIds.value.has(projectId)
}

function visibleProjectWorkspaces(project: ProjectManagementProject): ProjectWorkspace[] {
  return previewList(project.workspaces, {
    limit: WORKSPACE_PREVIEW_LIMIT,
    showAll: workspacePreviewShowsAll(project.id),
    selectedId:
      project.id === selectedProjectId.value ? selectedWorkspaceId.value || null : null,
    getId: (workspace) => workspace.id,
  })
}

function workspaceListCanToggle(project: ProjectManagementProject): boolean {
  return !searchShowsAll.value && project.workspaces.length > WORKSPACE_PREVIEW_LIMIT
}

function toggleWorkspacePreview(projectId: string): void {
  const expanded = new Set(workspacePreviewProjectIds.value)
  if (expanded.has(projectId)) {
    expanded.delete(projectId)
  } else {
    expanded.add(projectId)
  }
  workspacePreviewProjectIds.value = expanded
}

function projectWorkspaceListExpanded(projectId: string): boolean {
  return (
    projectId === selectedProjectId.value && !collapsedProjectIds.value.has(projectId)
  )
}

function projectWorkspaceListId(projectId: string): string {
  return `project-workspaces-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function expandProjectWorkspaceList(projectId: string): void {
  if (!collapsedProjectIds.value.has(projectId)) return
  const expanded = new Set(collapsedProjectIds.value)
  expanded.delete(projectId)
  collapsedProjectIds.value = expanded
}

function toggleProjectWorkspaceList(projectId: string): void {
  const collapsed = new Set(collapsedProjectIds.value)
  if (collapsed.has(projectId)) {
    collapsed.delete(projectId)
  } else {
    collapsed.add(projectId)
    popoverWorkspaceId.value = ''
    branchDraft.value = null
    closeRowActionMenus()
  }
  collapsedProjectIds.value = collapsed
}

function writeFailureDetail(fileName: string, error: unknown): string {
  const reason = error instanceof Error && error.message ? ` ${error.message}` : ''
  return `${fileName} could not be updated. Check project path access, then retry.${reason}`
}

function selectWorkspace(workspaceId: string) {
  selectedWorkspaceId.value = workspaceId
  selectedIssueMetric.value = null
  branchDraft.value = null
  closeRowActionMenus()
}

async function applyRouteProjectFocus(): Promise<boolean> {
  const focus = resolveProjectManagementRouteFocus({
    projectRoot: queryString(route.query.projectRoot),
    workspaceId: queryString(route.query.workspaceId),
    projects: projectCards.value.map((project) => ({
      id: project.model.id,
      path: project.model.path,
      workspaces: project.model.workspaces.map((workspace) => ({ id: workspace.id })),
    })),
  })
  if (!focus) return false

  selectProject(focus.projectId)
  if (focus.workspaceId) {
    selectWorkspace(focus.workspaceId)
  }
  await nextTick()
  if (focus.workspaceId) {
    document
      .querySelector(`[data-workspace-id="${cssEscape(focus.workspaceId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  return true
}

function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

function selectStep(step: FlowStep) {
  selectedStep.value = step
  selectedIssueMetric.value = null
  hasOpenedStepAnalysis.value = true
  branchDraft.value = null
  closeRowActionMenus()
}

function selectIssueMetric(metric: string | null) {
  selectedIssueMetric.value = metric
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

async function setQorBaseline(payload: { workspaceId: string }) {
  const project = selectedProject.value
  if (!project.path) return

  try {
    const updated = await mutateProjectManifest(project.path, {
      type: 'select-qor-baseline',
      workspaceId: payload.workspaceId,
      reason: 'Selected from Dashboard QoR Overview',
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
      detail: writeFailureDetail('project.json', error),
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
  closeRowActionMenus()
  popoverWorkspaceId.value = popoverWorkspaceId.value === workspaceId ? '' : workspaceId
  void nextTick(updateWorkspaceFlowPopoverPosition)
}

function closeWorkspaceFlowPopover() {
  popoverWorkspaceId.value = ''
  workspacePopoverStyle.value = {}
}

function updateWorkspaceFlowPopoverPosition() {
  if (!popoverWorkspaceId.value) return
  const trigger = document.querySelector<HTMLElement>(
    `[data-workspace-id="${cssEscape(popoverWorkspaceId.value)}"]`,
  )
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const placement = workspacePopoverPlacementClass(popoverWorkspaceId.value)
  workspacePopoverStyle.value = {
    left: `${rect.right + 14}px`,
    top: `${Math.max(12, placement ? rect.bottom : rect.top - 44)}px`,
  }
}

function toggleProjectActionMenu(projectId: string) {
  projectActionMenuId.value = projectActionMenuId.value === projectId ? null : projectId
  workspaceActionMenuId.value = null
  closeWorkspaceFlowPopover()
}

function toggleWorkspaceActionMenu(workspaceId: string) {
  workspaceActionMenuId.value =
    workspaceActionMenuId.value === workspaceId ? null : workspaceId
  projectActionMenuId.value = null
  closeWorkspaceFlowPopover()
}

function closeRowActionMenus() {
  projectActionMenuId.value = null
  workspaceActionMenuId.value = null
}

function modalElement(modal: ModalId): HTMLElement | null {
  return {
    'new-project': newProjectDialog.value,
    'workspace-draft': workspaceDraftDialog.value,
    'delete-workspace': deleteWorkspaceDialog.value,
    'delete-project': deleteProjectDialog.value,
  }[modal]
}

function modalFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden'))
}

function focusInitialModalElement(modal: ModalId) {
  const dialog = modalElement(modal)
  if (!dialog) return
  const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
  ;(initial ?? modalFocusableElements(dialog)[0])?.focus()
}

function handleModalKeydown(event: KeyboardEvent, modal: ModalId) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeModal(modal)
    return
  }
  if (event.key !== 'Tab') return

  const dialog = modalElement(modal)
  if (!dialog) return
  const focusable = modalFocusableElements(dialog)
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function closeModal(modal: ModalId) {
  if (modal === 'new-project') closeNewProjectDialog()
  if (modal === 'workspace-draft') closeWorkspaceDraftDialog()
  if (modal === 'delete-workspace') closeDeleteWorkspaceDialog()
  if (modal === 'delete-project') closeDeleteProjectDialog()
}

function handleWorkspacePopoverPointerDown(event: PointerEvent) {
  if (
    !popoverWorkspaceId.value &&
    !projectActionMenuId.value &&
    !workspaceActionMenuId.value
  )
    return
  const target = event.target
  if (!(target instanceof Element)) {
    closeWorkspaceFlowPopover()
    closeRowActionMenus()
    return
  }
  if (target.closest('.workspace-flow-popover')) return
  if (target.closest('.workspace-flow-trigger')) return
  if (target.closest('.row-action-menu')) return
  if (target.closest('.row-action-menu-trigger')) return
  closeWorkspaceFlowPopover()
  closeRowActionMenus()
}

function handleWorkspacePopoverKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (popoverWorkspaceId.value) closeWorkspaceFlowPopover()
  if (projectActionMenuId.value || workspaceActionMenuId.value) closeRowActionMenus()
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
      designName: selectedProject.value.designName,
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
  closeRowActionMenus()
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
  const loadedEntries = await mapWithConcurrency(
    projectSources.value,
    PROJECT_MANIFEST_READ_CONCURRENCY,
    async (project): Promise<readonly [string, ProjectManifest] | null> => {
      try {
        const manifestText = await readProjectManagementManifest(project.path)
        return manifestText ? [project.path, parseProjectManifest(manifestText)] : null
      } catch (error) {
        console.warn(`Failed to load project manifest: ${project.path}`, error)
        return null
      }
    },
  )
  const entries = loadedEntries.flatMap((entry) => (entry ? [entry] : []))

  projectManifests.value = Object.fromEntries(
    entries.map(([path, manifest]) => [path, manifest]),
  )
  workspaceFlowStates.value = Object.fromEntries(
    entries.map(([path]) => [path, workspaceFlowStates.value[path] ?? {}]),
  )
  workspaceAnalysisInputs.value = Object.fromEntries(
    entries.map(([path]) => [path, workspaceAnalysisInputs.value[path] ?? {}]),
  )
  void loadSelectedProjectWorkspaceData()
}

async function loadSelectedProjectWorkspaceData() {
  const project = selectedProject.value
  const manifest = projectManifests.value[project.path]
  if (!project.path || !manifest || selectedProjectId.value !== project.id) return

  const projectId = project.id
  const loadGeneration = ++selectedProjectSummaryLoadGeneration
  try {
    const summary = await readProjectManagementWorkspaceData(project.path, manifest)
    if (
      selectedProjectSummaryLoadGeneration !== loadGeneration ||
      selectedProjectId.value !== projectId ||
      projectManifests.value[project.path] !== manifest
    ) {
      return
    }
    workspaceFlowStates.value = {
      ...workspaceFlowStates.value,
      [project.path]: summary.flowStates,
    }
    workspaceAnalysisInputs.value = {
      ...workspaceAnalysisInputs.value,
      [project.path]: summary.analysisInputs,
    }
  } catch (error) {
    if (
      selectedProjectSummaryLoadGeneration === loadGeneration &&
      selectedProjectId.value === projectId
    ) {
      console.warn(
        `Failed to load selected project workspace summaries: ${project.path}`,
        error,
      )
    }
  }
}

async function importProject() {
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const directory = await desktopApi.dialog.pickDirectory({
      title: 'Select Project Folder',
    })
    if (!directory) return

    const project = await loadProjectFromRoot(directory)
    const manifest = await readProjectManifest(project.path)
    projectHistory.value = await rememberProjectHistoryEntry(project)
    projectManifests.value = {
      ...projectManifests.value,
      [project.path]: manifest,
    }
    workspaceFlowStates.value = {
      ...workspaceFlowStates.value,
      [project.path]: {},
    }
    workspaceAnalysisInputs.value = {
      ...workspaceAnalysisInputs.value,
      [project.path]: {},
    }
    const wasSelected = selectedProjectId.value === project.id
    selectedProjectId.value = project.id
    if (wasSelected) void loadSelectedProjectWorkspaceData()
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
  closeRowActionMenus()
  if (!project.path) return
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const directory = await desktopApi.dialog.pickDirectory({
      title: 'Select Workspace Folder',
    })
    if (!directory) return

    const projectRoot = project.path

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
      detail: writeFailureDetail('project.json', error),
    })
  }
}

async function createWorkspaceForProject(project: ProjectManagementProject) {
  closeRowActionMenus()
  if (!project.path) return
  const workspaceId = await nextAvailableWorkspaceId(project)
  if (!workspaceId) return
  await router.push({
    path: '/ecc',
    query: {
      projectRoot: project.path,
      projectName: project.name,
      designName: project.designName,
      workspacePath: joinProjectPath(project.path, workspaceId),
      workspaceId,
    },
  })
}

function requestDeleteWorkspace(workspaceId: string) {
  closeRowActionMenus()
  pendingDeleteWorkspaceId.value = workspaceId
  keepWorkspaceDataOnDelete.value = true
  deleteWorkspaceError.value = ''
}

function closeDeleteWorkspaceDialog() {
  pendingDeleteWorkspaceId.value = null
  keepWorkspaceDataOnDelete.value = true
  deleteWorkspaceError.value = ''
}

async function confirmDeleteWorkspace() {
  const workspaceId = pendingDeleteWorkspaceId.value
  deleteWorkspaceError.value = ''
  const deleted = await deleteWorkspace(workspaceId ?? undefined, {
    keepWorkspaceData: keepWorkspaceDataOnDelete.value,
  })
  if (deleted) closeDeleteWorkspaceDialog()
}

function requestDeleteProject(project: Project) {
  closeRowActionMenus()
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
    deleteWorkspaceError.value = writeFailureDetail('project.json', error)
    showToast({
      severity: 'warn',
      summary: 'Workspace not deleted',
      detail: deleteWorkspaceError.value,
    })
    return false
  }
}

async function nextAvailableWorkspaceId(
  project: ProjectManagementProject,
): Promise<string | null> {
  try {
    const occupiedWorkspaceIds = await listProjectManagementEntries(project.path)
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
  closeRowActionMenus()
  projectRootError.value = ''
  projectRootDraft.value = {
    name: '',
    designName: '',
    directory: '',
    mpcId: '',
  }
  projectMpcs.value = []
  projectMpcLoadError.value = ''
  resetProjectMpcSpec()
  showNewProjectDialog.value = true
  void loadProjectMpcs(++projectMpcLoadGeneration)
}

function closeNewProjectDialog() {
  projectMpcLoadGeneration += 1
  projectMpcSpecLoadGeneration += 1
  showNewProjectDialog.value = false
  projectRootError.value = ''
  resetProjectMpcSpec()
}

async function loadProjectMpcs(generation: number): Promise<void> {
  isLoadingProjectMpcs.value = true
  try {
    const resources = await listResourcesApi()
    if (generation !== projectMpcLoadGeneration) return
    projectMpcs.value = resources.flatMap((resource) => {
      const mpc = projectMpcOptionFromResource(resource)
      return mpc ? [mpc] : []
    })
  } catch (error) {
    console.warn('Failed to load managed MPC resources.', error)
    if (generation !== projectMpcLoadGeneration) return
    projectMpcLoadError.value = 'Unable to load managed MPC resources.'
  } finally {
    if (generation === projectMpcLoadGeneration) {
      isLoadingProjectMpcs.value = false
    }
  }
}

function resetProjectMpcSpec() {
  projectMpcDesigns.value = []
  selectedProjectMpcDesignIndex.value = null
  isLoadingProjectMpcSpec.value = false
  projectMpcSpecError.value = ''
}

async function loadProjectMpcSpec(resourceId: string): Promise<void> {
  const generation = ++projectMpcSpecLoadGeneration
  resetProjectMpcSpec()
  if (!resourceId) return

  const candidate = projectMpcs.value.find((mpc) => mpc.resource_id === resourceId)
  if (!candidate) {
    projectMpcSpecError.value = 'The selected MPC is no longer available.'
    return
  }

  isLoadingProjectMpcSpec.value = true
  try {
    const result = await readMpcSpecApi(resourceId)
    if (generation !== projectMpcSpecLoadGeneration) return
    if (
      result.resource_id !== candidate.resource_id ||
      result.installed_version !== candidate.installed_version ||
      normalizePath(result.spec_path) !== normalizePath(candidate.spec_path)
    ) {
      throw new Error('The selected MPC changed while its specification was loading.')
    }
    const designs = parseMpcSpecDesigns(result.spec)
    projectMpcDesigns.value = designs
    selectedProjectMpcDesignIndex.value = designs[0].index
  } catch (error) {
    if (generation !== projectMpcSpecLoadGeneration) return
    console.warn('Failed to load MPC design specification.', error)
    projectMpcSpecError.value =
      error instanceof Error
        ? error.message
        : 'Unable to read the selected MPC specification.'
  } finally {
    if (generation === projectMpcSpecLoadGeneration) {
      isLoadingProjectMpcSpec.value = false
    }
  }
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

  if (projectRootDraft.value.mpcId && isLoadingProjectMpcSpec.value) {
    projectRootError.value = 'Wait for the selected MPC specification to load.'
    return
  }

  if (projectRootDraft.value.mpcId && !selectedProjectMpc.value) {
    projectRootError.value =
      projectMpcSpecError.value ||
      'Select a valid MPC design before creating the project.'
    return
  }

  const name = projectRootDraft.value.name.trim() || basenamePath(directory) || 'project'
  const designName = projectRootDraft.value.designName.trim() || name
  const manifest = await mutateProjectManifest(directory, {
    type: 'create',
    name,
    designName,
    mpc: selectedProjectMpc.value,
  })
  await applyProjectManifestForProject(manifest, manifest.root_path)
  selectedProjectId.value = manifest.root_path
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

function workspacePopoverPlacementClass(workspaceId: string): string {
  const workspaces = visibleProjectWorkspaces(selectedProject.value)
  const index = workspaces.findIndex((workspace) => workspace.id === workspaceId)
  return index >= Math.ceil(workspaces.length / 2) ? 'workspace-flow-popover--above' : ''
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

async function readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  const manifestText = await readProjectManagementManifest(projectRoot)
  if (!manifestText) throw new Error('Project manifest does not exist.')
  return parseProjectManifest(manifestText)
}

async function applyProjectManifestForProject(
  manifest: ProjectManifest,
  projectRoot: string,
) {
  const normalizedRoot = normalizePath(manifest.root_path || projectRoot)
  projectManifests.value = {
    ...projectManifests.value,
    [projectRoot]: manifest,
    [normalizedRoot]: manifest,
  }
  workspaceFlowStates.value = {
    ...workspaceFlowStates.value,
    [projectRoot]: {},
    [normalizedRoot]: {},
  }
  workspaceAnalysisInputs.value = {
    ...workspaceAnalysisInputs.value,
    [projectRoot]: {},
    [normalizedRoot]: {},
  }
  projectHistory.value = await rememberProjectHistoryEntry(
    projectFromManifest(manifest, normalizedRoot),
  )
  if (
    selectedProjectId.value === projectRoot ||
    selectedProjectId.value === normalizedRoot
  ) {
    void loadSelectedProjectWorkspaceData()
  }
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
