import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { recoverInterruptedFlow } from './interruptedFlowRecovery'

const { rename } = vi.hoisted(() => ({ rename: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  rename.mockImplementation(actual.rename)
  return { ...actual, rename }
})

const roots: string[] = []

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 4)}\n`, 'utf8')
}

describe('recoverInterruptedFlow', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
    rename.mockClear()
  })

  it('marks ongoing flow and subflow steps incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-flow-recovery-'))
    roots.push(root)
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [
        { name: 'Floorplan', tool: 'ecc', state: 'Ongoing' },
        { name: 'route', tool: 'ecc', state: 'Success' },
        { name: 'place', tool: 'dreamplace', state: 'Ongoing' },
        { name: 'Timing optimization', tool: 'sizer', state: 'Ongoing' },
      ],
    })
    await writeJson(join(root, 'Floorplan_ecc', 'subflow.json'), {
      steps: [
        { name: 'load data', state: 'Success' },
        { name: 'run floorplan', state: 'Ongoing' },
      ],
    })
    await writeJson(join(root, 'place_dreamplace', 'subflow.json'), {
      steps: [{ name: 'run placement', state: 'Ongoing' }],
    })
    await writeJson(join(root, 'timing_optimization_sizer', 'subflow.json'), {
      steps: [{ name: 'run sizer', state: 'Ongoing' }],
    })

    await expect(recoverInterruptedFlow(root)).resolves.toEqual({
      errors: [],
      recoveredSteps: 3,
    })

    const flow = JSON.parse(await readFile(join(root, 'home', 'flow.json'), 'utf8'))
    expect(flow.steps.map((step: { state: string }) => step.state)).toEqual([
      'Incomplete',
      'Success',
      'Incomplete',
      'Incomplete',
    ])
    const subflow = JSON.parse(await readFile(join(root, 'Floorplan_ecc', 'subflow.json'), 'utf8'))
    expect(subflow.steps.map((step: { state: string }) => step.state)).toEqual([
      'Success',
      'Incomplete',
    ])
    const sizerSubflow = JSON.parse(
      await readFile(join(root, 'timing_optimization_sizer', 'subflow.json'), 'utf8'),
    )
    expect(sizerSubflow.steps[0].state).toBe('Incomplete')
  })

  it('keeps the main flow failed when a subflow is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-flow-recovery-'))
    roots.push(root)
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Ongoing' }],
    })

    const result = await recoverInterruptedFlow(root)

    expect(result.recoveredSteps).toBe(1)
    expect(result.errors).toContainEqual(expect.stringContaining('subflow recovery failed'))
    const flow = JSON.parse(await readFile(join(root, 'home', 'flow.json'), 'utf8'))
    expect(flow.steps[0].state).toBe('Incomplete')
  })

  it('does not overwrite an invalid main flow file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-flow-recovery-'))
    roots.push(root)
    const flowPath = join(root, 'home', 'flow.json')
    const invalidFlow = '{"steps": ['
    await mkdir(dirname(flowPath), { recursive: true })
    await writeFile(flowPath, invalidFlow, 'utf8')

    const result = await recoverInterruptedFlow(root)

    expect(result).toMatchObject({ recoveredSteps: 0 })
    expect(result.errors).toContainEqual(expect.stringContaining('flow.json recovery failed'))
    await expect(readFile(flowPath, 'utf8')).resolves.toBe(invalidFlow)
  })

  it('preserves an invalid subflow after marking the main flow incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-flow-recovery-'))
    roots.push(root)
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Ongoing' }],
    })
    const subflowPath = join(root, 'Synthesis_yosys', 'subflow.json')
    const invalidSubflow = '{"steps": ['
    await mkdir(dirname(subflowPath), { recursive: true })
    await writeFile(subflowPath, invalidSubflow, 'utf8')

    const result = await recoverInterruptedFlow(root)

    expect(result.recoveredSteps).toBe(1)
    expect(result.errors).toContainEqual(expect.stringContaining('subflow recovery failed'))
    const flow = JSON.parse(await readFile(join(root, 'home', 'flow.json'), 'utf8'))
    expect(flow.steps[0].state).toBe('Incomplete')
    await expect(readFile(subflowPath, 'utf8')).resolves.toBe(invalidSubflow)
  })

  it('retries transient atomic write failures three times', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-flow-recovery-'))
    roots.push(root)
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Ongoing' }],
    })
    rename
      .mockRejectedValueOnce(new Error('temporary lock'))
      .mockRejectedValueOnce(new Error('temporary lock'))

    const result = await recoverInterruptedFlow(root)

    expect(rename).toHaveBeenCalledTimes(3)
    expect(result.recoveredSteps).toBe(1)
    const flow = JSON.parse(await readFile(join(root, 'home', 'flow.json'), 'utf8'))
    expect(flow.steps[0].state).toBe('Incomplete')
  })
})
