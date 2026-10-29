import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { launchE2EApp, repoRoot, resolveOutDir } from './support/launch'
import { prepareGcdProject } from './support/design'
import {
  createBackendProject,
  createDefaultWorkspace,
  importExternalPdk,
  openWorkspaceInUi,
  registerWorkspaceRoot,
  waitToolchainReady,
} from './support/journey'
import { createMilestoneShots } from './support/screenshots'

async function openNextWorkspaceWizard(page: Page, projectName: string) {
  await page.evaluate(() => {
    window.location.hash = '#/projects'
  })
  const newWorkspace = page.getByRole('button', {
    name: `New workspace in ${projectName}`,
    exact: true,
  })
  await newWorkspace.waitFor({ state: 'visible', timeout: 60_000 })
  await newWorkspace.click()
  const panel = page.locator('.new-workspace-wizard-panel')
  await panel.waitFor({ state: 'visible' })
  for (let step = 1; step < 7; step += 1) {
    await expect.poll(() => panel.getAttribute('data-current-step')).toBe(String(step))
    const continueButton = panel.locator('footer button').filter({ hasText: 'Continue' })
    await expect.poll(() => continueButton.isEnabled(), { timeout: 60_000 }).toBe(true)
    await continueButton.click()
  }
  await expect.poll(() => panel.getAttribute('data-current-step')).toBe('7')
  await expect
    .poll(() => panel.locator('.top-module-select .p-select-label').innerText(), {
      timeout: 60_000,
    })
    .toBe('gcd')
  expect(
    await panel.getByText('No module declarations were found.', { exact: false }).count(),
  ).toBe(0)
  await expect
    .poll(() =>
      panel.locator('footer button').filter({ hasText: 'Create Workspace' }).isEnabled(),
    )
    .toBe(true)
  return panel
}

describe('product e2e: repeated workspace creation', () => {
  it.each(['rtl', 'filelist'] as const)(
    'retains the top module and sources when creating another workspace from %s',
    async (mode) => {
      const outDir = await resolveOutDir(`repeated-workspace-${mode}`)
      const design = await prepareGcdProject(join(outDir, 'work'))
      const sourcePath = design.rtlImport.verilog![0]!
      const originalSource = await readFile(sourcePath, 'utf8')
      if (mode === 'filelist') {
        const filelist = join(dirname(sourcePath), 'sources.f')
        await writeFile(filelist, 'gcd.v\n')
        design.rtlImport = { filelist }
      }
      const launched = await launchE2EApp(outDir)
      const { page } = launched
      const shot = createMilestoneShots(page, outDir)
      const projectName = `${mode}-repeat-e2e`
      try {
        await waitToolchainReady(page)
        const projectId = await createBackendProject(page, {
          projectRoot: design.projectRoot,
          name: projectName,
          designName: design.designName,
          rtlImport: design.rtlImport,
        })
        const pdkInstallationId = await importExternalPdk(
          page,
          process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
        )
        const first = await createDefaultWorkspace(page, {
          ...design,
          projectId,
          pdkInstallationId,
        })
        await registerWorkspaceRoot(page, first.workspaceDir)
        await openWorkspaceInUi(page, first)

        const panel = await openNextWorkspaceWizard(page, projectName)
        await shot('second-workspace-top-module')
        await panel
          .locator('footer button')
          .filter({ hasText: 'Create Workspace' })
          .click()
        await panel.waitFor({ state: 'detached', timeout: 120_000 })
        const readManifest = () =>
          page.evaluate(
            (root) => window.ecosDesktop.projectManagement.readManifest(root),
            design.projectRoot,
          )
        await expect
          .poll(async () => (await readManifest())?.workspaces.length, {
            timeout: 60_000,
          })
          .toBe(2)
        await page.getByText('Creating your workspace', { exact: true }).waitFor({
          state: 'hidden',
          timeout: 120_000,
        })
        const stepConfig = page.getByRole('dialog', {
          name: 'Step Configuration',
          exact: true,
        })
        await stepConfig.waitFor({ state: 'visible', timeout: 60_000 })
        await stepConfig.getByRole('button', { name: 'Close', exact: true }).click()
        await stepConfig.waitFor({ state: 'hidden' })
        await shot('second-workspace-created')

        const manifest = await readManifest()
        expect(await readFile(join(design.projectRoot, 'rtl', 'gcd.v'), 'utf8')).toBe(
          originalSource,
        )
        for (const workspace of manifest!.workspaces) {
          expect(
            await readFile(
              resolve(design.projectRoot, workspace.workspace_path, 'origin/gcd.v'),
              'utf8',
            ),
          ).toBe(originalSource)
        }

        await openNextWorkspaceWizard(page, projectName)
        await shot('third-workspace-top-module')
        console.log(
          `${mode}: second workspace created and third wizard retains gcd; evidence: ${outDir}`,
        )
      } catch (error) {
        await shot('failure').catch(() => undefined)
        await writeFile(
          join(outDir, 'failure-ui.txt'),
          await page.locator('body').innerText(),
        ).catch(() => undefined)
        throw error
      } finally {
        await launched.close()
      }
    },
    240_000,
  )
})
