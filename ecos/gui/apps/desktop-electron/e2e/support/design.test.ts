import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareDesignProject } from './design'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('E2E design preparation', () => {
  it('keeps the CI case directory separate from RTL design and top module names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecos-e2e-design-'))
    temporaryRoots.push(root)
    const designDir = join(root, 'design-case')
    await mkdir(designDir)
    await writeFile(join(designDir, 'core.v'), 'module rtl_top; endmodule\n')
    await writeFile(
      join(designDir, 'ecc.toml'),
      [
        '[design]',
        'name = "design-label"',
        'top = "rtl_top"',
        'rtl = ["core.v"]',
        'clock_port = "clock"',
        'frequency_mhz = 50',
        '[params.floorplan]',
        'core_util = 0.35',
      ].join('\n'),
    )
    const workRoot = join(root, 'work')
    const design = await prepareDesignProject(designDir, workRoot)
    expect(design).toMatchObject({
      name: 'design-case',
      projectRoot: join(workRoot, 'design-case'),
      designName: 'design-label',
      topModule: 'rtl_top',
      clockPort: 'clock',
      frequencyMhz: 50,
      parameters: { 'floorplan.core_util': 0.35 },
      rtlImport: { verilog: [join(workRoot, 'design-case-src', 'core.v')] },
    })
  })
})
