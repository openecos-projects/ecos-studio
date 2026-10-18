import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareDesign, type E2EDesign } from './support/design'
import { readChecklistCardMismatches, readFlowSteps } from './support/flow'
import { shellQuote } from '../electron/services/cliInstallerArtifacts'
import { createMilestoneShots } from './support/screenshots'
import {
  openWorkspaceInUi,
  registerWorkspaceRoot,
  waitToolchainReady,
  type WorkspaceJourney,
} from './support/journey'

const FLOW_TIMEOUT_MS = 75 * 60_000

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (
      await access(path)
        .then(() => true)
        .catch(() => false)
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`file did not appear within ${timeoutMs}ms: ${path}`)
}

async function typeTerminalCommand(page: E2EApp['page'], command: string): Promise<void> {
  const terminal = page.locator('.ecos-terminal-panel')
  if (!(await terminal.isVisible())) await page.locator('.status-terminal-toggle').click()
  const input = page.locator('.xterm-helper-textarea')
  await input.waitFor({ state: 'attached' })
  await input.click()
  await page.keyboard.insertText(command)
  await page.keyboard.press('Enter')
}

describe('product e2e: CLI-started rtl2gds journey', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>
  let outDir: string
  let design: E2EDesign
  let workspace: WorkspaceJourney

  beforeAll(async () => {
    outDir = await resolveOutDir('cli-flow')
    await mkdir(join(outDir, 'work'), { recursive: true })
    design = await prepareDesign(join(outDir, 'work'))
    launched = await launchE2EApp(outDir)
    shot = createMilestoneShots(launched.page, outDir)
    await waitToolchainReady(launched.page)
  }, 180_000)

  afterAll(async () => {
    await launched?.close()
  })

  it(
    'runs rtl2gds from the built-in Terminal and synchronizes the Workspace page',
    async () => {
      const page = launched!.page
      const projectRoot = design.projectRoot
      const workspaceDir = join(projectRoot, 'default')
      const setupMarker = join(outDir, 'cli-setup.result')
      const runMarker = join(outDir, 'cli-run.result')
      const runLog = join(outDir, 'cli-run.log')
      const pdkRoot =
        process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk')
      const setupScript = join(outDir, 'cli-setup.sh')
      const setupLog = join(outDir, 'cli-setup.log')
      const eccCommand = (...args: string[]) =>
        ['ecc', ...args, '--project', projectRoot, '--plain'].map(shellQuote).join(' ')
      const rtlArgs = design.rtlImport.filelist
        ? ['--filelist', design.rtlImport.filelist]
        : (design.rtlImport.verilog ?? []).flatMap((path) => ['--verilog', path])
      if (!rtlArgs.length) throw new Error('The CLI E2E requires RTL sources.')
      const parameters = {
        'design.frequency_mhz': design.frequencyMhz,
        ...design.parameters,
      }
      await writeFile(
        setupScript,
        [
          'set -euo pipefail',
          [
            'ecc',
            'init',
            projectRoot,
            '--project-name',
            `${design.name}-cli-e2e`,
            '--design-name',
            design.designName,
            '--plain',
          ]
            .map(shellQuote)
            .join(' '),
          eccCommand('rtl', 'import', ...rtlArgs),
          eccCommand('pdk', 'set-root', pdkRoot),
          eccCommand('project', 'set', 'design.top', design.topModule),
          eccCommand('project', 'set', 'design.clock_port', design.clockPort),
          ...design.inputs.map((input) => {
            if (input.role !== 'sdc')
              throw new Error(`Unsupported CLI E2E input: ${input.role}`)
            return eccCommand('project', 'set', 'design.sdc', input.path)
          }),
          ...Object.entries(parameters).map(([key, value]) =>
            eccCommand(
              'param',
              'set',
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            ),
          ),
          eccCommand('workspace', 'create', 'default'),
          '',
        ].join('\n'),
      )
      const setupCommand = `bash ${shellQuote(setupScript)} > ${shellQuote(setupLog)} 2>&1; printf 'setup=%s\\n' "$?" > ${shellQuote(setupMarker)}`
      await typeTerminalCommand(page, setupCommand)
      await waitForFile(setupMarker, 180_000)
      const setupOutput = await readFile(setupLog, 'utf8')
      expect(
        await readFile(setupMarker, 'utf8'),
        `CLI setup output:\n${setupOutput}`,
      ).toContain('setup=0')

      workspace = {
        projectRoot,
        workspaceDir,
        workspaceHandle: '',
        workspaceRevision: 1,
        designName: design.designName,
      }
      await registerWorkspaceRoot(page, workspaceDir)
      await openWorkspaceInUi(page, workspace)
      await page.locator('.workspace-flow-dashboard .flow-step-card').first().waitFor()

      const flowDashboard = page.locator('.workspace-flow-dashboard')
      const runControl = flowDashboard.locator('.flow-header .flow-run-icon-button')
      const readFlowCardStatus = async (stepName: string) =>
        flowDashboard.locator('.flow-step-card').evaluateAll((cards, name) => {
          const card = cards.find(
            (item) =>
              item.getAttribute('data-step') === name ||
              item.querySelector('header')?.textContent?.trim() === name,
          )
          return card?.getAttribute('data-status') ?? null
        }, stepName)

      const command = `${eccCommand('run', '--workspace', 'default')} > ${shellQuote(runLog)} 2>&1; printf 'run=%s\\n' "$?" > ${shellQuote(runMarker)}`
      await typeTerminalCommand(page, command)
      if (await page.locator('.ecos-terminal-panel').isVisible()) {
        await page.locator('.status-terminal-toggle').click()
      }

      await shot('cli-flow-started', '#/workspace/home')
      await expect
        .poll(
          async () => {
            const step = (await readFlowSteps(workspaceDir)).find(
              (candidate) => candidate.state === 'Ongoing',
            )
            return {
              step: step?.name ?? null,
              cardStatus: step ? await readFlowCardStatus(step.name) : null,
              runBusy: await runControl.getAttribute('aria-busy'),
            }
          },
          { timeout: 120_000 },
        )
        .toMatchObject({ cardStatus: 'running', runBusy: 'true' })
      await shot('cli-flow-running')

      await waitForFile(runMarker, FLOW_TIMEOUT_MS)
      expect(await readFile(runMarker, 'utf8')).toContain('run=0')
      expect(await readFile(runLog, 'utf8')).toContain(
        'workspace_id=default status=success',
      )
      await expect
        .poll(
          async () => {
            const steps = await readFlowSteps(workspaceDir)
            const cards = await flowDashboard
              .locator('.flow-step-card')
              .evaluateAll((items) =>
                items.map((item) => item.getAttribute('data-status')),
              )
            return {
              allSuccess:
                steps.length > 0 && steps.every((step) => step.state === 'Success'),
              cardsSucceeded:
                cards.length === steps.length &&
                cards.every((status) => status === 'succeeded'),
              runBusy: await runControl.getAttribute('aria-busy'),
            }
          },
          { timeout: 60_000 },
        )
        .toEqual({ allSuccess: true, cardsSucceeded: true, runBusy: 'false' })
      await shot('cli-flow-completed')
      await expect
        .poll(() => readChecklistCardMismatches(page, workspaceDir), {
          timeout: 30_000,
        })
        .toEqual([])
    },
    FLOW_TIMEOUT_MS + 300_000,
  )
})
