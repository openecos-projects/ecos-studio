import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareGcdProject } from './support/design'
import { readFlowSteps } from './support/flow'
import {
  readOperationLog,
  setupBackendWorkspace,
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

  it('shows the STA worker failure and its run log in notifications', async () => {
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
    await shot('sta-worker-failure')
    await page.getByRole('button', { name: 'Open notifications' }).click()
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
