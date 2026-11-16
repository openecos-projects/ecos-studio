import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildReplayCatalog, replaySettings } from './replayService'

let workspace: string
async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ecos-replay-'))
  await mkdir(join(workspace, 'home'))
  await writeFile(
    join(workspace, 'home/params.toml'),
    '[params.replay]\nenabled = true\n',
  )
})
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

async function recording(): Promise<string> {
  const root = join(workspace, 'place_dreamplace/output/geometry/replay')
  await json(join(root, 'manifest.json'), {
    schema: 'ecos.replay.v1',
    status: 'complete',
    attempt_id: 'a',
    manifest: 'attempts/a/manifest.json',
  })
  await json(join(root, 'attempts/a/manifest.json'), {
    schema: 'ecos.replay.v1',
    status: 'complete',
    attempt_id: 'a',
    duration_ns: 4500000000,
    frames: [
      { subflow: 'load data', elapsed_ns: 0 },
      { subflow: 'run placement', elapsed_ns: 1000000000 },
    ],
  })
  return root
}

describe('Replay workspace boundary', () => {
  it('reads the CLI-owned flag and defaults missing settings off', async () => {
    expect(await replaySettings(workspace)).toEqual({ enabled: true })
    await writeFile(
      join(workspace, 'home/params.toml'),
      '[params.replay]\nenabled = false\n',
    )
    expect(await replaySettings(workspace)).toEqual({ enabled: false })
    await rm(join(workspace, 'home/params.toml'))
    expect(await replaySettings(workspace)).toEqual({ enabled: false })
  })

  it('preserves intervening steps and uses captured timing without rewriting the flow', async () => {
    const flow = {
      steps: [
        { name: 'postFloorplan', tool: 'ecc', state: 'Success', runtime: '00:00:02' },
        {
          name: 'preplace',
          tool: 'sizer',
          state: 'Success',
          runtime: '00:00:03',
          resource_observation: { elapsed_seconds: 3.25 },
        },
        { name: 'place', tool: 'dreamplace', state: 'Success', runtime: '00:00:04' },
      ],
    }
    const path = join(workspace, 'home/flow.json')
    await json(path, flow)
    await recording()
    const catalog = JSON.parse(
      await readFile(await buildReplayCatalog(workspace), 'utf8'),
    )
    expect(
      catalog.steps.map((step: { name: string; seconds: number }) => [
        step.name,
        step.seconds,
      ]),
    ).toEqual([
      ['postFloorplan', 2],
      ['preplace', 3.25],
      ['place', 4.5],
    ])
    expect(catalog.steps[2].nodes).toEqual([
      { seconds: 0, label: 'load data' },
      { seconds: 1, label: 'run placement' },
    ])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(flow)
  })

  it('uses real runner subflow boundaries including analysis without geometry', async () => {
    await json(join(workspace, 'home/flow.json'), {
      steps: [{ name: 'place', tool: 'dreamplace', state: 'Success' }],
    })
    const root = await recording()
    const path = join(root, 'attempts/a/manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.subflow_timing = [
      { name: 'run placement', start_ns: 0, end_ns: 3000000000 },
      { name: 'analysis', start_ns: 3000000000, end_ns: 4000000000 },
    ]
    await json(path, manifest)
    const catalog = JSON.parse(
      await readFile(await buildReplayCatalog(workspace), 'utf8'),
    )
    expect(catalog.steps[0].nodes).toEqual([
      { seconds: 3, label: 'run placement · 3.000s' },
      { seconds: 4, label: 'analysis · 1.000s' },
    ])
  })

  it('does not expose stale attempts or an executing flow', async () => {
    await json(join(workspace, 'home/flow.json'), {
      steps: [{ name: 'place', tool: 'dreamplace', state: 'Ongoing' }],
    })
    await expect(buildReplayCatalog(workspace)).rejects.toThrow('after the flow stops')
    await json(join(workspace, 'home/flow.json'), {
      steps: [{ name: 'place', tool: 'dreamplace', state: 'Success' }],
    })
    const root = await recording()
    await json(join(root, 'manifest.json'), { schema: 'ecos.replay.v1', status: 'stale' })
    await expect(buildReplayCatalog(workspace)).rejects.toThrow('No Replay data')
  })

  it('rejects capture paths escaping through symlinks', async () => {
    await json(join(workspace, 'home/flow.json'), {
      steps: [{ name: 'place', tool: 'dreamplace', state: 'Success' }],
    })
    const root = await recording()
    const manifest = join(root, 'attempts/a/manifest.json')
    await rm(manifest)
    await symlink(join(workspace, 'home/flow.json'), manifest)
    await expect(buildReplayCatalog(workspace)).rejects.toThrow('escapes')
  })
})

it('opens a current failed-check diagnostic without changing the failed flow state', async () => {
  const root = await recording()
  const pointerPath = join(root, 'manifest.json')
  const manifestPath = join(root, 'attempts/a/manifest.json')
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8'))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  pointer.status = manifest.status = 'diagnostic_only'
  manifest.diagnostic_only = true
  manifest.flow_state = 'Incomplete'
  await json(pointerPath, pointer)
  await json(manifestPath, manifest)
  const flow = { steps: [{ name: 'place', tool: 'dreamplace', state: 'Incomplete' }] }
  await json(join(workspace, 'home/flow.json'), flow)
  const catalog = JSON.parse(await readFile(await buildReplayCatalog(workspace), 'utf8'))
  expect(catalog.steps[0].manifest).toBe(manifestPath)
  expect(JSON.parse(await readFile(join(workspace, 'home/flow.json'), 'utf8'))).toEqual(
    flow,
  )
  manifest.diagnostic_only = false
  await json(manifestPath, manifest)
  await expect(buildReplayCatalog(workspace)).rejects.toThrow('Replay attempt mismatch')
})

it.skipIf(!process.env.ECOS_REPLAY_TEST_WORKSPACE)(
  'builds a catalog from the supplied completed tool workspace',
  async () => {
    const path = await buildReplayCatalog(process.env.ECOS_REPLAY_TEST_WORKSPACE!)
    const catalog = JSON.parse(await readFile(path, 'utf8'))
    expect(catalog.steps.some((step: { manifest?: string }) => step.manifest)).toBe(true)
  },
)

it('accepts v2 only when the pointer and attempt schemas agree', async () => {
  const root = await recording()
  await json(join(workspace, 'home/flow.json'), {
    steps: [{ name: 'place', tool: 'dreamplace', state: 'Success' }],
  })
  for (const name of ['manifest.json', 'attempts/a/manifest.json']) {
    const path = join(root, name)
    const data = JSON.parse(await readFile(path, 'utf8'))
    data.schema = 'ecos.replay.v2'
    await json(path, data)
  }
  await expect(buildReplayCatalog(workspace)).resolves.toBe(
    join(workspace, 'home/replay-view.json'),
  )
})
