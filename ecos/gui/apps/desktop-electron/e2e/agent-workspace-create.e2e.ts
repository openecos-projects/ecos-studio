import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { launchE2EApp, repoRoot, resolveOutDir } from './support/launch'
import { prepareGcdProject, type E2EDesign } from './support/design'
import { createBackendProject, waitToolchainReady } from './support/journey'

const runRealAgent = process.env.ECOS_E2E_REAL_AGENT === '1'

type MpcScenario = 'skip' | 'download' | 'unavailable'
type ProjectScenario = 'create' | 'existing'
type ExpectedOutcome = 'created' | 'failed' | 'cancelled'

interface WorkspaceUiScenario {
  scenario: string
  project: ProjectScenario
  mpc: MpcScenario
  outcome: ExpectedOutcome
  staleMpc?: boolean
  nonEmptyRoot?: boolean
  registryUrl?: string
}

describe.runIf(runRealAgent)('product e2e: real Agent workspace UI', () => {
  it('creates a new project without MPC through the visible Agent panel', async () => {
    await runWorkspaceUiScenario({
      scenario: 'agent-create-no-mpc',
      project: 'create',
      mpc: 'skip',
      outcome: 'created',
    })
    expect.hasAssertions()
  }, 300_000)

  it('downloads a missing MPC and creates the workspace through the visible Agent panel', async () => {
    await runWorkspaceUiScenario({
      scenario: 'agent-create-download-mpc',
      project: 'create',
      mpc: 'download',
      outcome: 'created',
    })
    expect.hasAssertions()
  }, 300_000)

  it('shows a visible fail-closed state when the selected MPC cannot be downloaded', async () => {
    await runWorkspaceUiScenario({
      scenario: 'agent-create-mpc-unavailable',
      project: 'create',
      mpc: 'unavailable',
      outcome: 'failed',
      registryUrl: 'http://127.0.0.1:1/registry.json',
    })
    expect.hasAssertions()
  }, 300_000)

  it('reuses an existing project and repairs a stale MPC snapshot through the visible Agent panel', async () => {
    await runWorkspaceUiScenario({
      scenario: 'agent-existing-project-stale-mpc',
      project: 'existing',
      mpc: 'download',
      outcome: 'created',
      staleMpc: true,
    })
    expect.hasAssertions()
  }, 300_000)

  it('reports an actionable error for a non-empty project root', async () => {
    await runWorkspaceUiScenario({
      scenario: 'agent-create-non-empty-root',
      project: 'create',
      mpc: 'skip',
      outcome: 'failed',
      nonEmptyRoot: true,
    })
    expect.hasAssertions()
  }, 300_000)

  it('cancels workspace creation without writing project state', async () => {
    await runWorkspaceUiScenario({
      scenario: 'agent-cancel-workspace',
      project: 'create',
      mpc: 'skip',
      outcome: 'cancelled',
    })
    expect.hasAssertions()
  }, 300_000)
})

async function runWorkspaceUiScenario(options: WorkspaceUiScenario): Promise<void> {
  const outDir = await resolveOutDir(options.scenario)
  const design = await prepareGcdProject(join(outDir, 'work'))
  const projectRoot = options.nonEmptyRoot
    ? join(outDir, 'work', 'nonemptyproject')
    : design.projectRoot
  if (options.nonEmptyRoot) {
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, 'unrelated.txt'), 'keep me\n')
  }

  const launched = await launchAgentApp(outDir, options.registryUrl)
  const { page, appLogs } = launched

  try {
    await waitToolchainReady(page)
    const originalProjectId =
      options.project === 'existing'
        ? await createBackendProject(page, {
            projectRoot,
            name: 'gcd',
            designName: design.designName,
            rtlImport: design.rtlImport,
          })
        : undefined
    if (options.staleMpc) await writeStaleMpcSnapshot(projectRoot)

    await page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
    await page.getByRole('dialog', { name: 'ECOS Agent' }).waitFor()

    await clickChoice(page, 'Get started', 'Run your own RTL-to-GDS flow')
    await clickChoice(
      page,
      'Choose a Project',
      options.project === 'existing' ? 'Use an existing Project' : 'Create a new Project',
    )
    await sendMessage(page, projectRoot)
    await submitForm(page, 'Workspace Name', 'ws_agent_e2e')
    await submitForm(page, 'Design Name', design.designName)
    await clickChoice(page, 'Choose the end step', 'Synthesis')
    await submitForm(page, 'RTL path', design.rtlImport.verilog![0]!)
    await clickChoice(page, 'Optional filelist path', 'Skip')
    await clickChoice(page, 'Optional SDC path', 'Skip')
    await sendMessage(page, await resolvePdkRoot())

    if (options.mpc !== 'skip') {
      const installedMpcs = await listInstalledMpcs(page)
      expect(installedMpcs).toEqual([])
    }

    await clickChoice(
      page,
      'SoC-MPC template',
      options.mpc === 'skip' ? 'Do not use a SoC-MPC template' : 'Use a SoC-MPC template',
    )
    await submitForm(page, 'Top Module Name')
    await submitForm(page, 'Clock Signal Name')
    await submitForm(page, 'Frequency Max (MHz)')
    await submitForm(page, 'Max Fanout')
    await submitForm(page, 'Die Area Utilization')
    await submitForm(page, 'Placement Target Density')
    await submitForm(page, 'Placement Target Overflow')

    if (options.mpc === 'unavailable') {
      await expect
        .poll(() => page.locator('body').innerText(), { timeout: 60_000 })
        .toContain('No installed or downloadable MPC resource is available.')
      await expect
        .poll(() => page.locator('body').innerText(), { timeout: 30_000 })
        .toContain('Needs attention')
    }

    const reviewText = await page.locator('body').innerText()
    appLogs.push(`[e2e] Review state before confirmation:\n${reviewText}\n`)
    await captureUi(page, outDir, 'review')

    if (options.outcome === 'cancelled') {
      await clickChoice(page, 'Confirm execution', 'Cancel')
      await expect
        .poll(() => page.locator('body').innerText(), { timeout: 30_000 })
        .toContain('Cancelled; no workspace was created and ECC was not executed.')
      await expectNoProjectState(projectRoot)
      await captureUi(page, outDir, 'final')
      return
    }

    await clickChoice(page, 'Confirm execution', 'Confirm and start')
    if (options.outcome === 'failed') {
      await assertVisibleFailure(page, options, projectRoot)
      await captureUi(page, outDir, 'final')
      return
    }

    await assertCreatedWorkspace(page, {
      design,
      options,
      originalProjectId,
      projectRoot,
    })
    await captureUi(page, outDir, 'final')
  } catch (error) {
    await Promise.all([
      writeFile(join(outDir, 'failure-ui.txt'), await page.locator('body').innerText()),
      writeFile(join(outDir, 'failure-app.log'), appLogs.join('')),
      page.screenshot({ path: join(outDir, 'failure.png'), fullPage: true }),
    ]).catch(() => undefined)
    throw error
  } finally {
    await launched.close()
  }
}

async function launchAgentApp(
  outDir: string,
  registryUrl?: string,
): Promise<{
  page: Page
  appLogs: string[]
  close: () => Promise<void>
}> {
  const codexBin = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim()
  const hostSettings = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    '@ecos-studio',
    'desktop-electron',
    'settings.json',
  )
  const isolatedSettings = join(
    outDir,
    'xdg',
    'config',
    '@ecos-studio',
    'desktop-electron',
    'settings.json',
  )
  // launchE2EApp isolates all XDG paths. Copy only app settings so the test
  // uses the configured provider/model profile without sharing caches, state,
  // or the single-instance lock with the live app.
  await mkdir(dirname(isolatedSettings), { recursive: true })
  await copyFile(hostSettings, isolatedSettings)
  const launched = await launchE2EApp(outDir, {
    adjustEnv: (env) => {
      env.CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex')
      env.ECOS_AGENT_CODEX_BIN = process.env.ECOS_AGENT_CODEX_BIN || codexBin
      if (registryUrl) env.ECOS_REGISTRY_URL = registryUrl
    },
  })
  const appLogs: string[] = []
  launched.app.process().stdout?.on('data', (chunk) => appLogs.push(String(chunk)))
  launched.app.process().stderr?.on('data', (chunk) => appLogs.push(String(chunk)))
  launched.page.on('console', (message) =>
    appLogs.push(`[renderer:${message.type()}] ${message.text()}\n`),
  )
  return {
    page: launched.page,
    appLogs,
    close: async () => {
      await launched.close()
      await unlink(isolatedSettings).catch(() => undefined)
    },
  }
}

async function assertCreatedWorkspace(
  page: Page,
  input: {
    design: E2EDesign
    options: WorkspaceUiScenario
    originalProjectId?: string
    projectRoot: string
  },
): Promise<void> {
  const workspacePath = join(input.projectRoot, 'ws_agent_e2e')
  await expect
    .poll(
      async () => {
        try {
          const manifest = JSON.parse(
            await readFile(join(input.projectRoot, 'project.json'), 'utf8'),
          ) as {
            project_id?: string
            workspaces?: Array<{ workspace_path?: string }>
          }
          return {
            projectId: manifest.project_id ?? '',
            workspaceCreated: (manifest.workspaces ?? []).some((workspace) =>
              (workspace.workspace_path ?? '').endsWith('ws_agent_e2e'),
            ),
          }
        } catch {
          return { projectId: '', workspaceCreated: false }
        }
      },
      { timeout: 180_000 },
    )
    .toEqual({
      projectId: input.originalProjectId
        ? input.originalProjectId
        : expect.stringMatching(/^proj_/),
      workspaceCreated: true,
    })

  await expect
    .poll(
      () =>
        readFile(
          join(workspacePath, 'home', 'workspace_setup_contract.v2.json'),
          'utf8',
        ).catch(() => ''),
      { timeout: 60_000 },
    )
    .toContain('flow-agent.workspace_setup_contract.v2')

  const contract = JSON.parse(
    await readFile(
      join(workspacePath, 'home', 'workspace_setup_contract.v2.json'),
      'utf8',
    ),
  ) as {
    mpc?: { resource_id?: string; spec_path?: string } | null
    mpc_enabled?: boolean
  }
  const usesMpc = input.options.mpc !== 'skip'
  expect(contract.mpc_enabled).toBe(usesMpc)
  if (usesMpc) {
    expect(contract.mpc?.resource_id).toMatch(/^mpc:/)
    expect(contract.mpc?.spec_path).toContain('/spec/spec.json.in')
    expect(contract.mpc?.spec_path).not.toContain('.missing-mpc')
    const installedMpcs = await listInstalledMpcs(page)
    expect(installedMpcs.length).toBeGreaterThan(0)
  } else {
    expect(contract.mpc ?? null).toBeNull()
  }

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('Project ID is required')
  expect(bodyText).not.toContain('Project directory is not empty')
}

async function assertVisibleFailure(
  page: Page,
  options: WorkspaceUiScenario,
  projectRoot: string,
): Promise<void> {
  if (options.mpc === 'unavailable') {
    await expect
      .poll(() => page.locator('body').innerText(), { timeout: 60_000 })
      .toContain(
        'Workspace creation failed: SoC-MPC was selected, but no validated MPC template was resolved.',
      )
  } else if (options.nonEmptyRoot) {
    await expect
      .poll(() => page.locator('body').innerText(), { timeout: 60_000 })
      .toContain('Choose an empty project directory or an existing project.')
    await expect
      .poll(() => page.locator('body').innerText(), { timeout: 30_000 })
      .toContain('Unable to create project at')
  } else {
    throw new Error(`Unexpected failure scenario: ${options.scenario}`)
  }
  await expectNoProjectState(projectRoot)
  expect(await page.locator('body').innerText()).not.toContain('Project ID is required')
}

async function captureUi(page: Page, outDir: string, stage: string): Promise<void> {
  await writeFile(join(outDir, `${stage}-ui.txt`), await page.locator('body').innerText())
  await page.screenshot({ path: join(outDir, `${stage}.png`), fullPage: true })
}

async function expectNoProjectState(projectRoot: string): Promise<void> {
  await expect(readFile(join(projectRoot, 'project.json'), 'utf8')).rejects.toThrow(
    /ENOENT/,
  )
  const entries = await readdir(projectRoot)
  expect(entries).not.toContain('.manifest.lock')
}

async function writeStaleMpcSnapshot(projectRoot: string): Promise<void> {
  const manifestPath = join(projectRoot, 'project.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >
  const missingRoot = join(projectRoot, '.missing-mpc', 'mpc-frame', '0.1.0')
  manifest.mpc = {
    resource_id: 'mpc:mpc-frame',
    display_name: 'MPC Frame',
    installed_version: '0.1.0',
    path: missingRoot,
    spec_path: join(missingRoot, 'spec', 'spec.json.in'),
    design: { index: 0, design_name: 'mpc-frame-template' },
    core_template: { minimum_area: 100 },
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function listInstalledMpcs(page: Page) {
  return await page.evaluate(async () => {
    const response = await window.ecosDesktop.resources.list()
    return response.resources.filter(
      (resource) =>
        resource.type === 'mpc' &&
        resource.status === 'installed' &&
        resource.health.managed === true &&
        resource.health.status === 'ok',
    )
  })
}

async function resolvePdkRoot(): Promise<string> {
  return process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk')
}

async function clickChoice(page: Page, title: string, label: string): Promise<void> {
  const dock = await openInteraction(page, title)
  const button = dock.getByRole('button', {
    name: new RegExp(`^\\d+\\s+${escapeRegExp(label)}$`),
  })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function submitForm(page: Page, title: string, value?: string): Promise<void> {
  const dock = await openInteraction(page, title)
  const card = dock.locator('.interaction-card')
  await card.waitFor({ state: 'visible' })
  if (value !== undefined) {
    const input = card.locator('input[type="text"]').first()
    await input.fill(value)
  }
  const submit = card.getByRole('button', { name: 'Continue', exact: true })
  await submit.waitFor({ state: 'visible' })
  await submit.click()
}

async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await expect.poll(() => input.isEnabled(), { timeout: 60_000 }).toBe(true)
  await input.fill(message)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect.poll(() => input.inputValue()).toBe('')
}

async function openInteraction(page: Page, title: string) {
  const dock = page.locator('details.interaction-dock')
  await dock.waitFor({ state: 'attached', timeout: 60_000 })
  const summary = dock.locator('summary')
  await expect.poll(() => summary.locator('strong').innerText()).toBe(title)
  if (!(await dock.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await summary.click()
  }
  await dock.evaluate((element) => {
    ;(element as HTMLDetailsElement).open = true
  })
  await expect
    .poll(() => dock.evaluate((element) => (element as HTMLDetailsElement).open))
    .toBe(true)
  return dock
}
