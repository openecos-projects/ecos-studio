import { readFileSync } from 'node:fs'
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
  it('renders the project tree and project analysis surface instead of the old flow matrix', () => {
    expect(source).toContain('ProjectAnalysisPanel')
    expect(analysisSource).toContain('Project Analysis')
    expect(analysisSource).toContain('Dashboard')
    expect(analysisSource).toContain('Step Analysis')
    expect(source).toContain('class="project-workspace-tree"')
    expect(source).toContain('class="workspace-tree-list"')
    expect(source).toContain('class="workspace-flow-popover"')
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
    expect(source).toContain('class="project-list-title"')
    expect(source).toContain('<h2>Projects</h2>')
    expect(source).toContain('class="project-list-actions"')
    expect(projectSurfaceSource).toContain(
      'grid-template-columns: minmax(330px, 390px) minmax(780px, 1fr);',
    )
    expect(projectSurfaceSource).toContain('.manager-scrim {')
    expect(projectSurfaceSource).toContain('display: none;')
    expect(projectSurfaceSource).toContain('.workspace-flow-popover::before')
    expect(projectSurfaceSource).toContain('left: calc(100% + 14px);')
    expect(source).toContain('class="resource-row project-tree-row mockup-project-row"')
    expect(analysisSource).toContain('class="analysis-panel mockup-analysis-panel"')
    expect(analysisSource).toContain('class="dashboard-card dashboard-run-state-card"')
    expect(analysisSource).toContain('class="dashboard-card dashboard-best-card"')
    expect(analysisSource).toContain(
      'class="dashboard-card dashboard-chart-card dashboard-key-metric-card"',
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
    expect(source).toContain(
      ':class="{ \'project-list--popover-open\': Boolean(popoverWorkspaceId) }"',
    )
    expect(projectStyles).toContain('.project-list--popover-open {')
    expect(projectStyles).toContain('overflow: visible;')
  })

  it('provides a maximize toggle for the project management dialog', () => {
    expect(source).toContain(':class="{ maximized: isDialogMaximized }"')
    expect(source).toContain('toggleDialogMaximized')
    expect(source).toContain('ri-expand-diagonal-line')
    expect(source).toContain('ri-collapse-diagonal-line')
    expect(projectStyles).toContain('.manager-dialog.maximized')
  })

  it('puts project-level workspace actions on each project item using circle icons', () => {
    const projectRowStart = source.indexOf(
      'class="resource-row project-tree-row mockup-project-row"',
    )
    const projectRowEnd = source.indexOf('class="workspace-tree-list"', projectRowStart)
    const rowSource = source.slice(projectRowStart, projectRowEnd)

    expect(rowSource).toContain('project-tree-actions')
    expect(rowSource).toContain('circle-action')
    expect(rowSource).toContain('title="Import or open workspace"')
    expect(rowSource).toContain('title="New workspace"')
    expect(rowSource).toContain('title="Remove from Project Management"')
    expect(rowSource).toContain('@click.stop="importWorkspaceIntoProject(project.model)"')
    expect(rowSource).toContain('@click.stop="createWorkspaceForProject(project.model)"')
    expect(rowSource).toContain('@click.stop="requestDeleteProject(project.source)"')
    expect(rowSource).toContain('class="circle-action primary"')
    expect(rowSource).not.toContain('file-action-button')
    expect(rowSource).toContain('circle-glyph file')
    expect(rowSource).not.toContain('ri-folder-open-line')
    expect(rowSource).not.toContain('ri-folder-add-line')
  })

  it('moves Import Project and New Project into the Projects list header as icon-only circle buttons', () => {
    const titleStart = source.indexOf('class="project-list-title"')
    const titleEnd = source.indexOf('</div>', titleStart)
    const headerSource = source.slice(titleStart, titleEnd + 6)

    expect(source).not.toContain('class="manager-header-actions"')
    expect(headerSource).toContain('class="project-list-actions"')
    expect(headerSource).toContain('class="circle-action primary header-action-button"')
    expect(headerSource).toContain('class="circle-action primary header-action-button"')
    expect(headerSource).toContain('title="Import Project"')
    expect(headerSource).toContain('aria-label="Import Project"')
    expect(headerSource).toContain('title="New Project"')
    expect(headerSource).toContain('aria-label="New Project"')
    expect(headerSource).toContain('circle-glyph file')
    expect(headerSource).toContain('circle-glyph add')
    expect(headerSource).not.toContain('<span>Import</span>')
    expect(headerSource).not.toContain('<span>New Project</span>')
  })

  it('renders workspace tree rows with flow status hints and row-level circle actions', () => {
    expect(source).toContain('v-for="workspace in project.model.workspaces"')
    expect(source).toContain('workspaceDepthStyle(workspace)')
    expect(source).toContain('workspace.flowStatusHint.label')
    expect(source).toContain('flowStatusHintClass(workspace.flowStatusHint.state)')

    const workspaceRowStart = source.indexOf('class="workspace-tree-item"')
    const workspaceRowEnd = source.indexOf('workspace-flow-popover', workspaceRowStart)
    const rowSource = source.slice(workspaceRowStart, workspaceRowEnd)
    expect(rowSource).toContain('title="Open workspace"')
    expect(rowSource).toContain('title="Create workspace from step output"')
    expect(rowSource).toContain('title="Delete workspace"')
    expect(rowSource).toContain('@click.stop="openWorkspace(workspace)"')
    expect(rowSource).toContain('@click.stop="toggleWorkspaceFlowPopover(workspace.id)"')
    expect(rowSource).toContain('@click.stop="requestDeleteWorkspace(workspace.id)"')
    expect(rowSource).toContain('circle-action')
    expect(rowSource).toContain('class="circle-action primary"')
    expect(rowSource).not.toContain('file-action-button')
  })

  it('uses an up-right arrow glyph for opening workspace rows', () => {
    expect(source).toContain('<i class="circle-glyph open"></i>')
    expect(projectStyles).toMatch(
      /\.circle-glyph\.open::before\s*\{[\s\S]*rotate\(-45deg\)/,
    )
    expect(projectStyles).toMatch(/\.circle-glyph\.open::after\s*\{[\s\S]*rotate\(0deg\)/)
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

  it('lets New Project create only the project root manifest', () => {
    expect(source).toContain('Project Storage Location')
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
  })

  it('renders an empty state instead of generated demo workspace data', () => {
    expect(analysisSource).toContain('No project data available')
    expect(analysisSource).toContain('hasProjectData')
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
    expect(analysisDataSource).toContain("readOptionalProjectTextFile('home/flow.json'")
    expect(analysisDataSource).toContain('parseWorkspaceFlowStateMap')
    expect(source).toContain('workspaceAnalysisInputs')
    expect(source).toContain('readProjectWorkspaceAnalysisInputs')
    expect(source).toContain('ProjectWorkspaceAnalysisInputsById')
    expect(analysisDataSource).toContain('WORKSPACE_STEP_ANALYSIS_SPECS')
    expect(analysisDataSource).toContain('Synthesis_yosys/analysis/qor_metrics.json')
    expect(analysisDataSource).toContain('Synthesis_yosys/analysis/qor_summary.json')
    expect(analysisDataSource).toContain('Synthesis_yosys/analysis/qor_hotspots.json')
    expect(analysisDataSource).toContain('route_ecc/analysis/qor_metrics.json')
    expect(analysisDataSource).toContain('sta_ecc/analysis/sta_timing_issues.json')
    expect(analysisDataSource).toContain('stepMetricTexts')
    expect(analysisDataSource).toContain('stepSummaryTexts')
    expect(analysisDataSource).toContain('stepHotspotTexts')
    expect(analysisDataSource).not.toContain('/feature/')
    expect(analysisDataSource).not.toContain('sta_ecc/output')
    expect(analysisDataSource).not.toContain('Synthesis_metrics.json')
  })

  it('renders V3 dashboard and step analysis from the shared project snapshot', () => {
    expect(analysisSource).toContain('project.dashboardSummary')
    expect(analysisSource).not.toContain('Flow Success Ratio')
    expect(analysisSource).not.toContain(
      'class="dashboard-card dashboard-ratio-card mockup-dashboard-card"',
    )
    expect(analysisSource).not.toContain('flowSuccessRatio * 100')
    expect(analysisSource).toContain('runStateSlices')
    expect(analysisSource).toContain('class="dashboard-card dashboard-run-state-card"')
    expect(analysisSource).toContain('class="dashboard-card dashboard-best-card"')
    expect(analysisSource).toContain('Best')
    expect(analysisSource).toContain('bestFrequencyWorkspace')
    expect(analysisSource).toContain('bestWorkspacePpaMetrics')
    expect(analysisSource).not.toContain('Flow Metric Snapshot')
    expect(analysisSource).not.toContain(
      'class="dashboard-card dashboard-flow-metric-card"',
    )
    expect(analysisSource).toContain('flowMetricSummary')
    expect(analysisSource).toContain('dashboardMetricRows')
    expect(analysisSource).toContain('dashboardWorkspaceMetricRows')
    expect(analysisSource).toContain('dashboard-key-metric-table')
    expect(analysisSource).toContain('Die Area')
    expect(analysisSource).toContain('Core Util')
    expect(analysisSource).toContain('Frequency [MHz]')
    expect(analysisSource).toContain('ProjectQorTrendPanel')
    expect(analysisSource).toContain('project.qorTrendSummary')
    expect(analysisSource).toContain('@export-report="exportReport"')
    expect(analysisSource).toContain('@set-baseline="setBaseline"')
    expect(presentationSource).toContain('runtimePoints')
    expect(presentationSource).toContain('memoryPoints')
    expect(analysisSource).not.toContain('Top Blocking Steps')
    expect(analysisSource).not.toContain('class="dashboard-blockers-card"')
    expect(analysisSource).toContain('ProjectStepAnalysisPanel')
    expect(analysisSource).toContain(':workspace-summaries="project.workspaceSummaries"')
    expect(analysisSource).toContain(':steps="project.stepCompareSummaries"')
    expect(analysisSurfaceSource).toContain('.analysis-dashboard-v3 {')
    expect(analysisSurfaceSource).toContain('.dashboard-summary-grid {')
    expect(analysisSurfaceSource).toContain('grid-template-rows: 252px;')
    expect(analysisSurfaceSource).toContain('flex: 0 0 498px;')
    expect(analysisSource).toContain('class="dashboard-summary-grid"')
    expect(analysisSource.indexOf('class="dashboard-summary-grid"')).toBeLessThan(
      analysisSource.indexOf('<ProjectQorTrendPanel'),
    )
    expect(analysisSource.indexOf('<ProjectQorTrendPanel')).toBeLessThan(
      analysisSource.indexOf('Key Metric Snapshot'),
    )
    expect(source).toContain('const hasOpenedStepAnalysis = ref(false)')
    expect(source).toContain('handleAnalysisTabSelection')
    expect(source).toContain('exportQorTrendReport')
    expect(source).toContain('setQorBaseline')
    expect(source).toContain('function openStepAnalysis()')
    expect(source).toContain("selectedStep.value = 'Synth'")
    expect(source).toContain('hasOpenedStepAnalysis.value = true')
    expect(source).not.toContain('selectedStepComparePoints')
  })

  it('keeps only Dashboard and Step Analysis tabs on the right side of the project analysis header', () => {
    const analysisStart = analysisSource.indexOf(
      'class="panel-title-row analysis-heading"',
    )
    const analysisEnd = analysisSource.indexOf(
      '</div>',
      analysisSource.indexOf('class="analysis-header-actions"', analysisStart),
    )
    const analysisHeaderSource = analysisSource.slice(analysisStart, analysisEnd + 6)

    expect(analysisHeaderSource).toContain('class="analysis-header-actions"')
    expect(analysisHeaderSource).toContain('class="analysis-tabs"')
    expect(analysisHeaderSource).toContain('Dashboard')
    expect(analysisHeaderSource).toContain('Step Analysis')
    expect(analysisHeaderSource).not.toContain('Backend Design')
    expect(analysisHeaderSource).not.toContain('toolbar-action')
    expect(source).not.toContain('openBackendDesign')
    expect(analysisSurfaceSource).toContain('.analysis-heading {')
    expect(analysisSurfaceSource).toContain('justify-content: space-between;')
    expect(analysisSurfaceSource).toContain('.analysis-header-actions {')
    expect(analysisSurfaceSource).toContain('margin-left: auto;')
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

  it('registers project roots before reading or mutating project.json', () => {
    expect(source).toContain('registerProjectRootForProjectManagement')
    expect(source).toContain('desktopApi.workspace.registerProjectRoot')

    const createStart = source.indexOf('async function createProjectFolderDraft')
    const createRegister = source.indexOf(
      'await registerProjectRootForProjectManagement(directory)',
      createStart,
    )
    const createMutation = source.indexOf(
      'await mutateProjectManifest(projectRoot,',
      createStart,
    )
    expect(createRegister).toBeGreaterThan(createStart)
    expect(createMutation).toBeGreaterThan(createRegister)

    const importStart = source.indexOf('async function importProject')
    const importRegister = source.indexOf(
      'await registerProjectRootForProjectManagement(directory)',
      importStart,
    )
    const importRead = source.indexOf(
      'await loadProjectFromRoot(projectRoot)',
      importStart,
    )
    expect(importRegister).toBeGreaterThan(importStart)
    expect(importRead).toBeGreaterThan(importRegister)

    const refreshStart = source.indexOf('async function refreshProjectManifests')
    const refreshRegister = source.indexOf(
      'await registerProjectRootForProjectManagement(project.path)',
      refreshStart,
    )
    const refreshRead = source.indexOf(
      "await readOptionalProjectTextFile('project.json'",
      refreshStart,
    )
    expect(refreshRegister).toBeGreaterThan(refreshStart)
    expect(refreshRead).toBeGreaterThan(refreshRegister)
  })

  it('serializes project manifest refreshes because the desktop file scope has one active root', () => {
    expect(source).toContain('let projectManifestRefreshQueue = Promise.resolve()')

    const refreshStart = source.indexOf('async function refreshProjectManifestsNow')
    const refreshEnd = source.indexOf('async function importProject', refreshStart)
    const refreshSource = source.slice(refreshStart, refreshEnd)

    expect(source).toContain('function refreshProjectManifests(): Promise<void>')
    expect(refreshSource).toContain('for (const project of projectSources.value)')
    expect(refreshSource).not.toContain('projectSources.value.map(async (project) =>')
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
