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

  it('keeps optional source workspace defaults from blocking the wizard', () => {
    const prefillStart = source.indexOf('const prefillWorkspaceDirectory')
    const prefillEnd = source.indexOf(
      'async function loadSourceWorkspaceInitialConfig',
      prefillStart,
    )
    const prefillSource = source.slice(prefillStart, prefillEnd)
    const catchIndex = prefillSource.indexOf('catch (error)')
    const showWizardIndex = prefillSource.lastIndexOf('showWizard.value = true')

    expect(prefillSource).toContain('let sourceWorkspaceConfig')
    expect(prefillSource).toMatch(
      /sourceWorkspaceConfig\s*=\s*await loadSourceWorkspaceInitialConfig/,
    )
    expect(catchIndex).toBeGreaterThan(-1)
    expect(prefillSource).toContain('Failed to load source workspace defaults')
    expect(showWizardIndex).toBeGreaterThan(catchIndex)
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
    const prefillEnd = source.indexOf(
      'function projectManagedWizardInitialConfig',
      prefillStart,
    )
    const prefillSource = source.slice(prefillStart, prefillEnd)
    expect(prefillSource).toContain('origin_def: originDef')
    expect(prefillSource).toContain('origin_verilog: originVerilog')
    expect(prefillSource).toContain('sdc: sourceSdc || sourceWorkspaceConfig?.sdc')
  })

  it('reuses only source workspace config files when creating a branch workspace', () => {
    expect(source).toContain('loadSourceWorkspaceInitialConfig')
    expect(source).toContain('sourceWorkspacePath')
    expect(source).toContain('readWorkspaceParametersFile(sourceWorkspacePath)')
    expect(source).not.toContain("readOptionalProjectTextFile('home/flow.json'")
    expect(source).toContain("readOptionalProjectTextFile('home/pdk.json'")
    expect(source).toContain("readOptionalProjectTextFile('config/db_ecc.json'")
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

  it('still opens the workspace wizard when source workspace prefill cannot be read', () => {
    const prefillStart = source.indexOf('const prefillWorkspaceDirectory')
    const prefillEnd = source.indexOf(
      'function projectManagedWizardInitialConfig',
      prefillStart,
    )
    const prefillSource = source.slice(prefillStart, prefillEnd)
    const loaderStart = source.indexOf('async function loadSourceWorkspaceInitialConfig')
    const loaderEnd = source.indexOf('function mergeBranchInitialConfig', loaderStart)
    const loaderSource = source.slice(loaderStart, loaderEnd)

    expect(loaderSource).toContain('try {')
    expect(loaderSource).toContain('catch (error)')
    expect(loaderSource).toContain(
      "console.warn('Failed to load source workspace config for wizard prefill.', error)",
    )
    expect(loaderSource).toContain('return undefined')
    expect(prefillSource.indexOf('await loadSourceWorkspaceInitialConfig')).toBeLessThan(
      prefillSource.indexOf('showWizard.value = true'),
    )
  })

  it('records project managed workspaces into project.json after the existing wizard creates them', () => {
    expect(source).toContain('registerProjectManagedWorkspace')
    expect(source).toContain('projectContextFromWorkspaceConfig')
    expect(source).toContain('@/utils/projectManifestRegistration')
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
    const createEnd = source.indexOf(
      'async function registerProjectManagedWorkspace',
      createStart,
    )
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
    expect(openSource).toContain('workspacePath: currentProject.value.path')
  })

  it('resolves project route context when Backend Design opens an existing workspace', () => {
    expect(source).toContain('resolveProjectRouteContextForWorkspace')
    expect(source).toContain('resolveOpenProjectContext')

    const openStart = source.indexOf('const handleOpenProject')
    const openEnd = source.indexOf('const handleOpenRecent', openStart)
    const openSource = source.slice(openStart, openEnd)
    expect(openSource).toContain(
      'await resolveOpenProjectContext(currentProject.value.path)',
    )
    expect(openSource).toContain('projectContext,')
    expect(openSource).toContain(
      'query: workspaceRouteQuery(currentProject.value.path, projectContext)',
    )

    const recentStart = source.indexOf('const handleOpenRecent')
    const recentEnd = source.indexOf('const handleRemoveRecent', recentStart)
    const recentSource = source.slice(recentStart, recentEnd)
    expect(recentSource).toContain('await resolveOpenProjectContext(workspacePath)')
    expect(recentSource).toContain('projectContext,')
    expect(recentSource).toContain('workspaceRouteQuery(workspacePath, projectContext)')

    const resolveStart = source.indexOf('async function resolveOpenProjectContext')
    const resolveEnd = source.indexOf('function workspaceRouteQuery', resolveStart)
    const resolveSource = source.slice(resolveStart, resolveEnd)
    expect(resolveSource).toContain(
      'await resolveProjectRouteContextForWorkspace(workspacePath)',
    )
    expect(resolveSource).toContain('queryString(route.query.projectRoot)')
  })

  it('registers the project root before updating project.json from ECC', () => {
    expect(source).toContain('@/utils/projectManifestRegistration')
    expect(source).toContain('await registerProjectManagedWorkspace({')
    expect(source).toContain('routeQuery: route.query')
  })

  it('restores the created workspace root after project manifest access before opening Home', () => {
    const createStart = source.indexOf('const handleWizardCreate')
    const workspacePathIndex = source.indexOf(
      'const workspacePath = currentProject.value?.path ?? config.directory',
      createStart,
    )
    const registerCallIndex = source.indexOf(
      'await registerProjectManagedWorkspace({',
      createStart,
    )
    const routeQueryIndex = source.indexOf(
      'query: workspaceRouteQuery(workspacePath, projectContext)',
      createStart,
    )
    expect(workspacePathIndex).toBeGreaterThan(createStart)
    expect(registerCallIndex).toBeGreaterThan(workspacePathIndex)
    expect(routeQueryIndex).toBeGreaterThan(registerCallIndex)
  })

  it('keeps project context after creating a workspace from the Backend Design entry', () => {
    expect(source).toContain('projectContextFromWorkspaceConfig')

    const createStart = source.indexOf('const handleWizardCreate')
    const createEnd = source.indexOf('function workspaceRouteQuery', createStart)
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).toContain(
      'const projectContext = projectContextFromWorkspaceConfig(config)',
    )
    expect(createSource).toContain('projectContext,')
    expect(createSource).toContain('workspaceRouteQuery(workspacePath, projectContext)')

    const routeStart = source.indexOf('function workspaceRouteQuery')
    const routeEnd = source.indexOf('function normalizePath', routeStart)
    const routeSource = source.slice(routeStart, routeEnd)
    expect(routeSource).toContain('projectContext?.projectRoot')
    expect(routeSource).toContain('projectContext?.projectName')
  })

  it('opens Edit/Config after a successful Backend Design workspace create', () => {
    expect(source).toContain('requestOpenStepConfigAfterCreate')

    const createStart = source.indexOf('const handleWizardCreate')
    const createEnd = source.indexOf(
      'async function resolveOpenProjectContext',
      createStart,
    )
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).toContain('if (!success) return')
    expect(createSource).toContain('requestOpenStepConfigAfterCreate()')
    expect(createSource.indexOf('requestOpenStepConfigAfterCreate()')).toBeGreaterThan(
      createSource.indexOf('await registerProjectManagedWorkspace({'),
    )
    expect(createSource.indexOf("path: '/workspace/home'")).toBeGreaterThan(
      createSource.indexOf('requestOpenStepConfigAfterCreate()'),
    )
  })

  it('does not open Edit/Config when opening an existing workspace from Backend Design', () => {
    const openProjectStart = source.indexOf('const handleOpenProject')
    const openRecentStart = source.indexOf('const handleOpenRecent')
    const openRecentEnd = source.indexOf('const handleRemoveRecent', openRecentStart)
    const openProjectSource = source.slice(openProjectStart, openRecentStart)
    const openRecentSource = source.slice(openRecentStart, openRecentEnd)
    expect(openProjectSource).not.toContain('requestOpenStepConfigAfterCreate')
    expect(openRecentSource).not.toContain('requestOpenStepConfigAfterCreate')
  })
})

describe('branch prefill canonical parameters', () => {
  it('reads canonical nested die size and core margin from ecc.toml workspaces', () => {
    const normalizeStart = source.indexOf('function normalizeSourceParameters')
    const normalizeEnd = source.indexOf(
      'function normalizeSourcePdkConfig',
      normalizeStart,
    )
    const normalizeSource = source.slice(normalizeStart, normalizeEnd)
    expect(normalizeSource).toContain('die.size')
    expect(normalizeSource).toContain('core.margin')
    expect(normalizeSource).toContain('dieSize[0]')
    expect(normalizeSource).toContain('dieSize[1]')
    expect(normalizeSource).toContain('coreMargin[0]')
  })
})
