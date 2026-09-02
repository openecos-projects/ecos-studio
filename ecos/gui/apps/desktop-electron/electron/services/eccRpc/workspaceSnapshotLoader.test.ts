import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceSnapshotLoader } from './workspaceSnapshotLoader'

const temporaryDirectories: string[] = []

function createWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ecos-workspace-snapshot-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'home'))
  return directory
}

describe('WorkspaceSnapshotLoader', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('loads the bounded configuration snapshot used for project baseline sync', async () => {
    const directory = createWorkspace()
    mkdirSync(join(directory, 'config'))
    writeFileSync(
      join(directory, 'home', 'parameters.json'),
      JSON.stringify({ Design: 'gcd', PDK: 'ics55' }),
    )
    writeFileSync(
      join(directory, 'home', 'pdk.json'),
      JSON.stringify({ tech_lef: ['/pdks/ics55/tech.lef'] }),
    )
    writeFileSync(
      join(directory, 'config', 'db_ecc.json'),
      JSON.stringify({ INPUT: { rtl_list: ['/sources/gcd.sv'] } }),
    )

    await expect(
      new WorkspaceSnapshotLoader().loadBaselineSnapshot(directory),
    ).resolves.toEqual({
      parameters: { Design: 'gcd', PDK: 'ics55' },
      pdk: { tech_lef: ['/pdks/ics55/tech.lef'] },
      db: { INPUT: { rtl_list: ['/sources/gcd.sv'] } },
    })
  })
})
