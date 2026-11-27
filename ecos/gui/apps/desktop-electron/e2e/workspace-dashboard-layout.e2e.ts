import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import type { Page } from 'playwright-core'
import { shellQuote } from '../electron/services/cliInstallerArtifacts'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareGcdProject } from './support/design'
import { readFlowSteps } from './support/flow'
import {
  createDefaultWorkspace,
  importExternalPdk,
  openWorkspaceInUi,
  readOperationLog,
  runWorkspaceStep,
  setupBackendWorkspace,
  typeTerminalCommand,
  waitFlowTerminal,
  type WorkspaceJourney,
} from './support/journey'
import { createMilestoneShots } from './support/screenshots'

async function readLayout(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!
      const bounds = element.getBoundingClientRect()
      const width = selector === '.flow-scroll' ? element.clientWidth : bounds.width
      const height = selector === '.flow-scroll' ? element.clientHeight : bounds.height
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.left + width,
        bottom: bounds.top + height,
        width,
        height,
      }
    }
    return {
      flow: rect('.workspace-flow-dashboard'),
      overview: rect('.flow-overview'),
      qor: rect('.qor-card'),
      viewport: rect('.flow-scroll'),
      canvas: rect('.flow-canvas'),
      visibleStepCount: Array.from(
        document.querySelectorAll<HTMLElement>('.flow-step-card'),
      ).filter((card) => {
        const bounds = card.getBoundingClientRect()
        const viewport = rect('.flow-scroll')
        return (
          bounds.left < viewport.right &&
          bounds.right > viewport.left &&
          bounds.top < viewport.bottom &&
          bounds.bottom > viewport.top
        )
      }).length,
      overflowing: Array.from(
        document.querySelectorAll<HTMLElement>('.qor-card, .flow-status-card'),
      )
        .filter(
          (element) =>
            element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => element.className),
    }
  })
}

function insideViewport(
  card: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; right: number; top: number; bottom: number },
): boolean {
  return (
    card.left >= viewport.left - 1 &&
    card.right <= viewport.right + 1 &&
    card.top >= viewport.top - 1 &&
    card.bottom <= viewport.bottom + 1
  )
}

describe('workspace dashboard layout', () => {
  let launched: E2EApp | undefined
  let workspace: WorkspaceJourney
  let shot: ReturnType<typeof createMilestoneShots>

  beforeAll(async () => {
    const outDir = await resolveOutDir('workspace-dashboard-layout')
    const design = await prepareGcdProject(join(outDir, 'work'))
    launched = await launchE2EApp(outDir)
    shot = createMilestoneShots(launched.page, outDir)
    workspace = await setupBackendWorkspace(launched.page, {
      ...design,
      pdkRoot: process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
    })
    await launched.page.locator('.flow-step-card').first().waitFor({ state: 'attached' })
  }, 180_000)

  afterAll(async () => {
    await launched?.close()
  })

  async function createSiblingWorkspace(name: string): Promise<WorkspaceJourney> {
    const { page, outDir } = launched!
    const design = await prepareGcdProject(join(outDir, 'work'))
    const project = await page.evaluate(
      (root) => window.ecosDesktop.projectManagement.readManifest(root),
      workspace.projectRoot,
    )
    const pdkInstallationId = await importExternalPdk(
      page,
      process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
    )
    return createDefaultWorkspace(page, {
      ...design,
      projectId: project!.project_id,
      pdkInstallationId,
      workspaceName: name,
    })
  }

  async function resize(width: number, height: number) {
    await launched!.app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height)
      },
      { width, height },
    )
    await expect.poll(() => launched!.page.evaluate(() => window.innerWidth)).toBe(width)
  }

  async function assertClearLayout() {
    await expect
      .poll(async () => {
        const layout = await readLayout(launched!.page)
        return {
          qorInViewport: insideViewport(layout.qor, layout.viewport),
          overflowing: layout.overflowing,
        }
      })
      .toEqual({
        qorInViewport: true,
        overflowing: [],
      })
  }

  it('renders the LVS icon in the workspace sidebar', async () => {
    const link = launched!.page.getByRole('link', { name: 'LVS', exact: true })
    const icon = link.locator('i[aria-hidden="true"]')
    await expect
      .poll(() =>
        icon.evaluate((element) => getComputedStyle(element, '::before').content),
      )
      .not.toMatch(/^(?:none|normal|""|)$/)
    await shot('workspace-sidebar-lvs')
  })

  it('shows ECC parallel groups and distinguishes the two run scopes', async () => {
    const page = launched!.page
    const rcx = page.locator('.flow-step-card[data-step="rcx"]')
    const drc = page.locator('.flow-step-card[data-step="drc"]')
    const sta = page.locator('.flow-step-card[data-step="sta"]')
    await expect.poll(() => rcx.getAttribute('data-stage')).toMatch(/^\d+$/)
    expect(await drc.getAttribute('data-stage')).toBe(
      await rcx.getAttribute('data-stage'),
    )
    expect(await sta.getAttribute('data-stage')).not.toBe(
      await rcx.getAttribute('data-stage'),
    )
    expect(await page.locator('.flow-parallel-group').count()).toBeGreaterThan(0)
    await shot('worker-flow-stages')
    await sta.getByRole('button', { name: /run sta/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Run STA', exact: true })
    await dialog.getByText('parasitics', { exact: true }).waitFor()
    expect(await dialog.getByText('RCX', { exact: true }).count()).toBe(1)
    if (process.env.ECOS_E2E_WORKSPACE_FLOW_PLAN === '1') {
      await dialog.getByText('Design input', { exact: true }).waitFor()
      expect(
        await dialog
          .getByText('Design input', { exact: true })
          .locator('+ dd')
          .textContent(),
      ).toBe('Filler')
    }
    await dialog.getByRole('button', { name: 'Run current step', exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Run from this step', exact: true }).click()
    const confirmation = page.getByRole('dialog', {
      name: 'Run from this step?',
      exact: true,
    })
    await confirmation
      .getByRole('button', { name: 'Run from this step', exact: true })
      .waitFor()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  })

  it.each([
    [1440, 1000],
    [1280, 800],
    [1024, 768],
  ])('keeps cards readable and clear of steps at %s × %s', async (width, height) => {
    await resize(width, height)
    try {
      await assertClearLayout()
      const layout = await readLayout(launched!.page)
      expect(layout.visibleStepCount).toBeGreaterThan(0)
      expect(layout.qor.width).toBeLessThan(layout.flow.width)
      if (width >= 1280) {
        // The top overlay cards share one stretched height.
        expect(layout.qor.height).toBeGreaterThan(0)
      }
      await expect
        .poll(async () => {
          const { canvas, viewport } = await readLayout(launched!.page)
          return Math.max(
            Math.abs(canvas.left + canvas.width / 2 - viewport.left - viewport.width / 2),
            Math.abs(canvas.top + canvas.height / 2 - viewport.top - viewport.height / 2),
          )
        })
        // Chromium reserves a few pixels for the stable scrollbar gutters; keep
        // the assertion focused on meaningful drift rather than subpixel layout.
        .toBeLessThan(12)
    } finally {
      await shot(`dashboard-${width}x${height}`)
    }
  })

  it('reports a rejected run even when every step remains unstarted', async () => {
    const page = launched!.page
    const operation = (await page.evaluate(
      (payload) =>
        window.ecosDesktop.productCommands.execute({ command: 'workspace.run', payload }),
      {
        workspaceHandle: workspace.workspaceHandle,
        expectedWorkspaceRevision: workspace.workspaceRevision + 100,
        idempotencyKey: randomUUID(),
      },
    )) as { operationId: string }
    await expect
      .poll(async () => {
        const projection = await page.evaluate(() =>
          window.ecosDesktop.ecc.runtime.operationProjection(),
        )
        return projection.outcomes.find(
          ({ operationId }) => operationId === operation.operationId,
        )
      })
      .toMatchObject({ state: 'failed', error: { code: 'revision_conflict' } })
    expect(
      (await readFlowSteps(workspace.workspaceDir)).every(
        (step) => step.state === 'Unstart',
      ),
    ).toBe(true)
    expect(await readOperationLog(page, workspace, operation.operationId)).toContain(
      'error=revision_conflict',
    )
  })

  it('exports the original STA failure from notifications after reopening the workspace', async () => {
    const page = launched!.page
    const card = page.locator('.flow-step-card[data-step="sta"]')
    await card.getByRole('button', { name: /run sta/i }).click()
    const run = page.getByRole('dialog', { name: 'Run STA', exact: true })
    await run.getByRole('button', { name: 'Run current step', exact: true }).click()
    await expect
      .poll(() => card.getAttribute('data-status'), { timeout: 30_000 })
      .toBe('failed')
    await expect
      .poll(() => card.locator('.step-failure').textContent())
      .toMatch(/missing filled, parasitics/)
    await run.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Open notifications' }).click()
    const notifications = page.getByRole('dialog', { name: 'Notifications' })
    const failure = notifications
      .locator('.notification-item')
      .filter({ hasText: /missing filled, parasitics/ })
    await failure.waitFor()
    await failure.getByText('View details').click()
    await expect
      .poll(() => failure.locator('code').textContent())
      .toMatch(/Log: .*\/log\/.+\.log/)
    await failure.getByRole('button', { name: 'Save run diagnostics' }).waitFor()
    const firstRun = await page.evaluate(async () => {
      const runtime = window.ecosDesktop.ecc.runtime
      const projection = await runtime.operationProjection()
      const operation = projection.outcomes.find(
        ({ error }) => error?.code === 'step_worker_failed',
      )
      if (!operation) return
      const request = {
        workspaceHandle: operation.workspaceHandle,
        operationId: operation.operationId,
        includeDiagnostics: true,
      }
      return { request, report: (await runtime.operationLog(request)).diagnostics }
    })
    expect(firstRun?.report).toContain('missing filled, parasitics')
    const firstAttempt = firstRun?.report?.match(
      /Failed worker attempts\s+sta \(([^)]+)\)/,
    )?.[1]
    expect(firstAttempt).toBeTruthy()
    expect(firstRun?.report).toMatch(
      /Studio session log entries for this run\s+.*ECC run/,
    )
    await shot('sta-worker-failure')
    await page.getByRole('button', { name: 'Open notifications' }).click()

    const rerunId = await page.evaluate(async ({ workspaceHandle }) => {
      const runtime = window.ecosDesktop.ecc.runtime
      const snapshot = (await runtime.snapshot({ workspaceHandle })) as {
        engineeringSnapshot: { workspaceRevision: number }
      }
      const rerun = (await window.ecosDesktop.productCommands.execute({
        command: 'workspace.runStep',
        payload: {
          workspaceHandle,
          expectedWorkspaceRevision: snapshot.engineeringSnapshot.workspaceRevision,
          idempotencyKey: crypto.randomUUID(),
          step: 'sta',
          rerun: true,
        },
      })) as { operationId: string }
      await runtime.waitForOperation({ workspaceHandle, operationId: rerun.operationId })
      return rerun.operationId
    }, firstRun!.request)
    expect(rerunId).not.toBe(firstRun!.request.operationId)
    await expect
      .poll(
        async () =>
          (await readFlowSteps(workspace.workspaceDir)).find(({ name }) => name === 'sta')
            ?.state,
      )
      .toBe('Incomplete')

    const other = await createSiblingWorkspace('reopen-control')
    await openWorkspaceInUi(page, other)
    await openWorkspaceInUi(page, { ...workspace, creationId: undefined })
    const reopened = await page.evaluate(
      (directory) =>
        window.ecosDesktop.runtime.workspace.open({ designTool: 'backend', directory }),
      workspace.workspaceDir,
    )
    expect(reopened.workspaceHandle).not.toBe(firstRun!.request.workspaceHandle)
    workspace.workspaceHandle = reopened.workspaceHandle

    const saveOriginalFailure = async (filename: string) => {
      const savePath = join(launched!.outDir, filename)
      await launched!.app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, savePath)
      await page.getByRole('button', { name: 'Open notifications' }).click()
      const firstFailure = notifications.locator('.notification-item').filter({
        has: page.locator('code', { hasText: firstRun!.request.operationId }),
      })
      const exportButton = firstFailure.getByRole('button', {
        name: 'Save run diagnostics',
      })
      if (!(await exportButton.isVisible()))
        await firstFailure.getByText('View details').click()
      await exportButton.click()
      await expect
        .poll(() => readFile(savePath, 'utf8').catch(() => ''))
        .toBe(firstRun!.report)
      await page.getByRole('button', { name: 'Open notifications' }).click()
    }
    await saveOriginalFailure('sta-first-run.txt')
    await openWorkspaceInUi(page, { ...other, creationId: undefined })
    await expect(
      page.evaluate(
        (workspaceHandle) => window.ecosDesktop.ecc.runtime.snapshot({ workspaceHandle }),
        reopened.workspaceHandle,
      ),
    ).rejects.toThrow('Workspace Session is not open')
    await saveOriginalFailure('sta-closed-again.txt')
    await openWorkspaceInUi(page, { ...workspace, creationId: undefined })
    workspace.workspaceHandle = await page.evaluate(
      async (directory) =>
        (
          await window.ecosDesktop.runtime.workspace.open({
            designTool: 'backend',
            directory,
          })
        ).workspaceHandle,
      workspace.workspaceDir,
    )
  })

  it('keeps the same cards outside the canvas during zoom, pan, and fit', async () => {
    const page = launched!.page
    await resize(1440, 1000)
    const qorCard = await page.locator('.qor-card').elementHandle()
    await page.getByRole('slider', { name: 'Flow diagram zoom' }).fill('1')
    await page.locator('.flow-scroll').evaluate((element) => {
      element.scrollLeft += 100
      element.scrollTop += 100
    })
    await assertClearLayout()
    await page.getByRole('button', { name: 'Fit flow diagram', exact: true }).click()
    await expect
      .poll(async () => {
        const { canvas, viewport } = await readLayout(page)
        return {
          fits:
            canvas.width <= viewport.width + 1 && canvas.height <= viewport.height + 1,
          centered:
            Math.abs(
              canvas.left + canvas.width / 2 - viewport.left - viewport.width / 2,
            ) < 12 &&
            Math.abs(
              canvas.top + canvas.height / 2 - viewport.top - viewport.height / 2,
            ) < 12,
        }
      })
      .toEqual({ fits: true, centered: true })
    expect(
      await qorCard!.evaluate(
        (element) => element === document.querySelector('.qor-card'),
      ),
    ).toBe(true)
    await shot('dashboard-fit')
    await assertClearLayout()
  })

  it('preserves card readability and clear steps in the alternate theme', async () => {
    const page = launched!.page
    await page.locator('button[title="Switch to dark theme"]').click()
    expect(await page.locator('html').getAttribute('class')).toContain('dark')
    await assertClearLayout()
    await shot('dashboard-dark')
    await page.locator('button[title="Switch to light theme"]').click()
  })

  it('keeps cards clear when the Agent panel reduces the available width', async () => {
    const page = launched!.page
    await resize(1024, 768)
    await page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
    try {
      await page.getByRole('slider', { name: 'Flow diagram zoom' }).fill('0.75')
      await page.locator('.flow-scroll').evaluate((element) => {
        element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
        element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
      })
      await assertClearLayout()
      const layout = await readLayout(page)
      expect(layout.qor.width).toBeLessThan(layout.flow.width)
      expect(layout.visibleStepCount).toBeGreaterThan(0)
      await shot('dashboard-with-agent')
    } finally {
      await page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
    }
  })

  it('shows cancellation in notifications and Run History when ECC cancels a GUI run', async () => {
    const { page } = launched!
    await page.locator('.flow-run-icon-button').click()
    const live = async () => {
      const projection = await page.evaluate(() =>
        window.ecosDesktop.ecc.runtime.operationProjection(),
      )
      return projection.operations.find(
        ({ workspaceDirectory }) => workspaceDirectory === workspace.workspaceDir,
      )
    }
    let operationId = ''
    await expect
      .poll(
        async () => {
          const operation = await live()
          if (
            operation?.origin === 'gui' &&
            operation.flow?.steps.some(({ state }) => state === 'Ongoing')
          ) {
            operationId = operation.operationId
          }
          return operationId
        },
        { timeout: 90_000 },
      )
      .toBeTruthy()

    await typeTerminalCommand(
      page,
      [
        'ecc',
        'process',
        'cancel',
        '--project',
        workspace.projectRoot,
        '--workspace',
        workspace.workspaceDir,
        '--run-id',
        operationId,
        '--plain',
      ]
        .map(shellQuote)
        .join(' '),
    )
    await page.locator('.status-terminal-toggle').click()
    const terminal = await page.evaluate(
      (request) => window.ecosDesktop.ecc.runtime.waitForOperation(request),
      { workspaceHandle: workspace.workspaceHandle, operationId },
    )
    expect(terminal.state).toBe('cancelled')
    await page.getByRole('button', { name: 'Open notifications' }).click()
    const notifications = page.getByRole('dialog', { name: 'Notifications' })
    await notifications.getByText('Flow cancelled', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Open notifications' }).click()

    await page.getByRole('button', { name: 'Run History' }).click()
    const history = page.getByRole('dialog', { name: 'Run history' })
    const row = history.getByRole('row').filter({ hasText: operationId })
    await row.getByRole('cell', { name: /^Cancelled/ }).waitFor()
    await shot('externally-cancelled-gui-run')
    await history.getByRole('button', { name: 'Close run history' }).click()
  }, 180_000)

  it('limits waiting cards and follows the step log through a bounded CLI run', async () => {
    const { app, page } = launched!
    const synthesis = page.locator('.flow-step-card[data-step="synthesis"]')
    const downstream = page.locator('.flow-step-card[data-step="placement"]')
    const operationId = randomUUID()
    await typeTerminalCommand(
      page,
      [
        'ecc',
        'run',
        '--project',
        workspace.projectRoot,
        '--workspace',
        workspace.workspaceDir,
        '--from',
        'synthesis',
        '--to',
        'synthesis',
        '--run-id',
        operationId,
        '--plain',
      ]
        .map(shellQuote)
        .join(' '),
    )
    await page.locator('.status-terminal-toggle').click()
    await expect
      .poll(() => synthesis.getAttribute('data-status'), { timeout: 90_000 })
      .toBe('running')
    const projection = await page.evaluate(() =>
      window.ecosDesktop.ecc.runtime.operationProjection(),
    )
    expect(
      projection.operations.find((operation) => operation.operationId === operationId),
    ).toMatchObject({
      origin: 'cli',
      flowScope: { fromStep: 'synthesis', throughStep: 'synthesis' },
    })
    expect(await downstream.locator('.step-execution-state').textContent()).toBe(
      'Not started',
    )
    await shot('bounded-cli-run')

    await synthesis.getByRole('button', { name: 'Synthesis log', exact: true }).click()
    const log = page.getByRole('dialog', { name: 'Synthesis — Log', exact: true })
    const copy = log.getByRole('button', { name: /^(Copied|Copy) log$/ })
    await expect.poll(() => copy.isEnabled()).toBe(true)
    const terminal = await waitFlowTerminal(page, workspace, operationId, 90_000)
    expect(terminal.state).toBe('succeeded')
    const steps = await readFlowSteps(workspace.workspaceDir)
    expect(steps.find(({ name }) => name === 'placement')?.state).toBe('Unstart')

    const logText = await readFile(
      join(workspace.workspaceDir, '01_synthesis_yosys/log/synthesis.log'),
      'utf8',
    )
    const lastLine = stripVTControlCharacters(logText).trimEnd().split('\n').at(-1)!
    expect(lastLine).toBeTruthy()
    await expect
      .poll(
        async () => {
          await copy.click()
          return app.evaluate(({ clipboard }) => clipboard.readText())
        },
        { timeout: 15_000 },
      )
      .toContain(lastLine)
    await shot('bounded-cli-step-log')
    await log.getByRole('button', { name: 'Close', exact: true }).click()
  }, 180_000)

  it('shows a saved run with only an endpoint in history and diagnostics', async () => {
    const { page } = launched!
    const operationId = randomUUID()
    const logs = join(workspace.workspaceDir, 'log')
    const finishedAt = Math.floor(Date.now() / 1000)
    await mkdir(logs, { recursive: true })
    await writeFile(
      join(logs, operationId + '.run.json'),
      JSON.stringify({
        schema_version: 1,
        run_id: operationId,
        workspace_id: basename(workspace.workspaceDir),
        started_at: finishedAt - 1,
        finished_at: finishedAt,
        state: 'succeeded',
        through_step: 'synthesis',
      }),
    )
    await writeFile(join(logs, operationId + '.log'), 'Saved ECC run\n')
    await page.getByRole('button', { name: 'Run History' }).click()
    const history = page.getByRole('dialog', { name: 'Run history' })
    await expect
      .poll(() => history.getByRole('row').filter({ hasText: operationId }).innerText())
      .toContain('Run through Synthesis')
    const report = await page.evaluate(
      (request) => window.ecosDesktop.ecc.runtime.operationLog(request),
      {
        workspaceHandle: workspace.workspaceHandle,
        operationId,
        includeDiagnostics: true,
      },
    )
    expect(report.diagnostics).toContain('Scope: start → synthesis')
    await history.getByRole('button', { name: 'Close run history' }).click()
  })

  it('reloads the completed step log after rerunning with its dialog closed', async () => {
    const { app, page } = launched!
    const sibling = await createSiblingWorkspace('rerun-log')
    await openWorkspaceInUi(page, sibling)
    try {
      expect((await runWorkspaceStep(page, sibling, 'synthesis', 90_000)).state).toBe(
        'succeeded',
      )
      const path = join(sibling.workspaceDir, '01_synthesis_yosys/log/synthesis.log')
      const oldMarker = 'Log from the first synthesis attempt'
      await appendFile(path, '\n' + oldMarker + '\n')
      const card = page.locator('.flow-step-card[data-step="synthesis"]')
      const log = page.getByRole('dialog', { name: 'Synthesis — Log', exact: true })
      const openLog = () =>
        card.getByRole('button', { name: 'Synthesis log', exact: true }).click()
      const copyLog = async () => {
        await log.getByRole('button', { name: /^(Copied|Copy) log$/ }).click()
        return await app.evaluate(({ clipboard }) => clipboard.readText())
      }
      await openLog()
      await expect.poll(copyLog).toContain(oldMarker)
      await log.getByRole('button', { name: 'Close', exact: true }).click()

      const rerun = (await page.evaluate(
        (payload) =>
          window.ecosDesktop.productCommands.execute({
            command: 'workspace.runStep',
            payload,
          }),
        {
          workspaceHandle: sibling.workspaceHandle,
          expectedWorkspaceRevision: sibling.workspaceRevision,
          idempotencyKey: randomUUID(),
          step: 'synthesis',
          rerun: true,
        },
      )) as { operationId: string }
      expect(
        (await waitFlowTerminal(page, sibling, rerun.operationId, 90_000)).state,
      ).toBe('succeeded')
      const nextLog = stripVTControlCharacters(await readFile(path, 'utf8'))
      expect(nextLog).not.toContain(oldMarker)
      const lastLine = nextLog.trimEnd().split('\n').at(-1)
      expect(lastLine).toBeTruthy()
      await openLog()
      await expect.poll(copyLog).toContain(lastLine)
      expect(await copyLog()).not.toContain(oldMarker)
      await log.getByRole('button', { name: 'Close', exact: true }).click()
    } finally {
      await openWorkspaceInUi(page, { ...workspace, creationId: undefined })
      const opened = await page.evaluate(
        (directory) =>
          window.ecosDesktop.runtime.workspace.open({ designTool: 'backend', directory }),
        workspace.workspaceDir,
      )
      workspace.workspaceHandle = opened.workspaceHandle
      workspace.workspaceRevision =
        opened.workspaceRevision ?? workspace.workspaceRevision
    }
  }, 180_000)

  it('keeps diagnostics separate when two workspaces reuse the same run ID', async () => {
    const { page } = launched!
    const failed = await runWorkspaceStep(page, workspace, 'sta', 60_000)
    expect(failed.state).toBe('failed')
    const operationId = failed.operationId
    const getDiagnostics = (workspaceHandle: string) =>
      page.evaluate((request) => window.ecosDesktop.ecc.runtime.operationLog(request), {
        workspaceHandle,
        operationId,
        includeDiagnostics: true,
      })
    const original = await getDiagnostics(workspace.workspaceHandle)
    expect(original.diagnostics).toContain('missing filled, parasitics')

    const second = await createSiblingWorkspace('independent')
    await typeTerminalCommand(
      page,
      [
        'ecc',
        'run',
        '--project',
        second.projectRoot,
        '--workspace',
        second.workspaceDir,
        '--only',
        'synthesis',
        '--run-id',
        operationId,
        '--log-file',
        `log/${operationId}.log`,
        '--plain',
      ]
        .map(shellQuote)
        .join(' '),
    )
    await page.locator('.status-terminal-toggle').click()
    const receiptPath = join(second.workspaceDir, 'log', `${operationId}.run.json`)
    await expect
      .poll(
        () =>
          readFile(receiptPath, 'utf8')
            .then((source) => JSON.parse(source))
            .catch(() => null),
        { timeout: 90_000 },
      )
      .toMatchObject({
        state: 'succeeded',
        run_id: operationId,
        workspace_id: 'independent',
      })
    const report = await getDiagnostics(second.workspaceHandle)
    expect(report.diagnostics).toContain('Workspace: independent\n')
    expect(report.diagnostics).toContain('State: succeeded\n')
    expect(report.diagnostics).not.toContain('missing filled, parasitics')
    expect(await getDiagnostics(workspace.workspaceHandle)).toEqual(original)
  }, 180_000)

  it('runs a single step and then runs the remaining steps from the selected start', async () => {
    const outDir = await resolveOutDir('workspace-run-scopes')
    const design = await prepareGcdProject(join(outDir, 'work'))
    const { page, close } = await launchE2EApp(outDir)
    const capture = createMilestoneShots(page, outDir)
    try {
      const workspace = await setupBackendWorkspace(page, {
        ...design,
        flowRange: { fromStepId: 'synthesis', throughStepId: 'macro_placement' },
        pdkRoot: process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
      })
      const openRun = async (id: string, label: string) => {
        await page
          .locator(`.flow-step-card[data-step="${id}"]`)
          .getByRole('button', { name: `Not started — run ${label}`, exact: true })
          .click()
        return page.getByRole('dialog', { name: `Run ${label}`, exact: true })
      }
      const synthesis = await openRun('synthesis', 'Synthesis')
      await synthesis
        .getByRole('button', { name: 'Run current step', exact: true })
        .click()
      await expect
        .poll(() => page.locator('[data-step="synthesis"]').getAttribute('data-status'), {
          timeout: 120_000,
        })
        .toBe('succeeded')
      const synthesisCard = page.locator('.flow-step-card[data-step="synthesis"]')
      await expect
        .poll(() =>
          synthesisCard.locator('.step-resources dd').evaluateAll((values) => {
            const card = values[0]!.closest('.flow-step-card')!.getBoundingClientRect()
            return values.map((value) => {
              const range = document.createRange()
              range.selectNodeContents(value)
              const lines = range.getClientRects()
              return (
                lines.length === 1 &&
                lines[0]!.left >= card.left &&
                lines[0]!.right <= card.right &&
                value.textContent?.trim() !== '--'
              )
            })
          }),
        )
        .toEqual([true, true])
      const states = async () =>
        (await readFlowSteps(workspace.workspaceDir)).map(({ name, state }) => [
          name,
          state,
        ])
      expect(await states()).toEqual([
        ['synthesis', 'Success'],
        ['pre_floorplan', 'Unstart'],
        ['macro_placement', 'Unstart'],
      ])
      await synthesis.getByRole('button', { name: 'Close', exact: true }).click()
      await synthesisCard
        .getByRole('button', { name: 'Synthesis log', exact: true })
        .click()
      const synthesisLog = page.getByRole('dialog', {
        name: 'Synthesis — Log',
        exact: true,
      })
      await expect
        .poll(() =>
          synthesisLog.getByRole('button', { name: 'Copy log', exact: true }).isEnabled(),
        )
        .toBe(true)
      await synthesisLog.getByRole('button', { name: 'Close', exact: true }).click()
      await synthesisCard.screenshot({ path: join(outDir, 'synthesis-card-metrics.png') })

      const floorplan = await openRun('pre_floorplan', 'Pre Floorplan')
      const fromHere = { name: 'Run from this step', exact: true }
      await floorplan.getByRole('button', fromHere).click()
      const confirmation = page.getByRole('dialog', {
        name: 'Run from this step?',
        exact: true,
      })
      await confirmation.getByText(/Run Pre Floorplan and the later steps/).waitFor()
      await confirmation.screenshot({
        path: join(outDir, 'confirm-run-from-step.png'),
        animations: 'disabled',
      })
      await confirmation.getByRole('button', fromHere).click()
      await expect.poll(states, { timeout: 120_000 }).toEqual([
        ['synthesis', 'Success'],
        ['pre_floorplan', 'Success'],
        ['macro_placement', 'Success'],
      ])
      await expect
        .poll(() =>
          page.locator('[data-step="macro_placement"]').getAttribute('data-status'),
        )
        .toBe('succeeded')
      await floorplan.getByRole('button', { name: 'Close', exact: true }).click()
      await capture('run-from-step-succeeded')
    } catch (error) {
      await capture('failure').catch(() => undefined)
      throw error
    } finally {
      await close()
    }
  }, 300_000)
})
