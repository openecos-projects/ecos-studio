import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ProjectEccConfigService } from './projectEccConfigService'

const CLI_ECC_TOML = `# preset: rtl2gds | pdk: ics55
[design]
name = "gcd"
top = "gcd"
rtl = ["rtl/gcd.v"]

[pdk]
name = "ics55"
root = "/nonexistent/pdk"

[params]
target_density = 0.2
`

describe('ProjectEccConfigService', () => {
  let projectRoot: string
  let pdkRoot: string
  let externalRoot: string
  let service: ProjectEccConfigService

  const eccTomlPath = () => join(projectRoot, 'ecc.toml')

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'ecc-config-project-'))
    pdkRoot = await mkdtemp(join(tmpdir(), 'ecc-config-pdk-'))
    externalRoot = await mkdtemp(join(tmpdir(), 'ecc-config-macros-'))
    service = new ProjectEccConfigService()
    await mkdir(join(pdkRoot, 'lef'), { recursive: true })
    await writeFile(join(pdkRoot, 'lef', 'tech.lef'), 'tech\n')
    await writeFile(join(pdkRoot, 'lef', 'std.lef'), 'std\n')
    await writeFile(join(externalRoot, 'sram.lef'), 'macro\n')
    await writeFile(join(externalRoot, 'sram.lib'), 'macro-lib\n')
  })

  afterAll(async () => {
    await rm(projectRoot, { recursive: true, force: true })
    await rm(pdkRoot, { recursive: true, force: true })
    await rm(externalRoot, { recursive: true, force: true })
  })

  it('reads a missing ecc.toml as non-existent with empty values', async () => {
    const result = await service.read(projectRoot)
    expect(result).toEqual({ exists: false, externalPaths: [], overrides: {} })
  })

  it('rejects a missing project root', async () => {
    await expect(service.read(join(projectRoot, 'missing'))).rejects.toThrow(
      'project root does not exist',
    )
  })

  it('writes external paths and manual overrides while preserving the CLI layout', async () => {
    await writeFile(eccTomlPath(), CLI_ECC_TOML, 'utf-8')

    const result = await service.write({
      externalPaths: [externalRoot],
      overrides: {
        tech: join(pdkRoot, 'lef', 'tech.lef'),
        lefs: [join(pdkRoot, 'lef', 'std.lef'), join(externalRoot, 'sram.lef')],
        libs: [join(externalRoot, 'sram.lib')],
      },
      projectRoot,
      pdkRoot,
    })

    expect(result.exists).toBe(true)
    expect(result.externalPaths).toEqual([externalRoot])
    // In-root entries relativize; external macro files stay absolute.
    expect(result.overrides).toEqual({
      tech: 'lef/tech.lef',
      lefs: ['lef/std.lef', join(externalRoot, 'sram.lef')],
      libs: [join(externalRoot, 'sram.lib')],
    })

    const text = await readFile(eccTomlPath(), 'utf-8')
    expect(text).toContain('# preset: rtl2gds | pdk: ics55')
    expect(text).toContain('[design]')
    expect(text).toContain('target_density = 0.2')
    expect(text).toContain(`external_paths = ["${externalRoot}"]`)
    expect(text).toContain(`lefs = ["lef/std.lef", "${join(externalRoot, 'sram.lef')}"]`)
  })

  it('clears external paths and override keys on empty writes', async () => {
    const result = await service.write({
      externalPaths: [],
      overrides: { tech: '', lefs: [], libs: [] },
      projectRoot,
    })
    expect(result.externalPaths).toEqual([])
    expect(result.overrides).toEqual({})

    const text = await readFile(eccTomlPath(), 'utf-8')
    expect(text).not.toContain('external_paths')
    expect(text).not.toContain('[pdk.overrides]')
    expect(text).toContain('[pdk]')
  })

  it('creates a minimal [pdk] document for GUI-only projects', async () => {
    const guiProject = await mkdtemp(join(tmpdir(), 'ecc-config-gui-'))
    try {
      const result = await service.write({
        externalPaths: [externalRoot],
        projectRoot: guiProject,
        pdkName: 'ics55',
        pdkRoot,
      })
      expect(result.exists).toBe(true)
      const text = await readFile(join(guiProject, 'ecc.toml'), 'utf-8')
      expect(text).toContain('[pdk]')
      expect(text).toContain('name = "ics55"')
      expect(text).toContain(`root = "${pdkRoot}"`)
      expect(text).not.toContain('[design]')
    } finally {
      await rm(guiProject, { recursive: true, force: true })
    }
  })

  it('rejects invalid path entries without touching the file', async () => {
    await writeFile(eccTomlPath(), CLI_ECC_TOML, 'utf-8')
    const before = await readFile(eccTomlPath(), 'utf-8')

    await expect(
      service.write({
        externalPaths: [join(projectRoot, 'missing-dir')],
        projectRoot,
      }),
    ).rejects.toThrow('does not exist')

    await expect(
      service.write({
        overrides: { lefs: [join(externalRoot, 'missing.lef')] },
        projectRoot,
      }),
    ).rejects.toThrow('does not exist')

    expect(await readFile(eccTomlPath(), 'utf-8')).toBe(before)
  })

  it('surfaces a parse failure instead of silently returning values', async () => {
    await writeFile(eccTomlPath(), 'not [ valid toml =', 'utf-8')
    await expect(service.read(projectRoot)).rejects.toThrow('Invalid TOML')
  })
})
