import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { ManualPdkConfiguration } from '@ecos-studio/shared'
import type { EccCliProcess } from './cliProcess'

export async function verifyIcs55PdkRoot(
  cli: EccCliProcess,
  root: string,
): Promise<ManualPdkConfiguration> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-pdk-verify-'))
  try {
    // `pdk verify` only reports pass/fail. Creating a workspace resolves the
    // installed runtime's defaults and validates its inputs without running tools.
    await writeFile(
      join(directory, 'preview.v'),
      'module preview(input clk); endmodule\n',
    )
    await writeFile(
      join(directory, 'ecc.toml'),
      `[design]
name = "preview"
top = "preview"
clock_port = "clk"
frequency_mhz = 100
rtl = ["preview.v"]
[flow]
preset = "rtl2gds"
[pdk]
name = "ics55"
root = ${JSON.stringify(root)}
`,
    )
    await cli.run(
      [
        'workspace',
        'create',
        'preview',
        '--from',
        'synthesis',
        '--to',
        'synthesis',
        '--project',
        directory,
        '--plain',
      ],
      {
        cwd: directory,
        timeoutMs: 30_000,
      },
    )
    const config = JSON.parse(
      await readFile(join(directory, 'preview', 'config', 'db_ecc.json'), 'utf8'),
    )
    const input = config?.INPUT
    const path = (value: unknown): value is string =>
      typeof value === 'string' && isAbsolute(value)
    const paths = (value: unknown): value is string[] =>
      Array.isArray(value) && value.length > 0 && value.every(path)
    if (
      !path(input?.tech_lef_path) ||
      !paths(input.lef_paths) ||
      !paths(input.lib_path)
    ) {
      throw new Error('ECC workspace configuration is missing default PDK resources')
    }
    return {
      techLef: input.tech_lef_path,
      cellLefs: input.lef_paths,
      liberty: input.lib_path,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
