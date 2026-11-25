import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EccCliProcess } from './cliProcess'

export async function verifyIcs55PdkRoot(
  cli: EccCliProcess,
  root: string,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-pdk-verify-'))
  try {
    await writeFile(
      join(directory, 'ecc.toml'),
      `[pdk]\nname = "ics55"\nroot = ${JSON.stringify(root)}\n`,
    )
    await cli.run(['pdk', 'verify', '--project', directory, '--plain'], {
      cwd: directory,
      timeoutMs: 30_000,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
