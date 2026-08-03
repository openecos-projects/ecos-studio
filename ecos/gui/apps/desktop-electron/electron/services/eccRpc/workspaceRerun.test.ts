import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeWorkspaceRerun, prepareWorkspaceRerun } from './workspaceRerun'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

async function writeSourceWorkspace(): Promise<{
  artifact: Buffer
  flow: string
  root: string
  source: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'ecos-workspace-rerun-'))
  temporaryRoots.push(root)
  const source = join(root, 'gcd')
  const flow = JSON.stringify({
    steps: [
      { name: 'fixFanout', state: 'Success', tool: 'ecc' },
      { name: 'place', state: 'Success', tool: 'dreamplace' },
      { name: 'CTS', state: 'Success', tool: 'ecc' },
      { name: 'legalization', state: 'Success', tool: 'dreamplace' },
    ],
  })
  const artifact = Buffer.from('place-def')
  await mkdir(join(source, 'home'), { recursive: true })
  await mkdir(join(source, 'fixFanout_ecc', 'output'), { recursive: true })
  await mkdir(join(source, 'place_dreamplace', 'output'), { recursive: true })
  await mkdir(join(source, 'CTS_ecc', 'output'), { recursive: true })
  await mkdir(join(source, 'legalization_dreamplace', 'output'), { recursive: true })
  await writeFile(join(source, 'home', 'flow.json'), flow)
  await writeFile(join(source, 'fixFanout_ecc', 'output', 'gcd_fixFanout.def.gz'), 'checkpoint')
  await writeFile(
    join(source, 'place_dreamplace', 'output', 'gcd_place.def.gz'),
    artifact,
  )
  await writeFile(join(source, 'CTS_ecc', 'output', 'gcd_CTS.def.gz'), 'stale')
  await writeFile(
    join(source, 'legalization_dreamplace', 'output', 'gcd_legalization.def.gz'),
    'stale',
  )
  for (const directory of ['place_dreamplace', 'CTS_ecc', 'legalization_dreamplace']) {
    await writeFile(join(source, directory, 'subflow.json'), '{"state":"Success"}\n')
  }
  return { artifact, flow, root, source }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function contractFor(
  source: string,
  flow: string,
  artifact: Buffer,
): DesktopAgentWorkspaceRerunContract {
  return {
    design_id: 'gcd',
    end_step: 'place',
    execution_scope: 'single_step',
    parameter_patch: [{ knob_id: 'place.target_density', value: 0.55 }],
    requires_gui_review: true,
    rerun_id: 'gcd_rerun_place',
    schema_version: 'flow-agent.workspace_rerun_contract.v1',
    source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
    source_flow_json_sha256: sha256(flow),
    source_stage_artifact_sha256: sha256(artifact),
    source_workspace: source,
    target_step: 'place',
    target_workspace: `${source}_rerun_place`,
  }
}

describe('prepareWorkspaceRerun', () => {
  it('creates the target workspace and persists the frozen rerun contract', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)

    await expect(prepareWorkspaceRerun(contract)).resolves.toEqual({
      directory: contract.target_workspace,
    })

    await expect(
      readFile(`${contract.target_workspace}/home/flow.json`, 'utf8'),
    ).resolves.toContain('"state": "Unstart"')
    await expect(
      readFile(
        `${contract.target_workspace}/home/flow_agent_workspace_rerun_contract.v1.json`,
        'utf8',
      ),
    ).resolves.toContain(contract.rerun_id)
  })

  it('accepts a numbered isolated rerun target', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.target_workspace = `${contract.target_workspace}_0001`
    contract.rerun_id = 'gcd_rerun_place_0001'

    await expect(prepareWorkspaceRerun(contract)).resolves.toEqual({
      directory: contract.target_workspace,
    })
  })

  it('preserves the predecessor checkpoint and empties the rerun suffix', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)

    await prepareWorkspaceRerun(contract)

    await expect(
      readFile(`${contract.target_workspace}/fixFanout_ecc/output/gcd_fixFanout.def.gz`, 'utf8'),
    ).resolves.toBe('checkpoint')
    await expect(readdir(`${contract.target_workspace}/place_dreamplace`)).resolves.toEqual([])
    await expect(readdir(`${contract.target_workspace}/CTS_ecc`)).resolves.toEqual([])
    await expect(readdir(`${contract.target_workspace}/legalization_dreamplace`)).resolves.toEqual([])

    const targetFlow = JSON.parse(
      await readFile(`${contract.target_workspace}/home/flow.json`, 'utf8'),
    ) as { steps: Array<{ name: string; state: string; runtime?: string }> }
    expect(targetFlow.steps).toEqual([
      { name: 'fixFanout', state: 'Success', tool: 'ecc' },
      { name: 'place', state: 'Unstart', tool: 'dreamplace', runtime: '' },
      { name: 'CTS', state: 'Unstart', tool: 'ecc', runtime: '' },
      { name: 'legalization', state: 'Unstart', tool: 'dreamplace', runtime: '' },
    ])
  })

  it('executes the frozen contract through the target GUI workspace handle', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    const runtime = {
      runCandidateRerun: vi.fn().mockResolvedValue({}),
    }

    await executeWorkspaceRerun(contract, runtime, 'target-gui-handle')

    expect(runtime.runCandidateRerun).toHaveBeenCalledWith({
      candidateId: contract.rerun_id,
      executionScope: contract.execution_scope,
      endStep: contract.end_step,
      patch: contract.parameter_patch,
      targetStep: contract.target_step,
      workspaceHandle: 'target-gui-handle',
    })
  })

  it('fails closed before copying when the frozen source evidence is stale', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.source_flow_json_sha256 = '0'.repeat(64)
    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow('evidence is stale')
    await expect(
      readFile(`${contract.target_workspace}/home/flow.json`, 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects evidence that is not the completed target-stage artifact', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.source_stage_artifact = 'home/flow.json'
    contract.source_stage_artifact_sha256 = sha256(flow)

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(
      'does not match the completed stage',
    )
  })

  it('rejects a full-flow end step that differs from the source workspace flow', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = {
      ...contractFor(source, flow, artifact),
      end_step: 'CTS',
      execution_scope: 'full_flow' as const,
    }

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(
      'full-flow end step does not match the source workspace flow',
    )
  })

  it.each([
    [
      'targets a non-isolated directory',
      (contract: DesktopAgentWorkspaceRerunContract) => {
        contract.target_workspace = `${contract.source_workspace}_other`
      },
    ],
    [
      'duplicates a patch knob',
      (contract: DesktopAgentWorkspaceRerunContract) => {
        contract.parameter_patch.push({ knob_id: 'place.target_density', value: 0.6 })
      },
    ],
    [
      'uses an unauthorized patch knob',
      (contract: DesktopAgentWorkspaceRerunContract) => {
        contract.parameter_patch = [{ knob_id: 'place.unknown', value: 0.55 }]
      },
    ],
    [
      'uses an out-of-range patch value',
      (contract: DesktopAgentWorkspaceRerunContract) => {
        contract.parameter_patch = [{ knob_id: 'place.target_density', value: 1 }]
      },
    ],
  ])('fails closed before copying when the contract %s', async (_case, mutate) => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    mutate(contract)
    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(/Workspace rerun/)
    await expect(
      readFile(`${contract.target_workspace}/home/flow.json`, 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects a source workspace whose home path escapes through a symlink', async () => {
    const { artifact, flow, root, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    const outsideHome = join(root, 'outside-home')
    await mkdir(outsideHome)
    await writeFile(join(outsideHome, 'flow.json'), flow)
    await rm(join(source, 'home'), { force: true, recursive: true })
    await symlink(outsideHome, join(source, 'home'))
    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow('outside')
  })
})
