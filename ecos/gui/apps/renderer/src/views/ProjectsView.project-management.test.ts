import { readFileSync } from 'node:fs'
import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
} from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import source from './ProjectsView.vue?raw'
import analysisSource from './project-management/ProjectAnalysisPanel.vue?raw'
import presentationSource from './project-management/projectAnalysisPresentation.ts?raw'
import analysisDataSource from './project-management/projectWorkspaceAnalysisData.ts?raw'

const normalizedSource = source.replace(/\s+/g, ' ')
const projectStyles = readFileSync(
  new URL('./project-management/projectsView.css', import.meta.url),
  'utf8',
)
const analysisStyles = readFileSync(
  new URL('./project-management/projectAnalysisPanel.css', import.meta.url),
  'utf8',
)
const projectSurfaceSource = `${source}\n${projectStyles}`
const analysisSurfaceSource = `${analysisSource}\n${analysisStyles}`

describe('ProjectsView project management surface', () => {
  it('applies route focus so Back to Project Management selects the current workspace', () => {
    expect(source).toContain('resolveProjectManagementRouteFocus')
    expect(source).toContain('applyRouteProjectFocus')
    expect(source).toContain('useRoute')
    expect(source).toContain('route.query.projectRoot')
    expect(source).toContain('route.query.workspaceId')
    expect(source).toContain('data-workspace-id')
    expect(source).toContain('scrollIntoView')
    expect(source).toContain('selectWorkspace(')
  })

  it('renders the project tree and project analysis surface instead of the old flow matrix', () => {
    expect(source).toContain('ProjectAnalysisPanel')
    expect(analysisSource).toContain('aria-label="Analysis"')
    expect(analysisSource).toContain('analysis-subtitle')
    expect(analysisSource).not.toContain('>Analysis</h3>')
    expect(analysisSource).not.toContain('Key Metric Snapshot')
    expect(analysisSource).toContain('Dashboard')
    expect(analysisSource).toContain('Step Analysis')
    expect(source).toContain('class="project-workspace-tree"')
    expect(source).toContain('class="workspace-tree-list"')
    expect(source).toContain('workspace-flow-popover')
    expect(source).toContain('selectedAnalysisTab')
    expect(source).not.toContain('Workspace Flow Matrix')
    expect(source).not.toContain('class="flow-matrix"')
    expect(source).not.toContain('class="flow-row"')
    expect(source).not.toContain('class="flow-cell"')
  })

  it('uses the Resource Manager shell and panel style classes', () => {
    expect(source).toContain('class="resource-manager-view"')
    expect(source).toContain('class="manager-dialog"')
    expect(source).toContain('class="manager-grid"')
    expect(source).toContain('class="manager-sidebar"')
    expect(source).toContain('class="manager-table-panel"')
    expect(source).toContain('class="project-list-panel"')
    expect(source).toContain('class="resource-row project-tree-row mockup-project-row"')
    expect(source).not.toContain('class="selected-panel"')
    expect(source).not.toContain('class="sidebar-info-panel project-info-panel"')
    expect(source).not.toContain('class="sidebar-info-panel selection-info-panel"')
  })

  it('matches the analysis brainstorm mockup proportions and popover anchoring', () => {
    expect(source).not.toContain(
      'Workspace lineage tree with row actions + Project Analysis dashboard',
    )
    expect(source).not.toContain('<p>Workspace lineage tree')
    expect(source).toContain('class="project-list-toolbar"')
    expect(source).not.toContain('<h2>Projects</h2>')
    expect(source).toContain('class="project-list-actions"')
    expect(projectSurfaceSource).toContain(
      'grid-template-columns: minmax(330px, 390px) minmax(780px, 1fr);',
    )
    expect(projectSurfaceSource).not.toContain('.manager-scrim {')
    expect(projectSurfaceSource).not.toContain('.blurred-home {')
    expect(projectSurfaceSource).toContain('.workspace-flow-popover::before')
    expect(projectSurfaceSource).toContain('left: calc(100% + 14px);')
    expect(source).toContain('class="resource-row project-tree-row mockup-project-row"')
    expect(analysisSource).toContain('class="analysis-panel mockup-analysis-panel"')
    expect(analysisStyles).toContain('position: sticky;')
    expect(analysisStyles).not.toContain('.compare-best')
    expect(projectStyles).toContain('.workspace-tree-row.selected')
    expect(source).toContain(
      ':class="{ selected: workspace.id === selectedWorkspaceId }"',
    )
  })

  it('uses theme-mixed colors for the Projects list background', () => {
    expect(projectSurfaceSource).toContain(
      '--project-list-bg: color-mix(in srgb, var(--bg-secondary) 82%, var(--bg-primary));',
    )
    expect(projectSurfaceSource).toContain('background: var(--project-list-bg);')
    expect(projectSurfaceSource).toContain(
      '--project-tree-bg: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));',
    )
    expect(projectSurfaceSource).not.toContain('--mockup-soft: #f3f4f6')
    expect(projectSurfaceSource).not.toContain('--mockup-bg: #f9fafb')
  })

  it('keeps the Projects toolbar fixed while the workspace tree scrolls vertically', () => {
    const projectListStart = projectStyles.indexOf('.project-list {')
    const projectListEnd = projectStyles.indexOf(
      '.project-workspace-tree {',
      projectListStart,
    )
    const projectListStyles = projectStyles.slice(projectListStart, projectListEnd)

    expect(projectListStyles).toContain('overflow-y: auto;')
    expect(projectListStyles).toContain('overflow-x: hidden;')
    expect(projectListStyles).toContain('scrollbar-gutter: stable;')
    expect(source).not.toContain("'project-list--popover-open': Boolean(popoverWorkspaceId)")
    expect(source).not.toContain('popoverWorkspaceId || projectActionMenuId')
    expect(projectStyles).not.toContain('.project-list--popover-open {')
  })

  it('opens the final workspace action menu upward within the scrollable list', () => {
    const finalWorkspaceMenuStart = projectStyles.indexOf(
      '.workspace-tree-list > .workspace-tree-item:last-of-type .row-action-menu {',
    )
    const finalWorkspaceMenuEnd = projectStyles.indexOf('}\n', finalWorkspaceMenuStart)
    const finalWorkspaceMenuStyles = projectStyles.slice(
      finalWorkspaceMenuStart,
      finalWorkspaceMenuEnd,
    )

    expect(finalWorkspaceMenuStart).toBeGreaterThan(-1)
    expect(finalWorkspaceMenuStyles).toContain('top: auto;')
    expect(finalWorkspaceMenuStyles).toContain('bottom: calc(100% + 6px);')
  })

  it('caps long project and workspace lists without hiding the active selection', () => {
    expect(source).toContain('v-for="project in visibleProjectCards"')
    expect(source).toContain('visibleProjectWorkspaces(project.model)')
    expect(source).toContain('const PROJECT_PREVIEW_LIMIT = 20')
    expect(source).toContain('const WORKSPACE_PREVIEW_LIMIT = 20')
    expect(source).toContain('const projectPreviewShowsAll = ref(false)')
    expect(source).toContain(
      'const workspacePreviewProjectIds = ref<Set<string>>(new Set())',
    )
    expect(source).toContain('previewList(projectCards.value')
    expect(source).toContain('selectedId: selectedProjectId.value')
    expect(normalizedSource).toContain(
      'selectedId: project.id === selectedProjectId.value ? selectedWorkspaceId.value || null : null',
    )
    expect(source).toContain('Show all ${projectCards.length} projects')
    expect(source).toContain('Show all ${project.model.workspaces.length} workspaces')
    expect(source).toContain('class="list-preview-toggle project-list-preview-toggle"')
    expect(source).toContain('class="list-preview-toggle workspace-list-preview-toggle"')
    expect(projectStyles).toContain('.workspace-tree-list.has-preview-control::before')
    expect(projectStyles).toContain('.list-preview-toggle')
  })

  it('provides a maximize toggle for the project management dialog', () => {
    expect(source).toContain(':class="{ maximized: isDialogMaximized }"')
    expect(source).toContain('toggleDialogMaximized')
    expect(source).toContain('ri-expand-diagonal-line')
    expect(source).toContain('ri-collapse-diagonal-line')
    expect(projectStyles).toContain('.manager-dialog.maximized')
  })

  it('keeps project actions beside, not inside, the project selection button', () => {
    const projectRowStart = source.indexOf(
      'class="resource-row project-tree-row mockup-project-row"',
    )
    const projectRowEnd = source.indexOf('class="workspace-tree-list"', projectRowStart)
    const rowSource = source.slice(projectRowStart, projectRowEnd)

    expect(rowSource).toContain('project-tree-actions')
    expect(rowSource).toContain('class="row-primary-action"')
    expect(rowSource).toContain('<span>New</span>')
    expect(rowSource).toContain('class="row-action-menu"')
    expect(rowSource).toContain('Import workspace')
    expect(rowSource).toContain('Remove project')
    expect(source).toContain('class="project-tree-row-shell"')
    expect(rowSource).toContain('type="button"')
    expect(rowSource).toContain(':aria-pressed="project.model.id === selectedProjectId"')
    expect(rowSource).toContain('@click="importWorkspaceIntoProject(project.model)"')
    expect(rowSource).toContain('@click="createWorkspaceForProject(project.model)"')
    expect(rowSource).toContain('@click="requestDeleteProject(project.source)"')
    expect(rowSource).toContain('toggleProjectActionMenu(project.model.id)')
    expect(rowSource).toContain('aria-haspopup="menu"')
    expect(rowSource).not.toContain('file-action-button')
    expect(rowSource).toContain('ri-add-line')
    expect(rowSource).toContain('ri-file-add-line')
    expect(rowSource).toContain('ri-delete-bin-line')
    expect(rowSource).not.toContain('circle-glyph')
    expect(projectStyles).toContain('.project-tree-row-shell')
    expect(projectStyles).not.toContain('.project-tree-row:hover .row-action-secondary')
  })

  it('lets the selected project collapse its workspace list without hiding its summary', () => {
    expect(source).toContain('class="circle-action project-collapse-toggle"')
    expect(source).toContain('projectWorkspaceListExpanded(project.model.id)')
    expect(source).toContain('toggleProjectWorkspaceList(project.model.id)')
    expect(source).toContain('projectWorkspaceListId(project.model.id)')
    expect(source).toContain('Collapse workspaces')
    expect(source).toContain('Expand workspaces')
    expect(source).toContain('ri-arrow-down-s-line')
    expect(source).toContain('ri-arrow-right-s-line')
    expect(source).toContain('const collapsedProjectIds = ref<Set<string>>(new Set())')
    expect(source).toContain('expandProjectWorkspaceList(projectId)')
    expect(projectStyles).toContain('.project-workspace-tree.selected.collapsed')
    expect(projectStyles).toContain(".project-collapse-toggle[aria-expanded='true']")
    expect(source).toContain('class="project-tree-disclosure-spacer"')
    const treeShellStart = source.indexOf('class="project-tree-row-shell"')
    const disclosureStart = source.indexOf(
      'class="circle-action project-collapse-toggle"',
    )
    const projectRowStart = source.indexOf(
      'class="resource-row project-tree-row mockup-project-row"',
    )
    expect(disclosureStart).toBeGreaterThan(treeShellStart)
    expect(disclosureStart).toBeLessThan(projectRowStart)
    expect(projectStyles).toContain('grid-template-columns: 24px minmax(0, 1fr) auto;')
  })

  it('keeps explicit Import and New Project commands in the Projects list header', () => {
    const titleStart = source.indexOf('class="project-list-toolbar"')
    const titleEnd = source.indexOf('</div>\n            <div', titleStart)
    const headerSource = source.slice(
      titleStart,
      titleEnd > titleStart ? titleEnd : titleStart + 800,
    )

    expect(source).not.toContain('class="manager-header-actions"')
    expect(headerSource).toContain('class="project-list-actions"')
    expect(headerSource).toContain('class="project-toolbar-action"')
    expect(headerSource).toContain('class="project-toolbar-action primary"')
    expect(headerSource).toContain('<span>Import</span>')
    expect(headerSource).toContain('<span>New project</span>')
    expect(headerSource).toContain('ri-file-add-line')
    expect(headerSource).toContain('ri-add-line')
    expect(source).toContain('aria-label="Search projects or workspaces"')
  })

  it('renders keyboard-reachable workspace selection and separate row actions', () => {
    expect(source).toContain(
      'v-for="workspace in visibleProjectWorkspaces(project.model)"',
    )
    expect(source).toContain('workspaceDepthStyle(workspace)')
    expect(source).toContain('workspace.flowStatusHint.label')
    expect(source).toContain('flowStatusHintClass(workspace.flowStatusHint.state)')

    const workspaceRowStart = source.indexOf('class="workspace-tree-item"')
    const workspaceRowEnd = source.indexOf('workspace-flow-popover', workspaceRowStart)
    const rowSource = source.slice(workspaceRowStart, workspaceRowEnd)
    expect(rowSource).toContain('class="row-primary-action"')
    expect(rowSource).toContain('<span>Open</span>')
    expect(rowSource).toContain('Create from output')
    expect(rowSource).toContain('Delete workspace')
    expect(rowSource).toContain('class="workspace-tree-row-shell"')
    expect(rowSource).toContain(':aria-pressed="workspace.id === selectedWorkspaceId"')
    expect(rowSource).toContain('@click="selectWorkspace(workspace.id)"')
    expect(rowSource).toContain('@click="openWorkspace(workspace)"')
    expect(rowSource).toContain('@click="toggleWorkspaceFlowPopover(workspace.id)"')
    expect(rowSource).toContain('@click="requestDeleteWorkspace(workspace.id)"')
    expect(rowSource).toContain('circle-action')
    expect(rowSource).toContain('toggleWorkspaceActionMenu(workspace.id)')
    expect(rowSource).toContain('class="row-action-menu-item workspace-flow-trigger"')
    expect(rowSource).not.toContain('file-action-button')
    expect(projectStyles).toContain('.workspace-tree-row-shell')
    expect(projectStyles).not.toContain('.workspace-tree-row:hover .row-action-secondary')
  })

  it('preserves project navigation at narrow desktop widths and removes side-stripe selection', () => {
    const narrowStyles = projectStyles.slice(
      projectStyles.indexOf('@media (max-width: 900px)'),
    )

    expect(narrowStyles).toContain(
      'grid-template-rows: minmax(180px, 34vh) minmax(0, 1fr);',
    )
    expect(narrowStyles).toContain('.manager-sidebar {')
    expect(narrowStyles).not.toContain('.manager-sidebar {\n    display: none;')
    expect(projectStyles).not.toContain('.project-workspace-tree.selected::before')
    expect(projectStyles).not.toContain('box-shadow: inset 3px 0 0 var(--accent-color);')
  })

  it('uses an explicit Open action with an up-right icon for workspace rows', () => {
    expect(source).toContain('<i class="ri-arrow-right-up-line" aria-hidden="true"></i>')
    expect(source).toContain('class="row-primary-action"')
    expect(projectStyles).toContain('.circle-action i')
    expect(projectStyles).not.toContain('.circle-glyph')
  })

  it('shows a near-row flow step popover for successful source steps', () => {
    expect(source).toContain('popoverWorkspaceId')
    expect(source).toContain('selectedPopoverWorkspace')
    expect(source).toContain('workspaceConfiguredSteps(selectedPopoverWorkspace)')
    expect(source).toContain('cell.canCreateWorkspace')
    expect(source).toMatch(
      /startWorkspaceFromPopoverStep\(\s*selectedPopoverWorkspace\.id,\s*cell\.step,\s*\)/,
    )
    expect(source).toContain('Workspace Flow Steps')
  })

  it('opens lower workspace flow popovers upward so they stay visible', () => {
    expect(source).toContain("'workspace-flow-popover--above'")
    expect(source).toContain('index >= Math.ceil(workspaces.length / 2)')
    expect(projectStyles).toContain('.workspace-flow-popover--above')
    expect(projectStyles).toContain('position: fixed;')
    expect(projectStyles).toContain('transform: translateY(-100%);')
  })

  it('keeps the project list scroll container unchanged while the popover is open', () => {
    expect(source).not.toContain("'project-list--popover-open'")
    expect(projectStyles).not.toContain('.project-list--popover-open')
    expect(source).toContain('updateWorkspaceFlowPopoverPosition')
    expect(source).toContain("window.addEventListener('scroll', updateWorkspaceFlowPopoverPosition, true)")
    expect(source).toContain("window.removeEventListener('scroll', updateWorkspaceFlowPopoverPosition, true)")
    expect(source).toContain('`[data-workspace-id="${cssEscape(popoverWorkspaceId.value)}"]`')
  })

  it('closes the workspace flow popover from outside clicks or Escape', () => {
    expect(source).toContain('workspace-flow-trigger')
    expect(source).toContain(
      "document.addEventListener('pointerdown', handleWorkspacePopoverPointerDown)",
    )
    expect(source).toContain(
      "document.addEventListener('keydown', handleWorkspacePopoverKeydown)",
    )
    expect(source).toContain(
      "document.removeEventListener('pointerdown', handleWorkspacePopoverPointerDown)",
    )
    expect(source).toContain(
      "document.removeEventListener('keydown', handleWorkspacePopoverKeydown)",
    )
    expect(source).toContain("target.closest('.workspace-flow-popover')")
    expect(source).toContain("target.closest('.workspace-flow-trigger')")
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).toContain('closeWorkspaceFlowPopover()')
  })

  it('requires confirmation before deleting workspace or project entries', () => {
    expect(source).toContain('pendingDeleteWorkspaceId')
    expect(source).toContain('keepWorkspaceDataOnDelete')
    expect(source).toContain('pendingDeleteProject')
    expect(source).toContain('confirmDeleteWorkspace')
    expect(source).toContain('confirmDeleteProject')
    expect(source).toContain('Delete Workspace')
    expect(source).toContain('Remove from Project Management')
    expect(source).toContain('Keep workspace data')
    expect(source).toContain('checked by default')
    expect(source).toContain('const keepWorkspaceDataOnDelete = ref(true)')
    expect(source).toContain('deleteDirectory: !options.keepWorkspaceData')
    expect(source).not.toContain('prepareProjectDirectoryReplacement')
    expect(source).not.toContain('restoreProjectDirectoryReplacement')
    expect(source).not.toContain('finalizeProjectDirectoryReplacement')
    expect(source).toContain('nextAvailableWorkspaceId')
    expect(normalizedSource).toContain(
      'The project folder and project.json on disk will be kept',
    )
    expect(source).toContain('writeFailureDetail')
    expect(source).toContain('Check project path access, then retry.')
    expect(source).toContain('deleteWorkspaceError')
    expect(source).toContain("deleteWorkspaceError ? 'Retry delete' : 'Delete'")
  })

  it('traps focus and restores it for every modal project-management workflow', () => {
    expect(source).toContain('const activeModal = computed<ModalId | null>')
    expect(source).toContain('modalFocusReturnTarget')
    expect(source).toContain('handleModalKeydown')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain("event.key !== 'Tab'")
    expect(source).toContain('data-dialog-initial-focus')
    expect(source).toContain('ref="newProjectDialog"')
    expect(source).toContain('ref="workspaceDraftDialog"')
    expect(source).toContain('ref="deleteWorkspaceDialog"')
    expect(source).toContain('ref="deleteProjectDialog"')
  })

  it('keeps mounted analysis panels and exposes comparison grids semantically', () => {
    expect(analysisSource).toContain('v-if="hasProjectData"')
    expect(analysisSource).toContain('v-show="selectedAnalysisTab === \'dashboard\'"')
    expect(analysisSource).toContain('v-show="selectedAnalysisTab === \'step\'"')
    expect(analysisSource).toContain('role="grid"')
    expect(analysisSource).toContain('role="columnheader"')
    expect(analysisSource).toContain('role="rowheader"')
    expect(analysisSource).toContain('role="gridcell"')
  })

  it('searches both projects and their workspaces', () => {
    expect(source).toContain('placeholder="Search project or workspace"')
    expect(source).toContain('projectCardMatchesSearch')
    expect(source).toContain('workspaceMatchesSearch')
    expect(source).toContain('project.model.workspaces.some')
  })

  it('passes source artifacts when creating a workspace from a successful step', () => {
    const continueStart = source.indexOf('async function continueWorkspaceDraft')
    const continueEnd = source.indexOf('async function openWorkspace', continueStart)
    const continueSource = source.slice(continueStart, continueEnd)
    expect(continueSource).toContain('originDef: branchDraft.value.originDef')
    expect(continueSource).toContain('originVerilog: branchDraft.value.originVerilog')
    expect(continueSource).toContain('sdc: branchDraft.value.originSdc')
    expect(continueSource).toContain(
      'sourceWorkspacePath: branchDraft.value.sourceWorkspacePath',
    )
    expect(continueSource).toContain(
      'sourceOutputPath: branchDraft.value.sourceOutputPath',
    )
    expect(continueSource).toContain(
      'sourceOutputType: branchDraft.value.sourceOutputType',
    )
    expect(continueSource).toContain('startStep: branchDraft.value.targetStartStep')
    expect(continueSource).toContain('endStep: branchDraft.value.targetEndStep')
  })

  it('lets New Project create a root manifest with an optional managed MPC association', () => {
    expect(source).toContain('Project Storage Location')
    expect(source).toContain('Managed MPC')
    expect(source).toContain('listResourcesApi')
    expect(source).toContain('projectMpcOptionFromResource')
    expect(source).toContain('readMpcSpecApi')
    expect(source).toContain('parseMpcSpecDesigns')
    expect(source).toContain('MpcTemplatePreview')
    expect(source).toContain('selectedProjectMpcDesignIndex')
    expect(source).toContain('selectProjectStorageLocation')
    expect(source).toContain('createProjectFolderDraft')
    expect(source).toContain('mutateProjectManifest')

    const createStart = source.indexOf('async function createProjectFolderDraft')
    const createEnd = source.indexOf('const goBack =', createStart)
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).not.toContain('router.push({')
    expect(createSource).not.toContain("path: '/ecc'")
    expect(createSource).not.toContain('workspacePath')
    expect(createSource).not.toContain("workspaces', 'ws_0001'")
    expect(createSource).toContain('mpc: selectedProjectMpc.value')
    expect(createSource).toContain(
      'Select a valid MPC design before creating the project.',
    )
  })

  it('renders an empty state instead of generated demo workspace data', () => {
    expect(analysisSource).toContain('No project data available')
    expect(analysisSource).toContain('hasProjectData')
    expect(analysisSource).toContain("emit('import-project')")
    expect(analysisSource).toContain("emit('new-project')")
    expect(source).toContain('@import-project="importProject"')
    expect(source).toContain('@new-project="openNewProjectDialog"')
    expect(source).toContain('No projects yet')
    expect(source).toContain('No matching projects')
    expect(source).toContain('No workspaces yet')
    expect(source).toContain('Clear search')
    expect(source).not.toContain('gcd_backend')
    expect(source).not.toContain('iter_0001')
  })

  it('shows project workspace counts instead of project status pills in the project list', () => {
    expect(source).toContain('workspaceCountLabel(project.model.workspaces.length)')
    expect(source).not.toContain('status-pill')
    expect(source).not.toContain('statusLabel(project.source.status)')
    expect(source).not.toContain('Not Started')
  })

  it('loads V3 analysis artifacts and flow states for project analysis', () => {
    expect(source).toContain('workspaceFlowStates')
    expect(analysisDataSource).toContain('readProjectManagementWorkspaceTexts')
    expect(analysisDataSource).toContain('parseWorkspaceFlowStateMap')
    expect(source).toContain('workspaceAnalysisInputs')
    expect(source).toContain('readProjectManagementWorkspaceData')
    expect(source).toContain('ProjectWorkspaceAnalysisInputsById')
    expect(analysisDataSource).toContain('projectManagementWorkspaceStepAnalysisSpecs')
    expect(analysisDataSource).toContain('WORKSPACE_STEP_ANALYSIS_SPECS')
    expect(projectManagementWorkspaceStepAnalysisSpecs).toContainEqual(
      expect.objectContaining({
        metricsPath: 'Synthesis_yosys/analysis/qor_metrics.json',
        summaryPath: 'Synthesis_yosys/analysis/qor_summary.json',
        hotspotsPath: 'Synthesis_yosys/analysis/qor_hotspots.json',
      }),
    )
    expect(projectManagementWorkspaceStepAnalysisSpecs).toContainEqual(
      expect.objectContaining({ metricsPath: 'route_ecc/analysis/qor_metrics.json' }),
    )
    expect(projectManagementStaTimingIssuesPath).toBe(
      'sta_ecc/analysis/sta_timing_issues.json',
    )
    expect(analysisDataSource).toContain('stepMetricTexts')
    expect(analysisDataSource).toContain('stepSummaryTexts')
    expect(analysisDataSource).toContain('stepHotspotTexts')
    expect(analysisDataSource).not.toContain('/feature/')
    expect(analysisDataSource).not.toContain('sta_ecc/output')
    expect(analysisDataSource).not.toContain('Synthesis_metrics.json')
  })

  it('wires the analysis panel to the shared project snapshot', () => {
    expect(analysisSource).toContain('project.dashboardSummary')
    expect(analysisSource).toContain('project.qorTrendSummary')
    expect(analysisSource).toContain('ProjectStepAnalysisPanel')
    expect(analysisSource).toContain(':workspace-summaries="project.workspaceSummaries"')
    expect(analysisSource).toContain(':steps="project.stepCompareSummaries"')
    expect(presentationSource).toContain('runtimePoints')
    expect(presentationSource).toContain('memoryPoints')
    expect(analysisSurfaceSource).toContain('.analysis-dashboard {')
    expect(analysisSurfaceSource).toContain('overflow-y: auto;')
  })

  it('keeps the Step Analysis entry points in ProjectsView', () => {
    expect(source).toContain('const hasOpenedStepAnalysis = ref(false)')
    expect(source).toContain('handleAnalysisTabSelection')
    expect(source).toContain('setQorBaseline')
    expect(source).toContain('function openStepAnalysis()')
    expect(source).toContain("selectedStep.value = 'Synth'")
    expect(source).toContain('hasOpenedStepAnalysis.value = true')
    expect(source).not.toContain('selectedStepComparePoints')
  })

  it('keeps only Dashboard and Step Analysis tabs on the right side of the project analysis header', () => {
    const analysisStart = analysisSource.indexOf('class="analysis-heading"')
    const analysisEnd = analysisSource.indexOf(
      '</div>',
      analysisSource.indexOf('class="analysis-tabs"', analysisStart),
    )
    const analysisHeaderSource = analysisSource.slice(analysisStart, analysisEnd + 6)

    expect(analysisHeaderSource).toContain('class="analysis-subtitle"')
    expect(analysisHeaderSource).toContain('class="analysis-tabs"')
    expect(analysisHeaderSource).toContain('Dashboard')
    expect(analysisHeaderSource).toContain('Step Analysis')
    expect(analysisHeaderSource).not.toContain('Backend Design')
    expect(analysisHeaderSource).not.toContain('toolbar-action')
    expect(source).not.toContain('openBackendDesign')
    expect(analysisSurfaceSource).toContain('.analysis-heading {')
    expect(analysisSurfaceSource).toContain('justify-content: space-between;')
    expect(analysisSurfaceSource).toContain('.analysis-subtitle {')
    expect(analysisSurfaceSource).not.toContain('.analysis-header-actions {')
  })

  it('connects analysis tabs to their panels and supports keyboard tab movement', () => {
    expect(analysisSource).toContain('id="analysis-tab-dashboard"')
    expect(analysisSource).toContain('aria-controls="analysis-dashboard-panel"')
    expect(analysisSource).toContain('id="analysis-dashboard-panel"')
    expect(analysisSource).toContain('role="tabpanel"')
    expect(analysisSource).toContain('handleAnalysisTabKeydown')
    expect(analysisSource).toContain('analysis-context')
  })

  it('keeps the workspace flow popover inside the project manager bounds', () => {
    expect(source).toContain('workspacePopoverPlacementClass(workspace.id)')
    expect(source).toContain(':class="workspacePopoverPlacementClass(workspace.id)"')
    expect(source).not.toContain('workspace-popover-flip')
    expect(projectSurfaceSource).toContain('max-width: min(322px, calc(100vw - 80px));')
    expect(projectSurfaceSource).toContain('left: calc(100% + 14px);')
    expect(projectSurfaceSource).not.toContain('right: calc(100% + 14px);')
  })

  it('uses dedicated project history instead of workspace recent records', () => {
    expect(source).toContain('loadProjectHistory')
    expect(source).toContain('rememberProjectHistoryEntry')
    expect(source).toContain('removeProjectHistoryEntry')
    expect(source).toContain('projectHistory')
    expect(source).not.toContain('recentProjects')
    expect(source).not.toContain('loadRecentProjects')
    expect(source).not.toContain('localProjectDrafts')
  })

  it('uses the dedicated read-only Project Management API for historical projects', () => {
    expect(source).toContain('readProjectManagementManifest')
    expect(source).toContain('readProjectManagementWorkspaceData')
    expect(source).toContain('listProjectManagementEntries')
    expect(source).not.toContain('registerProjectRootForProjectManagement')
    expect(source).not.toContain('registerProjectReadRootForProjectManagement')
    expect(source).not.toContain('desktopApi.workspace.registerProjectRoot')

    const createStart = source.indexOf('async function createProjectFolderDraft')
    const createMutation = source.indexOf(
      'await mutateProjectManifest(directory,',
      createStart,
    )
    expect(createMutation).toBeGreaterThan(createStart)

    const importStart = source.indexOf('async function importProject')
    const importRead = source.indexOf('await loadProjectFromRoot(directory)', importStart)
    expect(importRead).toBeGreaterThan(importStart)

    const refreshStart = source.indexOf('async function refreshProjectManifests')
    const refreshRead = source.indexOf(
      'await readProjectManagementManifest(project.path)',
      refreshStart,
    )
    expect(refreshRead).toBeGreaterThan(refreshStart)

    const nextWorkspaceStart = source.indexOf('async function nextAvailableWorkspaceId')
    const nextWorkspaceRead = source.indexOf(
      'await listProjectManagementEntries(project.path)',
      nextWorkspaceStart,
    )
    expect(nextWorkspaceRead).toBeGreaterThan(nextWorkspaceStart)
  })

  it('bounds historical project manifest reads without replacing the active workspace root', () => {
    expect(source).toContain('let projectManifestRefreshQueue = Promise.resolve()')

    const refreshStart = source.indexOf('async function refreshProjectManifestsNow')
    const refreshEnd = source.indexOf(
      'async function loadSelectedProjectWorkspaceData',
      refreshStart,
    )
    const refreshSource = source.slice(refreshStart, refreshEnd)

    expect(source).toContain('function refreshProjectManifests(): Promise<void>')
    expect(source).toContain(
      "import { mapWithConcurrency } from './project-management/asyncConcurrency'",
    )
    expect(source).toContain('const PROJECT_MANIFEST_READ_CONCURRENCY = 2')
    expect(refreshSource).toContain('mapWithConcurrency(')
    expect(refreshSource).toContain('PROJECT_MANIFEST_READ_CONCURRENCY')
    expect(refreshSource).toContain('readProjectManagementManifest(project.path)')
    expect(refreshSource).not.toContain('readProjectManagementWorkspaceData(')
    expect(refreshSource).toContain('void loadSelectedProjectWorkspaceData()')
    expect(refreshSource).not.toContain('registerProjectRootForProjectManagement')
  })

  it('loads workspace summaries only for the selected project and ignores stale selections', () => {
    expect(source).toContain('watch(selectedProjectId')
    expect(source).toContain('loadSelectedProjectWorkspaceData')
    expect(source).toContain('let selectedProjectSummaryLoadGeneration = 0')
    expect(source).toContain('selectedProjectSummaryLoadGeneration !== loadGeneration')
    expect(source).toContain('selectedProjectId.value !== projectId')
    expect(source).toContain('projectManifests.value[project.path] !== manifest')
    expect(source).toContain(
      'if (!project.path || !manifest || selectedProjectId.value !== project.id)',
    )
  })

  it('persists project history when project.json is updated', () => {
    const writeStart = source.indexOf('async function applyProjectManifestForProject')
    const writeRemember = source.indexOf('await rememberProjectHistoryEntry(', writeStart)
    const writeProjectFromManifest = source.indexOf(
      'projectFromManifest(manifest, normalizedRoot)',
      writeStart,
    )

    expect(writeRemember).toBeGreaterThan(writeStart)
    expect(writeProjectFromManifest).toBeGreaterThan(writeStart)
    expect(source).not.toContain('projectHistory.value = projectHistory.value.map')
  })

  it('only resets workspace selection when the active project changes', () => {
    expect(source).toContain('resolveProjectSelectionUpdate')
    expect(source).toContain('let activeProjectKey: string | null = null')
    expect(source).toContain("update.mode === 'reset'")
    expect(source).toContain("update.mode === 'reconcile-workspace'")
  })
})
