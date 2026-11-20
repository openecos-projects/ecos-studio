import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
    schema_version: 3,
    steps: [
      {
        name: 'placement',
        state: 'Success',
        tool: 'dreamplace',
        directory: '06_placement_dreamplace',
      },
      { name: 'cts', state: 'Success', tool: 'ecc', directory: '07_cts_ecc' },
      {
        name: 'legalization',
        state: 'Success',
        tool: 'dreamplace',
        directory: '08_legalization_dreamplace',
      },
    ],
  })
  const artifact = Buffer.from('place-def')
  await mkdir(join(source, 'home'), { recursive: true })
  await mkdir(join(source, 'config'), { recursive: true })
  await mkdir(join(source, '06_placement_dreamplace', 'output'), { recursive: true })
  await mkdir(join(source, 'CTS_ecc', 'output'), { recursive: true })
  await mkdir(join(source, 'legalization_dreamplace', 'output'), { recursive: true })
  await writeFile(join(source, 'home', 'flow.json'), flow)
  await writeFile(join(source, 'home', 'parameters.json'), '{"Target density":0.45}\n')
  await writeFile(
    join(source, 'config', 'dreamplace_ecc.json'),
    '{"density_weight":0.01}\n',
  )
  await writeFile(
    join(source, '06_placement_dreamplace', 'output', 'gcd_placement.def.gz'),
    artifact,
  )
  await writeFile(join(source, 'CTS_ecc', 'output', 'gcd_CTS.def.gz'), 'stale')
  await writeFile(
    join(source, 'legalization_dreamplace', 'output', 'gcd_legalization.def.gz'),
    'stale',
  )
  for (const directory of [
    '06_placement_dreamplace',
    'CTS_ecc',
    'legalization_dreamplace',
  ]) {
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
    end_step: 'placement',
    execution_scope: 'single_step',
    parameter_patch: [{ knob_id: 'place.target_density', value: 0.55 }],
    requires_gui_review: true,
    rerun_id: 'gcd_rerun_placement',
    schema_version: 'flow-agent.workspace_rerun_contract.v1',
    source_stage_artifact: '06_placement_dreamplace/output/gcd_placement.def.gz',
    source_flow_json_sha256: sha256(flow),
    source_stage_artifact_sha256: sha256(artifact),
    source_workspace: source,
    target_step: 'placement',
    target_workspace: `${source}_rerun_placement`,
    step_configurations: [],
    workspace_parameters: { target_density: 0.55 },
  }
}

describe('prepareWorkspaceRerun', () => {
  it('forks only after checking the completed stage and frozen evidence', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    const fork = vi.fn().mockResolvedValue({ directory: contract.target_workspace })
    await expect(prepareWorkspaceRerun(contract, fork)).resolves.toEqual({
      directory: contract.target_workspace,
    })
    expect(fork).toHaveBeenCalledOnce()
  })

  it('executes the frozen contract through acknowledged ECC runtime operations', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    const runtime = {
      startFlowOperation: vi.fn().mockResolvedValue({ operationId: 'operation-flow' }),
      startStepOperation: vi.fn().mockResolvedValue({ operationId: 'operation-place' }),
      updateWorkspaceConfiguration: vi.fn().mockResolvedValue({ workspaceRevision: 2 }),
      updateWorkspaceStepConfiguration: vi
        .fn()
        .mockResolvedValue({ workspaceRevision: 3 }),
      waitForOperation: vi.fn().mockResolvedValue({ error: null, state: 'succeeded' }),
    }

    await executeWorkspaceRerun(contract, runtime, 'target-gui-handle', 1)

    expect(runtime.updateWorkspaceConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: {
          design: {},
          parameters: { target_density: 0.55 },
          pdk: {},
        },
        expectedWorkspaceRevision: 1,
        workspaceHandle: 'target-gui-handle',
      }),
    )
    expect(runtime.startStepOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        rerun: false,
        step: 'placement',
        workspaceHandle: 'target-gui-handle',
      }),
    )
    expect(runtime.waitForOperation).toHaveBeenCalledWith({
      operationId: 'operation-place',
      workspaceHandle: 'target-gui-handle',
    })
  })

  it('updates parameters atomically and executes every full-flow step in order', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.end_step = 'Harden'
    contract.execution_scope = 'full_flow'
    contract.parameter_patch = [{ knob_id: 'place.density_weight', value: 0.1 }]
    contract.workspace_parameters = { 'place.density_weight': 0.1 }
    contract.step_configurations = []
    const runtime = {
      startFlowOperation: vi.fn().mockResolvedValue({ operationId: 'operation-flow' }),
      startStepOperation: vi
        .fn()
        .mockImplementation(async (request: { step: string }) => ({
          operationId: `operation-${request.step}`,
        })),
      updateWorkspaceConfiguration: vi.fn().mockResolvedValue({ workspaceRevision: 2 }),
      waitForOperation: vi.fn().mockResolvedValue({ error: null, state: 'succeeded' }),
    }

    await executeWorkspaceRerun(contract, runtime, 'target-gui-handle', 1)

    expect(runtime.updateWorkspaceConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: {
          design: {},
          parameters: { 'place.density_weight': 0.1 },
          pdk: {},
        },
        expectedWorkspaceRevision: 1,
      }),
    )
    expect(runtime.startStepOperation).not.toHaveBeenCalled()
    expect(runtime.startFlowOperation).toHaveBeenCalledWith({
      expectedWorkspaceRevision: 2,
      idempotencyKey: expect.any(String),
      rerun: false,
      workspaceHandle: 'target-gui-handle',
    })
    expect(runtime.waitForOperation).toHaveBeenCalledWith({
      operationId: 'operation-flow',
      workspaceHandle: 'target-gui-handle',
    })
  })

  it('rejects a nonempty patch without domain updates', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.workspace_parameters = null as never

    await expect(prepareWorkspaceRerun(contract, vi.fn())).rejects.toThrow(
      'Workspace rerun contract is invalid',
    )
  })

  it('rejects unsafe Step Option keys', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.workspace_parameters = {}
    contract.step_configurations = [
      { step_id: 'placement', options: JSON.parse('{"__proto__": {"polluted": true}}') },
    ]

    await expect(prepareWorkspaceRerun(contract, vi.fn())).rejects.toThrow(
      'Workspace rerun contract is invalid',
    )
  })

  it('fails closed before copying when the frozen source evidence is stale', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.source_flow_json_sha256 = '0'.repeat(64)
    await expect(prepareWorkspaceRerun(contract, vi.fn())).rejects.toThrow(
      'evidence is stale',
    )
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

    await expect(prepareWorkspaceRerun(contract, vi.fn())).rejects.toThrow(
      'does not match the completed stage',
    )
  })

  it('rejects a full-flow end step that is not the flow terminus', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = {
      ...contractFor(source, flow, artifact),
      end_step: 'CTS',
      execution_scope: 'full_flow' as const,
    }

    await expect(prepareWorkspaceRerun(contract, vi.fn())).rejects.toThrow(
      'full-flow end step must be the flow terminus',
    )
  })

  it('rejects a source workspace whose home path escapes through a symlink', async () => {
    const { artifact, flow, root, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    const outsideHome = join(root, 'outside-home')
    await mkdir(outsideHome)
    await writeFile(join(outsideHome, 'flow.json'), flow)
    await rm(join(source, 'home'), { force: true, recursive: true })
    await symlink(outsideHome, join(source, 'home'))
    await expect(prepareWorkspaceRerun(contract, vi.fn())).rejects.toThrow('outside')
  })
})
