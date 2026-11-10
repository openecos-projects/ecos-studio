import { describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, resolveOutDir } from './support/launch'
import { prepareGcdProject } from './support/design'

// Opt-in because it needs a real ECC-FE checkout and a Python environment with
// ECC-FE dependencies. Set ECOS_FE_DEV_ROOT and ECOS_FE_PYTHON alongside it.
const FRONTEND_E2E_ENABLED = process.env.ECOS_E2E_FRONTEND_RUNTIME === '1'

describe.skipIf(!FRONTEND_E2E_ENABLED)(
  'product e2e: frontend Workspace DEF View guard',
  () => {
    it('rejects DEF Layout before opening the file picker for a real frontend Workspace', async () => {
      const outDir = await resolveOutDir('frontend-def-view')
      const design = await prepareGcdProject(join(outDir, 'work'))
      const workspaceDir = join(design.projectRoot, 'default')
      await mkdir(workspaceDir, { recursive: true })
      const launched = await launchE2EApp(outDir)
      let dialogCalls = 0

      try {
        const { page } = launched
        await launched.app.evaluate(({ dialog }) => {
          const marker = '__ecosE2EDefViewDialogCalls'
          ;(globalThis as Record<string, unknown>)[marker] = 0
          ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => {
            ;(globalThis as unknown as Record<string, number>)[marker] += 1
            return { canceled: true, filePaths: [] }
          }
        })

        const workspace = await page.evaluate(
          async ({ directory, source }) =>
            window.ecosDesktop.runtime.workspace.create({
              designTool: 'frontend',
              payload: {
                directory,
                designTool: 'frontend',
                frontend_design_kind: 'generic_rtl',
                origin_verilog: source,
                parameters: {
                  Design: 'gcd-frontend',
                  'Top module': 'gcd',
                  'Design Tool': 'frontend',
                },
              },
            }),
          { directory: workspaceDir, source: design.rtlImport.verilog![0]! },
        )
        expect(workspace.workspaceHandle).toBeTruthy()

        await page.evaluate(
          ({ path }) =>
            window.ecosDesktop.settings.set('recent_projects', [
              {
                designTool: 'frontend',
                id: path,
                lastOpened: new Date().toISOString(),
                name: 'gcd-frontend',
                path,
              },
            ]),
          { path: workspaceDir },
        )
        await page.evaluate(() => {
          window.location.hash = '#/fe'
        })
        const recent = page.locator('.group').filter({ hasText: workspaceDir })
        await recent.waitFor({ state: 'visible', timeout: 60_000 })
        await recent.click()
        await page.waitForFunction(
          () => window.location.hash.startsWith('#/workspace/home'),
          undefined,
          { timeout: 60_000 },
        )
        await page
          .getByRole('heading', { name: 'Frontend Workspace', exact: true })
          .waitFor({ state: 'visible', timeout: 60_000 })

        await page.locator('.menu-btn').filter({ hasText: 'View' }).click()
        await page.getByRole('button', { name: 'DEF Layout' }).click()
        await expect
          .poll(() => page.locator('body').innerText(), { timeout: 15_000 })
          .toContain('DEF Layout is only available for backend Workspaces.')
        dialogCalls = await launched.app.evaluate(
          () =>
            (globalThis as unknown as Record<string, number>)
              .__ecosE2EDefViewDialogCalls as number,
        )
        expect(dialogCalls).toBe(0)
      } finally {
        await launched.close()
      }
    }, 180_000)
  },
)
