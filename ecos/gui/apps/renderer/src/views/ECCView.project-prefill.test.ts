import { describe, expect, it } from 'vitest'
import source from './ECCView.vue?raw'

describe('ECCView project management handoff', () => {
  it('opens the existing new workspace wizard with a prefilled directory from route query', () => {
    expect(source).toContain('useRoute')
    expect(source).toContain('workspacePath')
    expect(source).toContain('sourceWorkspace')
    expect(source).toContain('initialWizardConfig')
    expect(source).toContain(':initial-config="initialWizardConfig"')
    expect(source).toContain('showWizard.value = true')
    expect(source).not.toContain('sourceIteration')
  })

  it('prefills branch artifact origins from project management query parameters', () => {
    expect(source).toContain('originDef')
    expect(source).toContain('originVerilog')
    expect(source).toContain('sourceSdc')
    expect(source).toContain('sourceWorkspacePath')
    expect(source).toContain('sourceOutputPath')
    expect(source).toContain('sourceOutputType')
    expect(source).toContain('startStep')
    expect(source).toContain('endStep')

    const prefillStart = source.indexOf('const prefillWorkspaceDirectory')
    const prefillEnd = source.indexOf('function projectManagedWizardInitialConfig', prefillStart)
    const prefillSource = source.slice(prefillStart, prefillEnd)
    expect(prefillSource).toContain('origin_def: originDef')
    expect(prefillSource).toContain('origin_verilog: originVerilog')
    expect(prefillSource).toContain('sdc: sourceSdc || sourceWorkspaceConfig?.sdc')
  })

  it('reuses only source workspace config files when creating a branch workspace', () => {
    expect(source).toContain('loadSourceWorkspaceInitialConfig')
    expect(source).toContain('sourceWorkspacePath')
    expect(source).toContain("readOptionalProjectTextFile('home/parameters.json'")
    expect(source).not.toContain("readOptionalProjectTextFile('home/flow.json'")
    expect(source).toContain("readOptionalProjectTextFile('home/pdk.json'")
    expect(source).toContain("readOptionalProjectTextFile('config/db_default_config.json'")
    expect(source).toContain('tech_lef_path')
    expect(source).toContain('lef_paths')
    expect(source).toContain('lib_path')
    expect(source).toContain('sdc_path')
    expect(source).toContain('sourceWorkspaceConfig')
    expect(source).toContain('mergeBranchInitialConfig')

    const loaderStart = source.indexOf('async function loadSourceWorkspaceInitialConfig')
    const loaderEnd = source.indexOf('function mergeBranchInitialConfig', loaderStart)
    const loaderSource = source.slice(loaderStart, loaderEnd)
    expect(loaderSource).not.toContain('origin_verilog:')
    expect(loaderSource).not.toContain('origin_def:')
  })

  it('records project managed workspaces into project.json after the existing wizard creates them', () => {
    expect(source).toContain('registerProjectManagedWorkspace')
    expect(source).toContain('registerWorkspaceInManifest')
    expect(source).toContain('readOptionalProjectTextFile')
    expect(source).toContain('writeProjectTextFile')
    expect(source).toContain('project.json')
    expect(source).toContain('projectRoot')
    expect(source).toContain('restoreWorkspaceRootForWorkspaceView')
  })

  it('opens Backend Design new workspace with project-root derived directory mode', () => {
    expect(source).toContain('managedWorkspaceRoot')
    expect(source).toContain('deriveDirectoryFromDesign')

    const openStart = source.indexOf('const openWizard =')
    const openEnd = source.indexOf('const closeWizard =', openStart)
    const openSource = source.slice(openStart, openEnd)
    expect(openSource).toContain('projectManagedWizardInitialConfig')
  })

  it('returns to Project Management when cancelling a project-managed new workspace', () => {
    expect(source).toContain('resetWizard')

    const closeStart = source.indexOf('const closeWizard =')
    const closeEnd = source.indexOf('const prefillWorkspaceDirectory', closeStart)
    const closeSource = source.slice(closeStart, closeEnd)
    expect(closeSource).toContain('resetWizard()')
    expect(closeSource).toContain('queryString(route.query.projectRoot)')
    expect(closeSource).toContain("router.push('/projects')")

    const createStart = source.indexOf('const handleWizardCreate')
    const createEnd = source.indexOf('async function registerProjectManagedWorkspace', createStart)
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).toContain('resetWizard()')
    expect(createSource).not.toContain('closeWizard()')
  })

  it('updates project.json after opening an existing workspace from project context', () => {
    expect(source).toContain('currentProject')

    const openStart = source.indexOf('const handleOpenProject')
    const openEnd = source.indexOf('const handleOpenRecent', openStart)
    const openSource = source.slice(openStart, openEnd)
    expect(openSource).toContain('await registerProjectManagedWorkspace({')
    expect(openSource).toContain('workspacePath: currentProject.value?.path')
  })

  it('registers the project root before updating project.json from ECC', () => {
    expect(source).toContain('registerProjectRootForProjectManagement')
    expect(source).toContain('registerLocalProjectRoot')
    expect(source).toContain('desktopApi.workspace.registerProjectRoot')

    const updateStart = source.indexOf('async function registerProjectManagedWorkspace')
    const registerIndex = source.indexOf('await registerProjectRootForProjectManagement(projectRoot)', updateStart)
    const readIndex = source.indexOf("await readOptionalProjectTextFile('project.json'", updateStart)
    const writeIndex = source.indexOf("await writeProjectTextFile('project.json'", updateStart)
    const outputPathIndex = source.indexOf('sourceOutputPath: queryString(route.query.sourceOutputPath)', updateStart)

    expect(registerIndex).toBeGreaterThan(updateStart)
    expect(readIndex).toBeGreaterThan(registerIndex)
    expect(writeIndex).toBeGreaterThan(registerIndex)
    expect(outputPathIndex).toBeGreaterThan(updateStart)
  })

  it('restores the created workspace root after project manifest access before opening Home', () => {
    const createStart = source.indexOf('const handleWizardCreate')
    const workspacePathIndex = source.indexOf('const workspacePath = currentProject.value?.path ?? config.directory', createStart)
    const registerCallIndex = source.indexOf('await registerProjectManagedWorkspace({', createStart)
    const routeQueryIndex = source.indexOf('query: workspaceRouteQuery(workspacePath)', createStart)
    expect(workspacePathIndex).toBeGreaterThan(createStart)
    expect(registerCallIndex).toBeGreaterThan(workspacePathIndex)
    expect(routeQueryIndex).toBeGreaterThan(registerCallIndex)

    const updateStart = source.indexOf('async function registerProjectManagedWorkspace')
    const writeIndex = source.indexOf("await writeProjectTextFile('project.json'", updateStart)
    const finallyIndex = source.indexOf('} finally {', updateStart)
    const restoreIndex = source.indexOf('await restoreWorkspaceRootForWorkspaceView(workspacePath)', updateStart)
    expect(finallyIndex).toBeGreaterThan(writeIndex)
    expect(restoreIndex).toBeGreaterThan(finallyIndex)

    const restoreStart = source.indexOf('async function restoreWorkspaceRootForWorkspaceView')
    const restoreEnd = source.indexOf('async function registerLocalProjectRoot', restoreStart)
    const restoreSource = source.slice(restoreStart, restoreEnd)
    expect(restoreSource).toContain("registerLocalProjectRoot(workspacePath, 'workspace view')")
  })
})
