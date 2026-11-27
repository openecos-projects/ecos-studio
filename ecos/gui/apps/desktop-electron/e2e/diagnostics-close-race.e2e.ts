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
    await app.evaluate(async ({ app, dialog }, filePath) => {
      const fs = process.getBuiltinModule(
        'node:fs/promises',
      ) as typeof import('node:fs/promises')
      const nodeModule = process.getBuiltinModule(
        'node:module',
      ) as typeof import('node:module')
      const open = fs.open
      const path = process.getBuiltinModule('node:path') as typeof import('node:path')
      const sessions = path.join(app.getPath('userData'), 'logs', 'sessions')
      const session = (await fs.readdir(sessions)).find((entry) =>
        entry.endsWith(`-${process.pid}`),
      )
      if (!session) throw new Error('Desktop log session is missing')
      const logPath = path.join(sessions, session, 'main.log')
      let resume!: () => void
      const gate = new Promise<void>((resolve) => {
        resume = resolve
      })
      const restore = () => {
        fs.open = open
        nodeModule.syncBuiltinESMExports()
        resume()
      }
      Object.assign(globalThis, {
        diagnosticsReadStarted: false,
        resumeDiagnostics: restore,
      })
      fs.open = (async (...args: Parameters<typeof open>) => {
        // Pause the desktop log read that occurs after the failure is classified.
        if (args[0] === logPath) {
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
    try {
      await app.evaluate(() => Reflect.get(globalThis, 'resumeDiagnostics')?.())
    } finally {
      await close()
    }
  }
}, 120_000)
