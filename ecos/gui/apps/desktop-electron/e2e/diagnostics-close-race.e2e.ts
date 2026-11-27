import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { prepareGcdProject } from './support/design'
import { launchE2EApp, repoRoot, resolveOutDir } from './support/launch'
import { setupBackendWorkspace } from './support/journey'
import { createMilestoneShots } from './support/screenshots'

it('exports a failed STA run after closing the workspace during diagnostics collection', async () => {
  const outDir = await resolveOutDir('diagnostics-close-race')
  const { app, page, close } = await launchE2EApp(outDir)
  try {
    const workspace = await setupBackendWorkspace(page, {
      ...(await prepareGcdProject(join(outDir, 'work'))),
      pdkRoot: process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
    })
    const target = join(outDir, 'sta-diagnostics.txt')
    await app.evaluate(({ dialog }, filePath) => {
      const fs = process.getBuiltinModule(
        'node:fs/promises',
      ) as typeof import('node:fs/promises')
      const nodeModule = process.getBuiltinModule(
        'node:module',
      ) as typeof import('node:module')
      const open = fs.open
      let resume!: () => void
      const gate = new Promise<void>((resolve) => {
        resume = resolve
      })
      Object.assign(globalThis, {
        diagnosticsReadStarted: false,
        resumeDiagnostics: resume,
      })
      fs.open = (async (...args: Parameters<typeof open>) => {
        // Pause the desktop log read that occurs after the failure is classified.
        if (String(args[0]).endsWith('/main.log')) {
          Object.assign(globalThis, { diagnosticsReadStarted: true })
          fs.open = open
          nodeModule.syncBuiltinESMExports()
          await gate
        }
        return open(...args)
      }) as typeof open
      nodeModule.syncBuiltinESMExports()
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, target)

    const sta = page.locator('.flow-step-card[data-step="sta"]')
    await sta.getByRole('button', { name: /run sta/i }).click()
    const run = page.getByRole('dialog', { name: 'Run STA', exact: true })
    try {
      await run.getByRole('button', { name: 'Run current step', exact: true }).click()
      await expect
        .poll(
          () => app.evaluate(() => Reflect.get(globalThis, 'diagnosticsReadStarted')),
          { timeout: 30_000 },
        )
        .toBe(true)
      await expect(
        page.evaluate(
          (workspaceHandle) =>
            window.ecosDesktop.runtime.workspace.close({
              designTool: 'backend',
              workspaceHandle,
            }),
          workspace.workspaceHandle,
        ),
      ).resolves.toEqual({ ok: true })
    } finally {
      await app.evaluate(() => Reflect.get(globalThis, 'resumeDiagnostics')())
    }

    await run.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Open notifications' }).click()
    const notification = page
      .getByRole('dialog', { name: 'Notifications' })
      .locator('.notification-item')
      .filter({ hasText: /missing filled, parasitics/ })
    await notification.getByText('View details').click()
    await notification.getByRole('button', { name: 'Save run diagnostics' }).click()
    await expect
      .poll(() => readFile(target, 'utf8').catch(() => ''))
      .toMatch(/State: failed[\s\S]*Failed worker attempts\s+sta \(/)
    await createMilestoneShots(page, outDir)('diagnostics-saved-after-close')
  } finally {
    await close()
  }
}, 120_000)
