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
})
