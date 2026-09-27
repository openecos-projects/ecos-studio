import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkspaceFlow } from './persistedState'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

async function writeFlow(value: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ecc-cli-flow-'))
  roots.push(root)
  await mkdir(join(root, 'home'))
  await writeFile(join(root, 'home', 'flow.json'), JSON.stringify(value))
  return root
}

describe('readWorkspaceFlow', () => {
  it('accepts schema 1 with dynamic and unknown step IDs', async () => {
    const root = await writeFlow({
      schema_version: 1,
      steps: [
        {
          name: 'futureIpwPowerStep',
          tool: 'ipw',
          state: 'Ongoing',
          runtime: '00:00:03',
          'peak memory (mb)': 42.5,
        },
      ],
    })
    await expect(readWorkspaceFlow(root)).resolves.toEqual({
      steps: [
        {
          name: 'futureIpwPowerStep',
          peakMemory: 42.5,
          runtime: '00:00:03',
          state: 'Ongoing',
          tool: 'ipw',
        },
      ],
    })
  })

  it('rejects missing and unsupported schema versions', async () => {
    const missing = await writeFlow({ steps: [] })
    const future = await writeFlow({ schema_version: 2, steps: [] })
    await expect(readWorkspaceFlow(missing)).rejects.toThrow('Workspace flow is invalid')
    await expect(readWorkspaceFlow(future)).rejects.toThrow('Workspace flow is invalid')
  })

  it('rejects malformed numeric facts without fixing them in the GUI', async () => {
    const root = await writeFlow({
      schema_version: 1,
      steps: [
        {
          name: 'route',
          state: 'Success',
          'peak memory (mb)': Number.NaN,
        },
      ],
    })
    await expect(readWorkspaceFlow(root)).rejects.toThrow(
      'Workspace flow step is invalid',
    )
  })
})
