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

  it('shows only Dashboard navigation and preserves the three-row dashboard', async () => {
    const { page, app } = launched!
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    )
    await waitForText(page, '.home-dashboard-top', 'Signoff Checklist')
    expect(
      (
        await page.locator('nav[aria-label="Workspace navigation"] a').allTextContents()
      ).map((text) => text.trim()),
    ).toEqual(['Dashboard'])
    expect(await page.locator('.home-dashboard-top h2').allTextContents()).toEqual([
      'Chip Basic Info',
      'Quality of Results',
      'Signoff Checklist',
    ])
    expect(
      await page.locator('.workspace-workbench-right .flow-status-strip').count(),
    ).toBe(0)
    expect(await page.locator('.workspace-workbench-right .flow-log-panel').count()).toBe(
      0,
    )
    expect(await page.locator('.home-dashboard-bottom').count()).toBe(1)
    await shot('dashboard-wide')
    const firstStep = page.locator('.flow-step-card').first()
    expect(
      await firstStep.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const viewport = element.closest('.flow-scroll')!.getBoundingClientRect()
        return (
          bounds.top >= viewport.top &&
          bounds.bottom <= viewport.bottom &&
          bounds.left >= viewport.left &&
          bounds.right <= viewport.right
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
        const top = element.querySelector('.home-dashboard-top')!.getBoundingClientRect()
        const flow = element
          .querySelector('.workspace-flow-dashboard')!
          .getBoundingClientRect()
        const bottom = element
          .querySelector('.home-dashboard-bottom')!
          .getBoundingClientRect()
        return top.bottom <= flow.top && flow.bottom <= bottom.top
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
    await page.getByRole('button', { name: 'Restore flow diagram', exact: true }).click()
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
