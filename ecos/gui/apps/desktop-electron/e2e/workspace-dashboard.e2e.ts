import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareDesign } from './support/design'
import { createMilestoneShots } from './support/screenshots'
import {
  createBackendProject,
  createDefaultWorkspace,
  importExternalPdk,
  openWorkspaceInUi,
  registerWorkspaceRoot,
  waitToolchainReady,
} from './support/journey'

describe('RTL workspace dashboard', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>

  beforeAll(async () => {
    const outDir = await resolveOutDir('workspace-dashboard')
    const design = await prepareDesign(join(outDir, 'inputs'))
    const projectRoot = join(outDir, 'project')
    await mkdir(projectRoot, { recursive: true })
    launched = await launchE2EApp(outDir)
    const { page } = launched
    shot = createMilestoneShots(page, outDir)
    await waitToolchainReady(page)
    const projectId = await createBackendProject(page, {
      projectRoot,
      name: `${design.name}-dashboard`,
      designName: design.designName,
    })
    const pdkInstallationId = await importExternalPdk(
      page,
      process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
    )
    const workspace = await createDefaultWorkspace(page, {
      projectRoot,
      projectId,
      designName: design.designName,
      topModule: design.topModule,
      clockPort: design.clockPort,
      frequencyMhz: design.frequencyMhz,
      inputs: design.inputs,
      parameters: design.parameters,
      pdkInstallationId,
    })
    await registerWorkspaceRoot(page, workspace.workspaceDir)
    await openWorkspaceInUi(page, workspace)
    const index = await page.evaluate(() =>
      window.ecosDesktop.workspaceResources.getIndex(),
    )
    const synthesis = index.flow.steps.find(
      (step) => step.name.toLowerCase() === 'synthesis',
    )
    if (!synthesis) throw new Error('The test workspace has no Synthesis step.')
    const reportDirectory = join(synthesis.directory, 'report', 'dashboard-fixture')
    await mkdir(reportDirectory, { recursive: true })
    await writeFile(
      join(reportDirectory, 'preview.rpt'),
      'Dashboard report fixture\n<script>not executable</script>\n',
    )
    await page.locator('.flow-step-card').first().waitFor({ state: 'visible' })
  }, 180_000)

  afterAll(async () => {
    if (launched) {
      await shot('final-state').catch(() => undefined)
      await launched.close()
    }
  })

  it('shows only Dashboard navigation with Flow above three information cards', async () => {
    const { page, app } = launched!
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    )
    await waitForText(page, '.flow-overview', 'Signoff Checklist')
    expect(
      (
        await page.locator('nav[aria-label="Workspace navigation"] a').allTextContents()
      ).map((text) => text.trim()),
    ).toEqual(['Dashboard'])
    expect(await page.locator('.flow-overview h2').allTextContents()).toEqual([
      'Quality of Results',
      'Signoff Checklist',
    ])
    expect(await page.locator('.home-dashboard-bottom h2').allTextContents()).toEqual([
      'Chip Basic Info',
      'Key Metrics',
      'Data Snapshot',
    ])
    expect(await page.locator('.home-dashboard-top').count()).toBe(0)
    expect(
      await page.locator('.flow-overview .status-detail-link').evaluateAll((buttons) =>
        buttons.every((button) => {
          const bounds = button.getBoundingClientRect()
          const card = button.closest('.flow-status-card')!.getBoundingClientRect()
          return bounds.top >= card.top && bounds.bottom <= card.bottom - 1
        }),
      ),
    ).toBe(true)
    expect(
      await page.locator('.workspace-workbench-right .flow-status-strip').count(),
    ).toBe(0)
    expect(await page.locator('.workspace-workbench-right .flow-log-panel').count()).toBe(
      0,
    )
    expect(await page.locator('.home-dashboard-bottom').count()).toBe(1)
    await shot('dashboard-wide')
    expect(
      await page.locator('.flow-canvas').evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const viewport = element.closest('.flow-scroll')!.getBoundingClientRect()
        return (
          Math.abs(
            bounds.left +
              bounds.width / 2 -
              viewport.left -
              (element.closest('.flow-scroll') as HTMLElement).clientWidth / 2,
          ) < 2 &&
          Math.abs(
            bounds.top +
              bounds.height / 2 -
              viewport.top -
              (element.closest('.flow-scroll') as HTMLElement).clientHeight / 2,
          ) < 2
        )
      }),
    ).toBe(true)
    const wasDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    await page.locator('.theme-btn').click()
    await page.waitForFunction(
      (previous) => document.documentElement.classList.contains('dark') !== previous,
      wasDark,
    )
    await shot('dashboard-alternate-theme')
  })

  it('hides and restores the information area without remounting Agent tabs', async () => {
    const { page } = launched!
    const before = await page.locator('.chat-inspector-panel').evaluate((element) => {
      element.setAttribute('data-dashboard-mounted', 'preserved')
      return element.getAttribute('data-dashboard-mounted')
    })
    await page.locator('.information-panel-btn').click()
    await page.locator('.workspace-workbench.is-information-hidden').waitFor()
    expect(await page.locator('.workspace-workbench-right').isVisible()).toBe(false)
    await shot('dashboard-information-hidden')
    await page.locator('.information-panel-btn').click()
    await page.locator('.workspace-workbench-right').waitFor({ state: 'visible' })
    expect(
      await page.locator('.chat-inspector-panel').getAttribute('data-dashboard-mounted'),
    ).toBe(before)
  })

  it('opens the full nested report list and renders report content as text', async () => {
    const { page } = launched!
    await page.getByRole('button', { name: 'Synthesis reports', exact: true }).click()
    const report = page
      .locator('.reports-browser aside button')
      .filter({ hasText: 'dashboard-fixture/preview.rpt' })
    await report.waitFor()
    await report.click()
    await waitForText(page, '.report-text pre', 'Dashboard report fixture')
    expect(await page.locator('.report-text pre').textContent()).toContain(
      '<script>not executable</script>',
    )
    expect(await page.locator('.report-text script').count()).toBe(0)
    await shot('step-reports')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Synthesis checklist details', exact: true })
      .click()
    await page.locator('.step-checklist').waitFor()
    await shot('step-checklist')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page.getByRole('button', { name: 'Synthesis log', exact: true }).click()
    await page.locator('.step-log-dialog').waitFor()
    await shot('step-log')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
  })

  it('keeps the verification forks accessible at narrow desktop sizes', async () => {
    const { page, app } = launched!
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 800),
    )
    await page.locator('.flow-scroll').evaluate((element) => {
      const filler = element.querySelector<HTMLElement>('[data-step="filler"]')
      if (filler) element.scrollLeft = filler.offsetLeft * 0.75
    })
    expect(
      await page.locator('.home-dashboard').evaluate((element) => {
        const flow = element
          .querySelector('.workspace-flow-dashboard')!
          .getBoundingClientRect()
        const bottom = element
          .querySelector('.home-dashboard-bottom')!
          .getBoundingClientRect()
        const overview = element.querySelector('.flow-overview')!.getBoundingClientRect()
        const viewport = element.querySelector('.flow-scroll')!.getBoundingClientRect()
        return (
          flow.bottom <= bottom.top &&
          overview.top >= viewport.top &&
          overview.bottom <= viewport.bottom
        )
      }),
    ).toBe(true)
    await page.locator('.flow-scroll').scrollIntoViewIfNeeded()
    expect(await page.locator('.flow-edges').textContent()).toContain('RCX → sta')
    expect(await page.locator('.home-dashboard-bottom').count()).toBe(1)
    await shot('dashboard-narrow-verification')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    )
    await page.getByRole('button', { name: 'Expand flow diagram', exact: true }).click()
    await page.locator('.workspace-flow-dashboard.is-expanded').waitFor()
    const expandedPositions = await page
      .locator('.flow-scroll')
      .evaluate(async (element) => {
        const positions: string[] = []
        for (let frame = 0; frame < 90; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const canvas = element.querySelector('.flow-canvas')!.getBoundingClientRect()
          positions.push(
            `${canvas.x},${canvas.y},${element.clientWidth},${element.clientHeight}`,
          )
        }
        return positions.slice(-30)
      })
    expect(new Set(expandedPositions).size).toBe(1)
    expect(
      await page
        .locator('.workspace-flow-dashboard.is-expanded .flow-status-card')
        .count(),
    ).toBe(2)
    expect(
      await page
        .locator('.workspace-flow-dashboard')
        .evaluate(
          (element) => element.getBoundingClientRect().width > window.innerWidth * 0.8,
        ),
    ).toBe(true)
    await page.locator('.flow-scroll').evaluate((element) => {
      const filler = element.querySelector<HTMLElement>('[data-step="filler"]')
      if (filler)
        element.scrollLeft = filler.offsetLeft * 0.75 - element.clientWidth * 0.1
      element.scrollTop = 0
    })
    await shot('dashboard-expanded-verification')
    await page.locator('.flow-scroll').evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    expect(
      await page.locator('.flow-signoff-card').evaluate((element) => {
        const harden = document.querySelector('[data-step="Harden"]')!
        const before = harden.getBoundingClientRect()
        const after = element.getBoundingClientRect()
        return (
          getComputedStyle(element).position === 'absolute' &&
          Math.abs(before.top - after.top) < 2 &&
          after.left > before.right
        )
      }),
    ).toBe(true)
    await shot('signoff-after-harden')
    await page.getByRole('button', { name: 'Restore flow diagram', exact: true }).click()
  })

  it('applies two-row ratios, nine snapshot cells, and keeps status cards fixed while zooming', async () => {
    const { page } = launched!
    const ratios = await page.locator('.home-dashboard').evaluate((element) => {
      const middle = element
        .querySelector('.workspace-flow-dashboard')!
        .getBoundingClientRect()
      const bottom = element.querySelector('.home-dashboard-bottom')!
      const bottomCards = [...bottom.children].map(
        (card) => card.getBoundingClientRect().width,
      )
      return {
        rows: middle.height / bottom.getBoundingClientRect().height,
        bottom: bottomCards.map((width) => width / bottomCards[2]),
      }
    })
    expect(ratios.rows).toBeCloseTo(2, 1)
    expect(ratios.bottom[0]).toBeCloseTo(2, 1)
    expect(ratios.bottom[1]).toBeCloseTo(4, 1)
    expect(await page.locator('.qor-card').textContent()).not.toContain('Current QoR')
    expect(await page.locator('.data-snapshot-cell').count()).toBe(9)
    const overview = page.locator('.flow-overview')
    const before = await overview.boundingBox()
    expect(
      await overview.locator('.flow-status-card').evaluateAll((cards) => {
        const first = cards[0].getBoundingClientRect()
        const second = cards[1].getBoundingClientRect()
        const viewport = document.querySelector('.flow-scroll')!.getBoundingClientRect()
        return (
          Math.abs(first.top - second.top) < 1 &&
          first.right <= second.left &&
          first.height >= 140 &&
          first.height <= 180 &&
          second.top >= viewport.top &&
          second.bottom <= viewport.bottom &&
          Math.abs(
            viewport.top -
              document.querySelector('.flow-header')!.getBoundingClientRect().bottom,
          ) < 2 &&
          Boolean(
            document
              .elementFromPoint(second.right + 16, first.top + 20)
              ?.closest('.flow-scroll'),
          )
        )
      }),
    ).toBe(true)
    const slider = page.getByRole('slider', { name: 'Flow diagram zoom' })
    await slider.fill('1')
    await waitForText(page, '.flow-header output', '100%')
    await page.locator('.flow-scroll').hover()
    await page.keyboard.down('Control')
    try {
      await page.mouse.wheel(0, -100)
      await waitForText(page, '.flow-header output', '105%')
      await page.mouse.wheel(0, 100)
      await waitForText(page, '.flow-header output', '100%')
    } finally {
      await page.keyboard.up('Control')
    }
    await slider.fill('0.75')
    await waitForText(page, '.flow-header output', '75%')
    expect(await overview.boundingBox()).toEqual(before)
    await page.getByRole('button', { name: 'QoR details', exact: false }).click()
    await page.getByRole('dialog').waitFor()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page.getByRole('button', { name: 'Sign-off details', exact: false }).click()
    await page.getByRole('dialog').waitFor()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await shot('dashboard-adjusted-ratios')
  })

  it('pans with a real left-button drag, stops on release, and keeps report buttons clickable', async () => {
    const { page } = launched!
    const viewport = page.locator('.flow-scroll')
    const overviewBefore = await page.locator('.flow-overview').boundingBox()
    await viewport.evaluate((element) => {
      element.scrollLeft = 100
      element.scrollTop = 100
    })
    const bounds = await viewport.boundingBox()
    if (!bounds) throw new Error('Flow viewport is unavailable')
    await page.mouse.move(bounds.x + 600, bounds.y + 70)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(bounds.x + 520, bounds.y + 40, { steps: 6 })
    expect(await viewport.evaluate((element) => getComputedStyle(element).cursor)).toBe(
      'grabbing',
    )
    await page.mouse.up({ button: 'left' })
    const position = await viewport.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    }))
    expect(position.left).toBeCloseTo(180, 0)
    expect(position.top).toBeCloseTo(130, 0)
    expect(await viewport.evaluate((element) => getComputedStyle(element).cursor)).toBe(
      'grab',
    )
    await page.mouse.move(bounds.x + 600, bounds.y + 25)
    expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(position.left)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(bounds.x - 20, bounds.y + 25, { steps: 6 })
    await page.mouse.up({ button: 'left' })
    expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(
      position.left,
    )
    expect(
      await viewport.evaluate((element) => element.classList.contains('is-panning')),
    ).toBe(false)
    await shot('flow-left-button-pan')
    expect(await page.locator('.flow-overview').boundingBox()).toEqual(overviewBefore)
    await viewport.evaluate((element) => {
      element.scrollLeft = 0
    })
    await page.getByRole('button', { name: 'Synthesis reports', exact: true }).click()
    await page.locator('.reports-browser').waitFor()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
  })
})

async function waitForText(
  page: E2EApp['page'],
  selector: string,
  text: string,
): Promise<void> {
  await page.waitForFunction(
    ({ selector, text }) =>
      document.querySelector(selector)?.textContent?.includes(text) === true,
    { selector, text },
  )
}
