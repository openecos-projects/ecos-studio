import { describe, expect, it } from 'vitest'
import source from './ProjectsView.vue?raw'

const normalizedSource = source.replace(/\s+/g, ' ')

describe('ProjectsView project management surface', () => {
  it('renders the project tree and project analysis surface instead of the old flow matrix', () => {
    expect(source).toContain('Project Analysis')
    expect(source).toContain('Dashboard')
    expect(source).toContain('Step Analysis')
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
    expect(source).toContain(
      'grid-template-columns: minmax(330px, 390px) minmax(780px, 1fr);',
    )
    expect(source).toContain('.manager-scrim {')
    expect(source).toContain('display: none;')
    expect(source).toContain('.workspace-flow-popover::before')
    expect(source).toContain('left: calc(100% + 14px);')
    expect(source).toContain('class="resource-row project-tree-row mockup-project-row"')
    expect(source).toContain('class="analysis-panel mockup-analysis-panel"')
    expect(source).toContain('class="dashboard-card dashboard-run-state-card"')
    expect(source).toContain('class="dashboard-card dashboard-best-card"')
    expect(source).toContain(
      'class="dashboard-card dashboard-chart-card dashboard-key-metric-card"',
    )
  })

  it('uses theme-mixed colors for the Projects list background', () => {
    expect(source).toContain(
      '--project-list-bg: color-mix(in srgb, var(--bg-secondary) 82%, var(--bg-primary));',
    )
    expect(source).toContain('background: var(--project-list-bg);')
    expect(source).toContain(
      '--project-tree-bg: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));',
    )
    expect(source).not.toContain('--mockup-soft: #f3f4f6')
    expect(source).not.toContain('--mockup-bg: #f9fafb')
  })

  it('provides a maximize toggle for the project management dialog', () => {
    expect(source).toContain(':class="{ maximized: isDialogMaximized }"')
    expect(source).toContain('toggleDialogMaximized')
    expect(source).toContain('ri-expand-diagonal-line')
    expect(source).toContain('ri-collapse-diagonal-line')
    expect(source).toContain('.manager-dialog.maximized')
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
    expect(rowSource).toContain('title="Delete project"')
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
    expect(source).toMatch(/\.circle-glyph\.open::before\s*\{[\s\S]*rotate\(-45deg\)/)
    expect(source).toMatch(/\.circle-glyph\.open::after\s*\{[\s\S]*rotate\(0deg\)/)
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
    expect(source).toContain('Delete Project')
    expect(source).toContain('Keep workspace data')
    expect(source).toContain('checked by default')
    expect(source).toContain('removeProjectDirectory')
    expect(normalizedSource).toContain('This will not delete the project directory')
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
    expect(source).toContain('writeProjectTextFile')
    expect(source).toContain('createProjectManifestDraft')

    const createStart = source.indexOf('async function createProjectFolderDraft')
    const createEnd = source.indexOf('const goBack =', createStart)
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).not.toContain('router.push({')
    expect(createSource).not.toContain("path: '/ecc'")
    expect(createSource).not.toContain('workspacePath')
    expect(createSource).not.toContain("workspaces', 'ws_0001'")
  })

  it('renders an empty state instead of generated demo workspace data', () => {
    expect(source).toContain('No project data available')
    expect(source).toContain('hasProjectData')
    expect(source).not.toContain('gcd_backend')
    expect(source).not.toContain('iter_0001')
  })

  it('shows project workspace counts instead of project status pills in the project list', () => {
    expect(source).toContain('workspaceCountLabel(project.model.workspaces.length)')
    expect(source).not.toContain('status-pill')
    expect(source).not.toContain('statusLabel(project.source.status)')
    expect(source).not.toContain('Not Started')
  })

  it('loads workspace home flow.json states and analysis snapshots for project analysis', () => {
    expect(source).toContain('workspaceFlowStates')
    expect(source).toContain("readOptionalProjectTextFile('home/flow.json'")
    expect(source).toContain('parseWorkspaceFlowStateMap')
    expect(source).toContain('workspaceAnalysisInputs')
    expect(source).toContain('readWorkspaceAnalysisInputs')
    expect(source).toContain('ProjectWorkspaceAnalysisInputsById')
    expect(source).toContain('Synthesis_yosys/feature/Synthesis_stat.json')
    expect(source).toContain('WORKSPACE_STEP_METRICS_FILE_SPECS')
    expect(source).toContain('Synthesis_yosys/analysis/Synthesis_metrics.json')
    expect(source).toContain('route_ecc/analysis/route_metrics.json')
    expect(source).toContain('stepMetricTexts')
    expect(source).toContain('sta_ecc/output')
  })

  it('renders dashboard and step analysis charts from derived project data', () => {
    expect(source).toContain('selectedProject.dashboardSummary')
    expect(source).not.toContain('Flow Success Ratio')
    expect(source).not.toContain(
      'class="dashboard-card dashboard-ratio-card mockup-dashboard-card"',
    )
    expect(source).not.toContain('flowSuccessRatio * 100')
    expect(source).toContain('runStateSlices')
    expect(source).toContain('class="dashboard-card dashboard-run-state-card"')
    expect(source).toContain('class="dashboard-card dashboard-best-card"')
    expect(source).toContain('Best')
    expect(source).toContain('bestFrequencyWorkspace')
    expect(source).toContain('bestWorkspacePpaMetrics')
    expect(source).not.toContain('Flow Metric Snapshot')
    expect(source).not.toContain('class="dashboard-card dashboard-flow-metric-card"')
    expect(source).toContain('flowMetricSummary')
    expect(source).toContain('dashboardMetricRows')
    expect(source).toContain('dashboardWorkspaceMetricRows')
    expect(source).toContain('dashboard-key-metric-table')
    expect(source).toContain(
      "const metricOrder = ['die_area', 'core_util', 'frequency', 'wns', 'tns', 'drc']",
    )
    expect(source).toContain('Die Area')
    expect(source).toContain('Core Util')
    expect(source).toContain('Frequency [MHz]')
    expect(source.indexOf("'die_area'")).toBeLessThan(source.indexOf("'wns'"))
    expect(source.indexOf("'core_util'")).toBeLessThan(source.indexOf("'wns'"))
    expect(source.indexOf("'frequency'")).toBeLessThan(source.indexOf("'wns'"))
    expect(source).toContain('runtimePoints')
    expect(source).toContain('memoryPoints')
    expect(source).not.toContain('Top Blocking Steps')
    expect(source).not.toContain('class="dashboard-blockers-card"')
    expect(source).toContain('selectedStepCompareMetrics')
    expect(source).toContain('selectedStepWorkspaceMetricRows')
    expect(source).toContain('step-compare-metric-table')
    expect(source).toContain('step-compare-workspace-cell')
    expect(source).toContain('step-compare-metric-cell')
    expect(source).toContain('aria-label="Selected step metrics by workspace"')
    expect(source).toMatch(
      /repeat\(\s*var\(--step-compare-metric-count\),\s*minmax\(92px,\s*1fr\)\s*\)/,
    )
    expect(source).toContain('grid-auto-rows: 42px;')
    expect(source).not.toContain('align-self: stretch;')
    expect(source).not.toContain('step-compare-metric-card')
    expect(source).not.toContain('step-compare-metric-chart')
    expect(source).not.toContain('class="step-compare-point"')
    expect(source).toContain('const hasOpenedStepAnalysis = ref(false)')
    expect(source).toContain('@click="openStepAnalysis"')
    expect(source).toContain('function openStepAnalysis()')
    expect(source).toContain("selectedStep.value = 'Synth'")
    expect(source).toContain('hasOpenedStepAnalysis.value = true')
    expect(source).not.toContain('selectedStepComparePoints')
  })

  it('keeps only Dashboard and Step Analysis tabs on the right side of the project analysis header', () => {
    const analysisStart = source.indexOf('class="panel-title-row analysis-heading"')
    const analysisEnd = source.indexOf(
      '</div>',
      source.indexOf('class="analysis-header-actions"', analysisStart),
    )
    const analysisHeaderSource = source.slice(analysisStart, analysisEnd + 6)

    expect(analysisHeaderSource).toContain('class="analysis-header-actions"')
    expect(analysisHeaderSource).toContain('class="analysis-tabs"')
    expect(analysisHeaderSource).toContain('Dashboard')
    expect(analysisHeaderSource).toContain('Step Analysis')
    expect(analysisHeaderSource).not.toContain('Backend Design')
    expect(analysisHeaderSource).not.toContain('toolbar-action')
    expect(source).not.toContain('openBackendDesign')
    expect(source).toContain('.analysis-heading {')
    expect(source).toContain('justify-content: space-between;')
    expect(source).toContain('.analysis-header-actions {')
    expect(source).toContain('margin-left: auto;')
  })

  it('keeps the workspace flow popover inside the project manager bounds', () => {
    expect(source).toContain('workspacePopoverPlacementClass(workspace.id)')
    expect(source).toContain(':class="workspacePopoverPlacementClass(workspace.id)"')
    expect(source).not.toContain('workspace-popover-flip')
    expect(source).toContain('max-width: min(322px, calc(100vw - 80px));')
    expect(source).toContain('left: calc(100% + 14px);')
    expect(source).not.toContain('right: calc(100% + 14px);')
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

  it('registers project roots before reading or writing project.json', () => {
    expect(source).toContain('registerProjectRootForProjectManagement')
    expect(source).toContain('desktopApi.workspace.registerProjectRoot')

    const createStart = source.indexOf('async function createProjectFolderDraft')
    const createRegister = source.indexOf(
      'await registerProjectRootForProjectManagement(directory)',
      createStart,
    )
    const createWrite = source.indexOf(
      "await writeProjectTextFile('project.json'",
      createStart,
    )
    expect(createRegister).toBeGreaterThan(createStart)
    expect(createWrite).toBeGreaterThan(createRegister)

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
})
