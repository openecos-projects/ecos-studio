import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const growAfterStat = vi.hoisted(() => ({
  path: null as string | null,
}))

const shortReadPath = vi.hoisted(() => ({
  path: null as string | null,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (
      path: Parameters<typeof actual.open>[0],
      flags?: Parameters<typeof actual.open>[1],
    ) => {
      const handle = await actual.open(path, flags)
      if (growAfterStat.path && String(path) === growAfterStat.path) {
        const originalStat = handle.stat.bind(handle)
        handle.stat = (async () => {
          const info = await originalStat()
          appendFileSync(growAfterStat.path!, 'x'.repeat(512 * 1024))
          return info
        }) as typeof handle.stat
      }
      if (shortReadPath.path && String(path) === shortReadPath.path) {
        const originalRead = handle.read.bind(handle)
        let first = true
        handle.read = (async (options?: Parameters<typeof handle.read>[0]) => {
          if (first && options && typeof options === 'object' && 'length' in options) {
            first = false
            const length = Math.min(1, Number(options.length) || 0)
            return await originalRead({ ...options, length })
          }
          return await originalRead(options)
        }) as typeof handle.read
      }
      return handle
    },
  }
})

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
    writeFileSync(
      join(directory, 'home', 'home.json'),
      JSON.stringify({ flow: 'home/flow.json' }),
    )
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
    writeFileSync(
      join(directory, 'home', 'parameters.json'),
      JSON.stringify({ PDK: 'ics55' }),
    )

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

  it('rejects a file that grows past the cap after the opened handle is statted', async () => {
    const directory = createWorkspace()
    const flowPath = join(directory, 'home', 'flow.json')
    writeFileSync(join(directory, 'home', 'home.json'), '{}')
    writeFileSync(join(directory, 'home', 'parameters.json'), '{}')
    writeFileSync(flowPath, '{}')

    growAfterStat.path = flowPath
    try {
      await expect(new WorkspaceSnapshotLoader().load(directory)).rejects.toThrow(
        'Workspace snapshot resource exceeds',
      )
    } finally {
      growAfterStat.path = null
    }
  })

  it('reassembles a snapshot file that arrives in short reads', async () => {
    const directory = createWorkspace()
    const flowPath = join(directory, 'home', 'flow.json')
    writeFileSync(join(directory, 'home', 'home.json'), '{}')
    writeFileSync(join(directory, 'home', 'parameters.json'), '{}')
    writeFileSync(
      flowPath,
      JSON.stringify({
        steps: [{ name: 'Synthesis', runtime: '1s', state: 'Success', tool: 'yosys' }],
      }),
    )

    shortReadPath.path = flowPath
    try {
      await expect(new WorkspaceSnapshotLoader().load(directory)).resolves.toMatchObject({
        flow: { steps: [{ name: 'Synthesis', state: 'Success', tool: 'yosys' }] },
      })
    } finally {
      shortReadPath.path = null
    }
  })

  it('rejects a symlinked parameters file instead of reading its target', async () => {
    const directory = createWorkspace()
    const external = join(directory, 'external.toml')
    writeFileSync(external, '[params]\ndesign = "external"\n')
    symlinkSync(external, join(directory, 'home', 'ecc.toml'))
    writeFileSync(join(directory, 'home', 'home.json'), '{}')
    writeFileSync(join(directory, 'home', 'flow.json'), JSON.stringify({ steps: [] }))

    await expect(new WorkspaceSnapshotLoader().load(directory)).rejects.toThrow(
      /symlink/i,
    )
  })

  it('rejects reads redirected by a symlinked home directory', async () => {
    const directory = createWorkspace()
    const external = mkdtempSync(join(tmpdir(), 'ecos-snapshot-external-'))
    temporaryDirectories.push(external)
    mkdirSync(join(external, 'home'))
    writeFileSync(join(external, 'home', 'ecc.toml'), '[params]\ndesign = "external"\n')
    rmSync(join(directory, 'home'), { recursive: true, force: true })
    symlinkSync(join(external, 'home'), join(directory, 'home'))

    await expect(new WorkspaceSnapshotLoader().load(directory)).rejects.toThrow(
      /outside the workspace/i,
    )
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
