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

  it('loads only lightweight workspace JSON summaries', async () => {
    const directory = createWorkspace()
    writeFileSync(join(directory, 'home', 'home.json'), JSON.stringify({ flow: 'home/flow.json' }))
    writeFileSync(
      join(directory, 'home', 'flow.json'),
      JSON.stringify({
        steps: [
          {
            name: 'Synthesis',
            runtime: '1s',
            state: 'Success',
            tool: 'yosys',
          },
        ],
      }),
    )
    writeFileSync(join(directory, 'home', 'parameters.json'), JSON.stringify({ PDK: 'ics55' }))

    await expect(new WorkspaceSnapshotLoader().load(directory)).resolves.toMatchObject({
      directory,
      flow: { steps: [{ name: 'Synthesis', state: 'Success', tool: 'yosys' }] },
      home: { flow: 'home/flow.json' },
      operations: [],
      parameters: { PDK: 'ics55' },
    })
  })

  it('rejects an oversized JSON resource instead of transferring it to the renderer', async () => {
    const directory = createWorkspace()
    writeFileSync(join(directory, 'home', 'home.json'), '{}')
    writeFileSync(join(directory, 'home', 'parameters.json'), '{}')
    writeFileSync(join(directory, 'home', 'flow.json'), 'x'.repeat(512 * 1024 + 1))

    await expect(new WorkspaceSnapshotLoader().load(directory)).rejects.toThrow(
      'Workspace snapshot resource exceeds',
    )
  })
})
