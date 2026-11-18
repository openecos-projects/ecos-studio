import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PdkConfigureRequest } from '@ecos-studio/shared'
import { launchE2EApp, resolveOutDir, type E2EApp } from './support/launch'

// Exercise the actual preload -> Electron -> CLI -> managed-storage boundary.
// No EDA execution or synthetic physical qualification is involved in this case.
describe('ECC-managed PDK descriptions and adaptations', () => {
  let app: E2EApp
  let root: string
  beforeAll(async () => {
    const out = await resolveOutDir('pdk-management')
    root = join(out, 'vendor')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'cells.lib'), 'library(vendor) {}\n')
    app = await launchE2EApp(out)
  })
  afterAll(async () => {
    if (app)
      await app.page.screenshot({ path: join(app.outDir, 'pdk-management-final.png') })
    await app?.close()
  })

  async function configure(request: PdkConfigureRequest) {
    const result = await app.page.evaluate(
      (input) => window.ecosDesktop!.pdkInventory.configure(input),
      request,
    )
    expect(result.error).toBeUndefined()
    return result
  }

  it('loads bundled profiles through the real CLI and rejects a mismatched package', async () => {
    const listed = await configure({ action: 'profiles-list' })
    expect(listed.profiles).toMatchObject([{ id: 'ics55-v1' }, { id: 'ics55-v2' }])
    const shown = await configure({ action: 'profiles-show', profileId: 'ics55-v2' })
    expect(shown.description).not.toHaveProperty('tools')
    expect(shown.adaptation).toMatchObject({
      tools: { compatibility: { sizer_vt_contract: 1 } },
    })
    const rejected = await app.page.evaluate(
      (pdkRoot) =>
        window.ecosDesktop!.pdkInventory.configure({
          action: 'profiles-apply',
          profileId: 'ics55-v2',
          root: pdkRoot,
        }),
      root,
    )
    expect(rejected.error).toBeDefined()
    expect(await readdir(root)).toEqual(['cells.lib'])
    const missing = await app.page.evaluate(
      (pdkRoot) =>
        window.ecosDesktop!.pdkInventory.configure({ action: 'show', root: pdkRoot }),
      root,
    )
    expect(missing.error).toBeDefined()
  })

  it('authors outside the PDK, preserves process identity and relocates local metadata', async () => {
    const created = await configure({ action: 'init', root, familyId: 'vendor' })
    await configure({
      action: 'set',
      root,
      field: 'resources',
      value: { lib: { path: 'cells.lib', role: 'liberty' } },
      expectedRevision: String(created.revision),
    })
    const shown = await configure({ action: 'show', root })
    expect(shown.description).not.toHaveProperty('tools')
    expect(shown.adaptation).toHaveProperty('tools')
    expect(await readdir(root)).toEqual(['cells.lib'])
    const installation = await app.page.evaluate(
      (pdkRoot) =>
        window.ecosDesktop!.pdkInventory.import({
          root: pdkRoot,
          familyId: 'vendor',
          displayName: 'Vendor',
        }),
      root,
    )
    expect(installation.readiness).toBe('ready')
    await configure({
      action: 'set',
      root,
      field: 'parameters',
      value: { max_fanout: 16 },
      expectedRevision: String(shown.revision),
    })
    const [updated] = await app.page.evaluate(() =>
      window.ecosDesktop!.pdkInventory.list(),
    )
    expect(updated.pdkDigest).toBe(installation.pdkDigest)
    expect(updated.adaptationDigest).not.toBe(installation.adaptationDigest)
    expect(updated.readiness).toBe('ready')
    const moved = `${root}-moved`
    await rename(root, moved)
    const relocated = await app.page.evaluate(
      (input) => window.ecosDesktop!.pdkInventory.locate(input),
      { installationId: installation.id, root: moved },
    )
    expect(relocated.readiness).toBe('ready')
    expect(relocated.pdkDigest).toBe(installation.pdkDigest)
    expect(relocated.adaptationDigest).toBe(updated.adaptationDigest)
    const stored = JSON.parse(await readFile(relocated.configurationPath!, 'utf8'))
    expect(stored.description.family_id).toBe('vendor')
    expect(stored.adaptation.parameters.max_fanout).toBe(16)
    expect(await readdir(moved)).toEqual(['cells.lib'])
  })

  // Optional real-package UI journey: point at an unmodified v1.10.103 directory
  // without ecc-pdk.json. All resulting metadata stays in this app's isolated XDG.
  it.skipIf(!process.env.ECOS_E2E_PROFILE_V1_ROOT)(
    'initializes v1 defaults from the configuration dialog',
    async () => {
      const pdkRoot = process.env.ECOS_E2E_PROFILE_V1_ROOT!
      await app.app.evaluate(({ dialog }, path) => {
        ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        })
      }, pdkRoot)
      await app.page.getByRole('button', { name: /Resource Manager/ }).click()
      await app.page
        .locator('.plugin-card')
        .filter({
          has: app.page
            .locator('.plugin-card-title strong')
            .filter({ hasText: /ICS.*55/i }),
        })
        .first()
        .locator('[data-title="Import Local"]')
        .click()
      const naming = app.page.getByRole('dialog', { name: 'Import PDK', exact: true })
      const configuration = app.page.getByRole('dialog', {
        name: 'Configure PDK',
        exact: true,
      })
      await naming.or(configuration).waitFor()
      if (await naming.isVisible()) {
        await naming.getByLabel('PDK Name').fill('ICS55 v1 local')
        await naming.getByRole('button', { name: 'Import', exact: true }).click()
      }
      await configuration.getByLabel('ECC default adaptation').selectOption('ics55-v1')
      await configuration
        .getByRole('button', { name: 'Apply default adaptation' })
        .click()
      await configuration.getByRole('button', { name: 'Validate resources' }).waitFor()
      const shown = await configure({ action: 'show', root: pdkRoot })
      expect(shown.adaptation).toMatchObject({
        profile_revision: expect.stringContaining('7t'),
      })
      await app.page.screenshot({ path: join(app.outDir, 'default-profile-v1.png') })
    },
  )
})
