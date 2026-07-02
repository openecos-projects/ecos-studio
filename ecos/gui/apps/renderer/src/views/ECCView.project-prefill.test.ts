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
    expect(source).toContain('sourceOutputPath')
    expect(source).toContain('sourceOutputType')
    expect(source).toContain('startStep')
    expect(source).toContain('endStep')

    const prefillStart = source.indexOf('const prefillWorkspaceDirectory')
    const prefillEnd = source.indexOf('function projectManagedWizardInitialConfig', prefillStart)
    const prefillSource = source.slice(prefillStart, prefillEnd)
    expect(prefillSource).toContain('origin_def: originDef')
    expect(prefillSource).toContain('origin_verilog: originVerilog')
  })

  it('records project managed workspaces into project.json after the existing wizard creates them', () => {
    expect(source).toContain('registerProjectManagedWorkspace')
    expect(source).toContain('registerWorkspaceInManifest')
    expect(source).toContain('readOptionalProjectTextFile')
    expect(source).toContain('writeProjectTextFile')
    expect(source).toContain('project.json')
    expect(source).toContain('projectRoot')
  })

  it('opens Backend Design new workspace with project-root derived directory mode', () => {
    expect(source).toContain('managedWorkspaceRoot')
    expect(source).toContain('deriveDirectoryFromDesign')

    const openStart = source.indexOf('const openWizard =')
    const openEnd = source.indexOf('const closeWizard =', openStart)
    const openSource = source.slice(openStart, openEnd)
    expect(openSource).toContain('projectManagedWizardInitialConfig')
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
})
