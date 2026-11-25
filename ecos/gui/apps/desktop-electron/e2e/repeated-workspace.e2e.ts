import { describe, expect, it } from 'vitest'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { parse } from 'smol-toml'
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
  editFlow = false,
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
  if (editFlow) {
    await panel
      .getByRole('checkbox', { name: 'Run timing_optimization in this project' })
      .uncheck()
    await panel.getByLabel('Insert LEC after').selectOption('synthesis')
  }
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
        await openConfiguredWorkspaceWizard(page, projectName, shot, mode === 'filelist')
        await submitWorkspaceWizard(page)
        await expect.poll(async () => (await readManifest())?.workspaces.length).toBe(1)
        if (mode === 'filelist') {
          const project = parse(
            await readFile(join(design.projectRoot, 'ecc.toml'), 'utf8'),
          )
          expect(project.flow).toMatchObject({
            skip_steps: expect.arrayContaining(['timing_optimization']),
            insert_steps: ['lec@synthesis'],
          })
        }
        if (mode === 'rtl') {
          const manifest = await readManifest()
          const directory = resolve(
            design.projectRoot,
            manifest!.workspaces[0]!.workspace_path,
          )
          const card = page.locator('.flow-step-card[data-step="synthesis"]')
          expect(await readFile(join(directory, 'home/params.toml'), 'utf8')).not.toMatch(
            /placement:place\.target_density.*"cli"/,
          )
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

        if (mode === 'filelist') {
          const panel = await openWorkspaceWizard(page, projectName)
          await advanceWizard(panel, 1, 4)
          await expect
            .poll(() =>
              panel
                .getByRole('checkbox', {
                  name: 'Run timing_optimization in this project',
                })
                .isChecked(),
            )
            .toBe(false)
          await panel
            .getByText('lec@synthesis', { exact: false })
            .waitFor({ state: 'visible' })
          const draftSupported = process.env.ECOS_E2E_WORKSPACE_DRAFT === '1'
          if (draftSupported) {
            await panel
              .getByRole('checkbox', { name: 'lec@synthesis', exact: true })
              .uncheck()
            await panel.getByLabel('Maximum parallel flow steps').fill('2')
          }
          await shot('third-workspace-project-flow')
          await advanceWizard(panel, 4, 7)
          await expect
            .poll(() => panel.locator('.top-module-select .p-select-label').innerText())
            .toBe('gcd')
          if (draftSupported) {
            const configPath = join(design.projectRoot, 'ecc.toml')
            const manifestPath = join(design.projectRoot, 'project.json')
            const before = await readFile(configPath, 'utf8')
            const manifestBefore = await readFile(manifestPath, 'utf8')
            await panel.getByRole('button', { name: 'Preview flow', exact: true }).click()
            const preview = panel
              .getByRole('status')
              .filter({ hasText: 'Maximum 2 in parallel' })
            await preview.waitFor()
            expect(await preview.innerText()).not.toContain('lec@synthesis')
            expect(await readFile(configPath, 'utf8')).toBe(before)
            expect(await readFile(manifestPath, 'utf8')).toBe(manifestBefore)
            await shot('workspace-flow-preview')

            const importedRtl = join(design.projectRoot, 'rtl/gcd.v')
            await rename(importedRtl, importedRtl + '.missing')
            try {
              await panel
                .getByRole('button', { name: 'Create Workspace', exact: true })
                .click()
              const alert = panel.getByRole('alert').filter({ hasText: 'gcd.v' })
              await alert.waitFor({ timeout: 60_000 })
              expect(
                await alert.evaluate((node) => node === document.activeElement),
              ).toBe(true)
              expect(await readFile(configPath, 'utf8')).toBe(before)
              expect(await readFile(manifestPath, 'utf8')).toBe(manifestBefore)
              await shot('workspace-creation-error')
            } finally {
              await rename(importedRtl + '.missing', importedRtl)
            }

            await submitWorkspaceWizard(page)
            const updated = parse(await readFile(configPath, 'utf8'))
            expect(updated.flow).toMatchObject({
              insert_steps: [],
              max_parallel_steps: 2,
            })
            const third = (await readManifest())!.workspaces[2]!
            expect(
              (
                await readFlowSteps(resolve(design.projectRoot, third.workspace_path))
              ).map((step) => step.name),
            ).not.toContain('lec@synthesis')
          }
        } else {
          await openConfiguredWorkspaceWizard(page, projectName)
        }
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
