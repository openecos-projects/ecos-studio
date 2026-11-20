import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { launchE2EApp, repoRoot, resolveOutDir } from './support/launch'
import { prepareGcdProject } from './support/design'
import { readFlowSteps } from './support/flow'
import {
  createBackendProject,
  importExternalPdk,
  waitToolchainReady,
} from './support/journey'
import { createMilestoneShots } from './support/screenshots'

async function rememberProject(page: Page, projectRoot: string, projectName: string) {
  await page.evaluate(
    ({ name, path }) =>
      window.ecosDesktop.settings.set('project_history', [
        {
          id: path,
          name,
          path,
          projectType: 'backend',
          lastOpened: new Date().toISOString(),
        },
      ]),
    { name: projectName, path: projectRoot },
  )
}

async function openWorkspaceWizard(page: Page, projectName: string) {
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
  return panel
}

async function advanceWizard(
  panel: Awaited<ReturnType<typeof openWorkspaceWizard>>,
  from: number,
  to: number,
) {
  for (let step = from; step < to; step += 1) {
    await expect.poll(() => panel.getAttribute('data-current-step')).toBe(String(step))
    const continueButton = panel.locator('footer button').filter({ hasText: 'Continue' })
    await expect.poll(() => continueButton.isEnabled(), { timeout: 60_000 }).toBe(true)
    await continueButton.click()
  }
  await expect.poll(() => panel.getAttribute('data-current-step')).toBe(String(to))
}

async function openConfiguredWorkspaceWizard(
  page: Page,
  projectName: string,
  shot?: ReturnType<typeof createMilestoneShots>,
) {
  const panel = await openWorkspaceWizard(page, projectName)
  await advanceWizard(panel, 1, 4)
  await expect
    .poll(() => panel.getByRole('combobox', { name: 'Start Step' }).inputValue())
    .toBe('synthesis')
  await expect
    .poll(() => panel.locator('[data-flow-step-card="placement"]').isVisible())
    .toBe(true)
  await expect
    .poll(() => panel.locator('[data-flow-step-card="harden"]').isVisible())
    .toBe(true)
  await shot?.('flow-setup')
  await advanceWizard(panel, 4, 7)
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
}

async function submitWorkspaceWizard(page: Page) {
  const panel = page.locator('.new-workspace-wizard-panel')
  await panel.getByRole('button', { name: 'Create Workspace', exact: true }).click()
  await panel.waitFor({ state: 'detached', timeout: 120_000 })
  const stepConfig = page.getByRole('dialog', { name: 'Step Configuration', exact: true })
  await stepConfig.waitFor({ state: 'visible', timeout: 60_000 })
  await stepConfig.getByRole('button', { name: 'Close', exact: true }).click()
  await stepConfig.waitFor({ state: 'hidden' })
}

describe('product e2e: repeated workspace creation', () => {
  const incompatibleBinDir = process.env.ECOS_E2E_INCOMPATIBLE_ECC_BIN_DIR

  it.skipIf(!incompatibleBinDir)(
    'shows the incompatible ECC error at Flow Setup',
    async () => {
      const outDir = await resolveOutDir('incompatible-ecc-wizard')
      const design = await prepareGcdProject(join(outDir, 'work'))
      const projectName = 'incompatible-ecc-e2e'
      const setup = await launchE2EApp(join(outDir, 'setup'))
      try {
        await waitToolchainReady(setup.page)
        await createBackendProject(setup.page, {
          projectRoot: design.projectRoot,
          name: projectName,
          designName: design.designName,
          rtlImport: design.rtlImport,
        })
      } finally {
        await setup.close()
      }

      const { page, close } = await launchE2EApp(outDir, {
        adjustEnv: (env) => {
          env.ECOS_ECC_BIN_DIR = incompatibleBinDir!
        },
      })
      const shot = createMilestoneShots(page, outDir)
      try {
        await rememberProject(page, design.projectRoot, projectName)
        const panel = await openWorkspaceWizard(page, projectName)
        await advanceWizard(panel, 1, 4)
        const error = panel.getByRole('alert').filter({ hasText: 'workspace fork' })
        await error.waitFor({ state: 'visible' })
        expect(await error.innerText()).toContain('ECOS_ECC_BIN_DIR')
        expect(
          await panel.getByRole('combobox', { name: 'Start Step' }).isEnabled(),
        ).toBe(false)
        expect(await panel.getByRole('button', { name: 'Continue' }).isEnabled()).toBe(
          false,
        )
        await shot('incompatible-ecc')
      } catch (error) {
        await shot('failure').catch(() => undefined)
        throw error
      } finally {
        await close()
      }
    },
    180_000,
  )

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
        await createBackendProject(page, {
          projectRoot: design.projectRoot,
          name: projectName,
          designName: design.designName,
          rtlImport: design.rtlImport,
        })
        await importExternalPdk(
          page,
          process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
        )
        await rememberProject(page, design.projectRoot, projectName)
        const readManifest = () =>
          page.evaluate(
            (root) => window.ecosDesktop.projectManagement.readManifest(root),
            design.projectRoot,
          )
        await openConfiguredWorkspaceWizard(page, projectName, shot)
        await submitWorkspaceWizard(page)
        await expect.poll(async () => (await readManifest())?.workspaces.length).toBe(1)
        if (mode === 'rtl') {
          const manifest = await readManifest()
          const directory = resolve(
            design.projectRoot,
            manifest!.workspaces[0]!.workspace_path,
          )
          const card = page.locator('.flow-step-card[data-step="synthesis"]')
          await card.getByRole('button', { name: /run synthesis/i }).click()
          const runStep = page.getByRole('dialog', { name: 'Run Synthesis' })
          await runStep.getByRole('button', { name: 'Run current step' }).click()
          await expect
            .poll(() => card.getAttribute('data-status'), { timeout: 120_000 })
            .toBe('succeeded')
          expect(
            (await readFlowSteps(directory)).find((step) => step.name === 'synthesis')
              ?.state,
          ).toBe('Success')
          await runStep.getByRole('button', { name: 'Close', exact: true }).click()
          await shot('first-workspace-synthesis-succeeded')
        }

        await openConfiguredWorkspaceWizard(page, projectName)
        await shot('second-workspace-top-module')
        await submitWorkspaceWizard(page)
        await expect
          .poll(async () => (await readManifest())?.workspaces.length, {
            timeout: 60_000,
          })
          .toBe(2)
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

        await openConfiguredWorkspaceWizard(page, projectName)
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
