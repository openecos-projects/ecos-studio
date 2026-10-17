import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareDesign, type E2EDesign } from './support/design'
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

async function readFlowSteps(
  workspaceDir: string,
): Promise<Array<{ name: string; state: string }>> {
  const flow = JSON.parse(
    await readFile(join(workspaceDir, 'home/flow.json'), 'utf8'),
  ) as {
    steps?: Array<{ name?: string; id?: string; state?: string }>
  }
  return (flow.steps ?? []).map((step) => ({
    name: step.name ?? step.id ?? '?',
    state: step.state ?? '?',
  }))
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
      const rtlSource = design.rtlImport.verilog?.[0]
      if (!rtlSource) throw new Error('The CLI E2E requires a Verilog RTL source.')

      const setupCommand = [
        `rm -rf "${projectRoot}"`,
        `mkdir -p "${projectRoot}"`,
        `ecc init "${projectRoot}" --project-name gcd-cli-e2e --design-name ${design.designName} --plain > "${outDir}/cli-init.log" 2>&1; a=$?`,
        `ecc rtl import --project "${projectRoot}" --verilog "${rtlSource}" --plain > "${outDir}/cli-rtl.log" 2>&1; b=$?`,
        `ecc pdk set-root "${pdkRoot}" --project "${projectRoot}" --plain > "${outDir}/cli-pdk.log" 2>&1; c=$?`,
        `ecc workspace create default --project "${projectRoot}" --plain > "${outDir}/cli-workspace.log" 2>&1; d=$?`,
        `printf 'init=%s rtl=%s pdk=%s workspace=%s\n' "$a" "$b" "$c" "$d" > "${setupMarker}"`,
      ].join('; ')
      await typeTerminalCommand(page, setupCommand)
      await waitForFile(setupMarker, 180_000)
      expect(await readFile(setupMarker, 'utf8')).toContain(
        'init=0 rtl=0 pdk=0 workspace=0',
      )

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

      const command = [
        `ecc run --project "${projectRoot}" --workspace default --plain > "${runLog}" 2>&1; printf 'run=%s\n' "$?" > "${runMarker}"`,
      ].join('; ')
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
    },
    FLOW_TIMEOUT_MS + 300_000,
  )
})
