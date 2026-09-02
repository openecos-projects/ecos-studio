import { describe, expect, it } from 'vitest'
import source from './App.vue?raw'

describe('agent workspace creation', () => {
  it('persists the frozen contract and returns its workspace for execution tracking', () => {
    expect(source).toContain('workspace_setup_contract.v2.json')
    expect(source).toContain('api.workspace.writeProjectTextFile')
    expect(source).toContain('return { created: true, workspacePath }')
    expect(source).toContain('ownerSessionId,')
    expect(source).not.toContain('void runAllFlow()')
    expect(source).not.toContain('agentShell.expandWorkspaceChat()')
  })

  it('returns the workspace creation failure reason to the chat host', () => {
    expect(source).toContain('lastWorkspaceCreationError.value')
    expect(source).toContain('created: false')
  })

  it('fails closed when SoC-MPC was selected without a validated snapshot', () => {
    expect(source).toContain('contract.mpc_enabled && !config.mpc')
    expect(source).toContain('no validated MPC template was resolved')
  })

  it('keeps the managed project context when opening the new workspace home', () => {
    expect(source).toContain("path: '/workspace/home'")
    expect(source).toContain('projectRoot: contract.project_context.project_root')
    expect(source).toContain('projectName: contract.project_context.project_name')
  })

  it('hosts the flow-scoped step configuration editor in a top-level dialog', () => {
    expect(source).toContain('@step-config="showStepConfigDialog = true"')
    expect(source).toContain(':visible="showStepConfigDialog"')
    expect(source).toContain('@update:visible="updateStepConfigDialogVisibility"')
    expect(source).toContain('<WorkspaceStepConfigDialog')
    // No footer: the dialog closes via the header X / ESC through the same guard.
    expect(source).not.toContain('<template #footer>')
  })

  it('does not auto-open Edit/Config after agent workspace creation', () => {
    const createStart = source.indexOf('async function createWorkspaceFromAgent')
    const createEnd = source.indexOf('provide(agentWorkspaceSetupKey', createStart)
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).not.toContain('requestOpenStepConfigAfterCreate')
  })
})

describe('quick start resources', () => {
  it('renders a click-aware cursor and target highlight', () => {
    expect(source).toContain(':class="{ \'is-clicking\': quickStartCursor.clicking }"')
    expect(source).toContain('.quick-start-cursor::after')
    expect(source).toContain('.quick-start-cursor i')
    expect(source).toContain('quick-start-cursor-ripple')
    expect(source).toContain('quick-start-target-highlight')
  })

  it('hides the cursor when Quick Start is idle', () => {
    expect(source).toContain('v-if="quickStartCursor.visible"')
  })

  it('mounts the cursor before moving it to the first target', () => {
    const start = source.indexOf('async function moveQuickStartCursor')
    const end = source.indexOf('function joinLocalPath', start)
    const moveSource = source.slice(start, end)

    expect(moveSource).toContain('quickStartCursor.visible = true')
    expect(moveSource).toContain('await nextTick()')
    expect(moveSource).toContain('quickStartCursor.left = left')
    expect(moveSource).toContain('quickStartCursor.top = top')
    expect(moveSource).toContain('await delay(120, signal)')
  })

  it('uses the visible Project Management entry instead of routing around it', () => {
    const navigateStart = source.indexOf("if (surface === 'project-management')")
    const navigateEnd = source.indexOf('createProject: async', navigateStart)
    const navigateSource = source.slice(navigateStart, navigateEnd)

    expect(navigateSource).toContain("'.project-management-entry'")
    expect(navigateSource).toContain(
      'Quick Start could not find the Project Management button.',
    )
    expect(navigateSource).toContain('offsetX: 96')
    expect(navigateSource).toContain('offsetY: 96')
    expect(navigateSource).toContain('clickQuickStartTarget(homeProjectButton')
    expect(navigateSource).not.toContain("router.push('/projects')")
  })

  it('resolves ICS55 through the inventory-aware resource lookup', () => {
    const start = source.indexOf('async function resolveQuickStartResources')
    const end = source.indexOf('function resourceHealth', start)

    const resolverSource = source.slice(start, end)
    expect(resolverSource).toContain('api.app.getQuickStartResources')
    expect(resolverSource).toContain('await api.app.getQuickStartResources()')
    expect(resolverSource).toContain("api.resources.get('pdk:ics55')")
    expect(resolverSource).toContain('api.resources.importPdkPath')
    expect(resolverSource).not.toContain('/home/ekko/Desktop/ECOS/gcd.v')
  })

  it('passes the resolved PDK installation and requirement into the workspace wizard', () => {
    const start = source.indexOf('const config: WorkspaceConfig =')
    const end = source.indexOf('const createdConfig', start)
    const workspaceSource = source.slice(start, end)

    expect(workspaceSource).toContain('pdk_installation_id: input.resources.pdk?.id')
    expect(workspaceSource).toContain("familyId: 'ics55'")
    expect(workspaceSource).toContain('manualConfig: null')
  })

  it('fills and closes the existing New Project dialog', () => {
    const createStart = source.indexOf('createProject: async')
    const createEnd = source.indexOf('createWorkspace: async', createStart)
    const createSource = source.slice(createStart, createEnd)

    expect(createSource).toContain('showQuickStartProjectDialog')
    expect(createSource).toContain('projectName,')
    expect(createSource).toContain("designName: 'gcd'")
    expect(createSource).toContain('projectRoot,')
    expect(createSource).toContain('mpcId: input.mpc?.id')
    expect(createSource).toContain('registerProjectRoot(projectRoot)')
    expect(source).toContain('clickQuickStartTarget(createButton')
    expect(source).toContain(
      'clickQuickStartProjectWorkspaceButton(input.projectName, signal)',
    )
    expect(source).toContain('Loading MPC design specification')
    expect(source).toContain(
      "createButton.scrollIntoView({ behavior: 'smooth', block: 'center' })",
    )
    expect(source).toContain('typeQuickStartInput(field, value, signal)')
    expect(source).toContain("await showQuickStartInput('top', 'gcd', signal)")
    expect(source).toContain("await showQuickStartInput('clk', 'clk', signal)")
  })

  it('types visible Quick Start values instead of only showing the cursor', () => {
    expect(source).toContain('getPathLeafName(config.directory)')
    expect(source).not.toContain("await showQuickStartInput('gcd', 'gcd', signal)")
    expect(source).toContain("await showQuickStartInput('top', 'gcd', signal)")
    expect(source).toContain("await showQuickStartInput('clk', 'clk', signal)")
    const workspaceStart = source.indexOf('const config: WorkspaceConfig =')
    const workspaceEnd = source.indexOf('const createdConfig', workspaceStart)
    const workspaceSource = source.slice(workspaceStart, workspaceEnd)
    expect(workspaceSource).toContain("design: 'gcd'")
    expect(workspaceSource).toContain("'Timing optimization'")
    expect(workspaceSource).toContain("top_module: ''")
    expect(workspaceSource).toContain("clock: ''")
    expect(source).toContain('input.value += character')
    expect(source).toContain("new Event('input', { bubbles: true })")
  })

  it('forwards cancellation through the workflow and wizard driver', () => {
    expect(source).toContain(
      'const runQuickStart: QuickStartRunner = async (onEvent, signal, onNarration) =>',
    )
    expect(source).toContain('runQuickStartWorkflow(host, onEvent, signal)')
    expect(source).toContain('signal?.throwIfAborted()')
    expect(source).toContain('await delay(2000, signal)')
    expect(source).toContain('quickStartCursor.clicking = true')
  })

  it('keeps one Project-scoped run record and no dead handoff query', () => {
    const createWorkspaceStart = source.indexOf('createWorkspace: async')
    const handoffStart = source.indexOf('handoff: async', createWorkspaceStart)
    const startFlowStart = source.indexOf('startFlow: async', handoffStart)
    const hostEnd = source.indexOf('await runQuickStartWorkflow', startFlowStart)

    expect(source.slice(createWorkspaceStart, handoffStart)).toContain(
      'writeQuickStartRunRecord(api, workspacePath',
    )
    expect(source.slice(startFlowStart, hostEnd)).toContain(
      'writeQuickStartRunRecord(api, input.workspace.path',
    )
    expect(source.slice(handoffStart, startFlowStart)).not.toContain("quickStart: '1'")
  })
})
