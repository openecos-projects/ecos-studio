import { describe, expect, it } from 'vitest'
import source from './ProjectsView.vue?raw'

describe('ProjectsView project management surface', () => {
  it('renders the selection-driven project management dashboard', () => {
    expect(source).toContain('Metrics Summary')
    expect(source).toContain('Workspace Flow Matrix')
    expect(source).toContain('selectWorkspace')
    expect(source).toContain('selectStep')
    expect(source).toContain('startWorkspaceFromCell')
  })

  it('uses the Resource Manager shell and panel style classes', () => {
    expect(source).toContain('class="resource-manager-view"')
    expect(source).toContain('class="manager-dialog"')
    expect(source).toContain('class="manager-grid"')
    expect(source).toContain('class="manager-sidebar"')
    expect(source).toContain('class="manager-table-panel"')
    expect(source).toContain('class="selected-panel"')
    expect(source).toContain('class="resource-row"')
  })

  it('provides a maximize toggle for the project management dialog', () => {
    expect(source).toContain(':class="{ maximized: isDialogMaximized }"')
    expect(source).toContain('toggleDialogMaximized')
    expect(source).toContain('ri-expand-diagonal-line')
    expect(source).toContain('ri-collapse-diagonal-line')
    expect(source).toContain('.manager-dialog.maximized')
  })

  it('adds a Backend Design entry from the selected project toolbar', () => {
    expect(source).toContain('Backend Design')
    expect(source).toContain('openBackendDesign')

    const handlerStart = source.indexOf('async function openBackendDesign')
    expect(handlerStart).toBeGreaterThan(-1)
    const handlerEnd = source.indexOf('async function continueWorkspaceDraft', handlerStart)
    const handlerSource = source.slice(handlerStart, handlerEnd)
    expect(handlerSource).toContain("path: '/ecc'")
    expect(handlerSource).toContain('projectRoot: selectedProject.value.path')
    expect(handlerSource).toContain('projectName: selectedProject.value.name')
  })

  it('keeps Project Management workspace creation behind Backend Design only', () => {
    expect(source).toContain('Backend Design')
    expect(source).not.toContain('Import Workspace')
    expect(source).not.toContain('importWorkspaceIntoProject')
    expect(source).not.toContain('registerWorkspaceToSelectedProject')
  })

  it('shows comparison summary, risk, and workspace management actions', () => {
    expect(source).toContain('comparisonSummary')
    expect(source).toContain('Parameter Diff')
    expect(source).toContain('Metric Delta')
    expect(source).toContain('Risk')
    expect(source).toContain('archiveSelectedWorkspace')
    expect(source).toContain('deleteSelectedWorkspace')
  })

  it('adds a row-level delete action to each workspace in the flow matrix', () => {
    const matrixStart = source.indexOf('class="flow-row"')
    const rowStart = source.lastIndexOf('v-for="workspace in selectedProject.workspaces"', matrixStart)
    const rowEnd = source.indexOf('class="row-action-btn"', rowStart)
    const rowSource = source.slice(rowStart, rowEnd)
    expect(rowSource).toContain('workspace-delete-btn')
    expect(rowSource).toContain('title="Delete workspace"')
    expect(rowSource).toContain('@click.stop="deleteWorkspace(workspace.id)"')

    const handlerStart = source.indexOf('async function deleteWorkspace(')
    const handlerEnd = source.indexOf('async function removeProjectFromHistory', handlerStart)
    const handlerSource = source.slice(handlerStart, handlerEnd)
    expect(handlerSource).toContain('deleteWorkspaceFromManifest(manifest, workspaceId)')
    expect(handlerSource).toContain('writeSelectedProjectManifest(updated, selectedProject.value.path)')
  })

  it('passes source artifacts when creating a workspace from a successful step', () => {
    const continueStart = source.indexOf('async function continueWorkspaceDraft')
    const continueEnd = source.indexOf('async function openWorkspace', continueStart)
    const continueSource = source.slice(continueStart, continueEnd)
    expect(continueSource).toContain('originDef: branchDraft.value.originDef')
    expect(continueSource).toContain('originVerilog: branchDraft.value.originVerilog')
    expect(continueSource).toContain('sourceWorkspacePath: branchDraft.value.sourceWorkspacePath')
    expect(continueSource).toContain('sourceOutputPath: branchDraft.value.sourceOutputPath')
    expect(continueSource).toContain('sourceOutputType: branchDraft.value.sourceOutputType')
    expect(continueSource).toContain('startStep: branchDraft.value.targetStartStep')
    expect(continueSource).toContain('endStep: branchDraft.value.targetEndStep')
  })

  it('uses high-contrast branch link tones for workspace lineage arrows', () => {
    expect(source).toContain('BRANCH_LINK_TONES')
    expect(source).toContain('branchLinkToneClass(index)')
    expect(source).toContain('branchLinkMarkerId(index)')
    expect(source).toContain('branch-link-halo')
  })

  it('shows the source output artifacts before continuing derived workspace creation', () => {
    expect(source).toContain('Input Artifacts')
    expect(source).toContain('branchDraft.sourceOutputPath')
    expect(source).toContain('branchDraft.originDef')
    expect(source).toContain('branchDraft.originVerilog')
  })

  it('removes iteration and step analysis tabs from the toolbar', () => {
    expect(source).not.toContain('Iteration Analysis')
    expect(source).not.toContain('Step Analysis')
    expect(source).not.toContain('class="resource-tabs"')
    expect(source).not.toContain('analysisMode')
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
    expect(createSource).not.toContain("router.push({")
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

  it('keeps the sidebar focused on project search and project list only', () => {
    expect(source).toContain('class="resource-search sidebar-search"')
    expect(source).toContain('class="project-list"')
    expect(source).not.toContain('class="resource-nav"')
    expect(source).not.toContain('class="project-filters"')
    expect(source).not.toContain('class="manager-help project-root-card"')
    expect(source).not.toContain('<span>Iterations</span>')
    expect(source).not.toContain('<span>Metrics</span>')
  })

  it('uses workspace terminology and manifest-driven project data', () => {
    expect(source).toContain('projectManifests')
    expect(source).toContain('readOptionalProjectTextFile')
    expect(source).toContain('parseProjectManifest')
    expect(source).toContain('createWorkspaceBranchDraft')
    expect(source).toContain('selectedWorkspaceId')
    expect(source).not.toContain('selectedIteration')
    expect(source).not.toContain('Iteration Flow Matrix')
    expect(source).not.toContain('Create Iteration')
    expect(source).not.toContain('/iterations/')
  })

  it('loads workspace home flow.json states for the flow matrix', () => {
    expect(source).toContain('workspaceFlowStates')
    expect(source).toContain("readOptionalProjectTextFile('home/flow.json'")
    expect(source).toContain('parseWorkspaceFlowStateMap')
    expect(source).toContain('workspace.workspace_id')
    expect(source).toContain('model: buildProjectManagementProject(')
    expect(source).toContain('projectManifests.value[project.path] ?? null')
    expect(source).toContain('workspaceFlowStates.value[project.path] ?? {}')
    expect(source).toContain("{ label: 'unstart', class: 'legend-unstart' }")
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
    const createRegister = source.indexOf('await registerProjectRootForProjectManagement(directory)', createStart)
    const createWrite = source.indexOf("await writeProjectTextFile('project.json'", createStart)
    expect(createRegister).toBeGreaterThan(createStart)
    expect(createWrite).toBeGreaterThan(createRegister)

    const importStart = source.indexOf('async function importProject')
    const importRegister = source.indexOf('await registerProjectRootForProjectManagement(directory)', importStart)
    const importRead = source.indexOf('await loadProjectFromRoot(projectRoot)', importStart)
    expect(importRegister).toBeGreaterThan(importStart)
    expect(importRead).toBeGreaterThan(importRegister)

    const refreshStart = source.indexOf('async function refreshProjectManifests')
    const refreshRegister = source.indexOf('await registerProjectRootForProjectManagement(project.path)', refreshStart)
    const refreshRead = source.indexOf("await readOptionalProjectTextFile('project.json'", refreshStart)
    expect(refreshRegister).toBeGreaterThan(refreshStart)
    expect(refreshRead).toBeGreaterThan(refreshRegister)
  })
})
