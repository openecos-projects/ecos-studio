import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeWorkspaceRerun,
  prepareWorkspaceRerun,
  rewriteHomeJsonSourcePaths,
  rewriteJsonSourcePathStrings,
  rewriteSourceRootedPath,
} from './workspaceRerun'

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
      { name: 'Floorplan', state: 'Success', tool: 'ecc' },
      { name: 'place', state: 'Success', tool: 'dreamplace' },
      { name: 'CTS', state: 'Success', tool: 'ecc' },
      { name: 'legalization', state: 'Success', tool: 'dreamplace' },
    ],
  })
  const artifact = Buffer.from('place-def')
  await mkdir(join(source, 'home'), { recursive: true })
  await mkdir(join(source, 'config'), { recursive: true })
  await mkdir(join(source, 'Floorplan_ecc', 'output'), { recursive: true })
  await mkdir(join(source, 'place_dreamplace', 'output'), { recursive: true })
  await mkdir(join(source, 'CTS_ecc', 'output'), { recursive: true })
  await mkdir(join(source, 'legalization_dreamplace', 'output'), { recursive: true })
  await writeFile(join(source, 'home', 'flow.json'), flow)
  await writeFile(join(source, 'home', 'parameters.json'), '{"Target density":0.45}\n')
  await writeFile(
    join(source, 'config', 'dreamplace_ecc.json'),
    '{"density_weight":0.01}\n',
  )
  await writeFile(
    join(source, 'Floorplan_ecc', 'output', 'gcd_Floorplan.def.gz'),
    'checkpoint',
  )
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
    writes: [
      {
        file: 'home/parameters.json',
        json_path: ['Target density'],
        knob_id: 'place.target_density',
        surface: 'parameters',
        value: 0.55,
      },
    ],
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
    await expect(
      readFile(`${contract.target_workspace}/home/parameters.json`, 'utf8'),
    ).resolves.toContain('0.55')
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
      readFile(
        `${contract.target_workspace}/Floorplan_ecc/output/gcd_Floorplan.def.gz`,
        'utf8',
      ),
    ).resolves.toBe('checkpoint')
    await expect(
      readdir(`${contract.target_workspace}/place_dreamplace`),
    ).resolves.toEqual([])
    await expect(readdir(`${contract.target_workspace}/CTS_ecc`)).resolves.toEqual([])
    await expect(
      readdir(`${contract.target_workspace}/legalization_dreamplace`),
    ).resolves.toEqual([])

    const targetFlow = JSON.parse(
      await readFile(`${contract.target_workspace}/home/flow.json`, 'utf8'),
    ) as { steps: Array<{ name: string; state: string; runtime?: string }> }
    expect(targetFlow.steps).toEqual([
      { name: 'Floorplan', state: 'Success', tool: 'ecc' },
      { name: 'place', state: 'Unstart', tool: 'dreamplace', runtime: '' },
      { name: 'CTS', state: 'Unstart', tool: 'ecc', runtime: '' },
      { name: 'legalization', state: 'Unstart', tool: 'dreamplace', runtime: '' },
    ])
  })

  it('accepts the LEC result JSON as stage evidence and wipes the LEC stage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecos-workspace-rerun-lec-'))
    temporaryRoots.push(root)
    const source = join(root, 'gcd')
    const flow = JSON.stringify({
      steps: [
        { name: 'place', state: 'Success', tool: 'dreamplace' },
        { name: 'postRouteLec', state: 'Success', tool: 'yosys_lec', runtime: '12s' },
      ],
    })
    const artifact = Buffer.from('place-def')
    const lecResult = Buffer.from('{"status":"proven"}\n')
    await mkdir(join(source, 'home'), { recursive: true })
    await mkdir(join(source, 'place_dreamplace', 'output'), { recursive: true })
    await mkdir(join(source, 'postRouteLec_yosys_lec', 'output'), { recursive: true })
    await writeFile(join(source, 'home', 'flow.json'), flow)
    await writeFile(join(source, 'home', 'parameters.json'), '{}\n')
    await writeFile(
      join(source, 'home', 'home.json'),
      `${JSON.stringify({
        monitor: {
          step: ['place - analysis', 'postRouteLec - analysis'],
          memory: ['1', '2'],
          runtime: ['1', '2'],
          instance: ['1', '2'],
          frequency: ['1', '2'],
        },
      })}\n`,
    )
    await writeFile(
      join(source, 'home', 'checklist.json'),
      `${JSON.stringify({
        schema_version: 3,
        kind: 'signoff_checklist',
        status: 'ready',
        summary: { passed: 1, blocked: 0, attention: 0, unavailable: 0 },
        checklist: [
          { id: 'lec.postroute', step: 'postRouteLec', state: 'pass', blocked: false },
        ],
      })}\n`,
    )
    await writeFile(
      join(source, 'place_dreamplace', 'output', 'gcd_place.def.gz'),
      artifact,
    )
    await writeFile(
      join(source, 'postRouteLec_yosys_lec', 'output', 'gcd_postRouteLec_result.json'),
      lecResult,
    )

    const contract: DesktopAgentWorkspaceRerunContract = {
      design_id: 'gcd',
      end_step: 'postRouteLec',
      execution_scope: 'single_step',
      parameter_patch: [],
      requires_gui_review: true,
      rerun_id: 'gcd_rerun_postroutelec',
      schema_version: 'flow-agent.workspace_rerun_contract.v1',
      source_stage_artifact: 'postRouteLec_yosys_lec/output/gcd_postRouteLec_result.json',
      source_flow_json_sha256: sha256(flow),
      source_stage_artifact_sha256: sha256(lecResult),
      source_workspace: source,
      target_step: 'postRouteLec',
      target_workspace: `${source}_rerun_postroutelec`,
      writes: [],
    }

    await expect(prepareWorkspaceRerun(contract)).resolves.toEqual({
      directory: contract.target_workspace,
    })

    // The LEC stage is wiped while the earlier completed stage is preserved.
    await expect(
      readdir(join(contract.target_workspace, 'postRouteLec_yosys_lec')),
    ).resolves.toEqual([])
    await expect(
      readFile(
        join(contract.target_workspace, 'place_dreamplace', 'output', 'gcd_place.def.gz'),
        'utf8',
      ),
    ).resolves.toBe('place-def')

    const targetFlow = JSON.parse(
      await readFile(join(contract.target_workspace, 'home', 'flow.json'), 'utf8'),
    ) as { steps: Array<{ name: string; state: string; runtime?: string }> }
    expect(targetFlow.steps).toEqual([
      { name: 'place', state: 'Success', tool: 'dreamplace' },
      { name: 'postRouteLec', state: 'Unstart', tool: 'yosys_lec', runtime: '' },
    ])

    const home = JSON.parse(
      await readFile(join(contract.target_workspace, 'home', 'home.json'), 'utf8'),
    ) as { monitor: { step: string[]; memory: string[] } }
    expect(home.monitor.step).toEqual(['place - analysis'])
    expect(home.monitor.memory).toEqual(['1'])

    const checklist = JSON.parse(
      await readFile(join(contract.target_workspace, 'home', 'checklist.json'), 'utf8'),
    ) as { checklist: Array<{ step: string }> }
    expect(checklist.checklist).toEqual([])
  })

  it('rewrites home.json paths and prunes post-target home aggregates', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    await mkdir(join(source, 'drc_ecc', 'analysis'), { recursive: true })
    await writeFile(join(source, 'drc_ecc', 'analysis', 'drc.png'), 'drc')
    await writeFile(
      join(source, 'home', 'home.json'),
      `${JSON.stringify(
        {
          parameters: `${source}/home/parameters.json`,
          flow: `${source}/home/flow.json`,
          layout: `${source}/legalization_dreamplace/output/layout.png`,
          checklist: `${source}/home/checklist.json`,
          metrics: {
            'drc dist.': `${source}/drc_ecc/analysis/drc.png`,
          },
          monitor: {
            step: ['place - analysis', 'CTS - analysis', 'legalization - analysis'],
            memory: ['1', '2', '3', '4'],
            runtime: ['1', '2', '3', '4'],
            instance: ['1', '2', '3', '4'],
            frequency: ['1', '2', '3', '4'],
          },
        },
        null,
        4,
      )}\n`,
    )
    await writeFile(
      join(source, 'home', 'checklist.json'),
      `${JSON.stringify(
        {
          schema_version: 3,
          kind: 'signoff_checklist',
          status: 'blocked',
          summary: { passed: 1, blocked: 2, attention: 0, unavailable: 0 },
          checklist: [
            {
              id: 'artifact.floorplan',
              step: 'Floorplan',
              state: 'pass',
              blocked: false,
            },
            {
              id: 'quality.place',
              step: 'place',
              state: 'failed',
              blocked: true,
            },
            {
              id: 'quality.drc.clean',
              step: 'drc',
              state: 'failed',
              blocked: true,
            },
          ],
        },
        null,
        4,
      )}\n`,
    )
    const contract = contractFor(source, flow, artifact)

    await prepareWorkspaceRerun(contract)

    const home = JSON.parse(
      await readFile(`${contract.target_workspace}/home/home.json`, 'utf8'),
    ) as {
      parameters: string
      flow: string
      layout: string
      checklist: string
      metrics: Record<string, string>
      monitor: { step: string[]; memory: string[] }
    }
    expect(home.parameters).toBe(`${contract.target_workspace}/home/parameters.json`)
    expect(home.flow).toBe(`${contract.target_workspace}/home/flow.json`)
    expect(home.checklist).toBe(`${contract.target_workspace}/home/checklist.json`)
    expect(home.layout).toBe('')
    expect(home.metrics).toEqual({})
    expect(home.monitor.step).toEqual([])
    expect(home.monitor.memory).toEqual([])

    const checklist = JSON.parse(
      await readFile(`${contract.target_workspace}/home/checklist.json`, 'utf8'),
    ) as {
      status: string
      summary: { passed: number; blocked: number }
      checklist: Array<{ step: string }>
    }
    expect(checklist.checklist.map((item) => item.step)).toEqual(['Floorplan'])
    expect(checklist.summary).toEqual({
      passed: 1,
      blocked: 0,
      attention: 0,
      unavailable: 0,
    })
    expect(checklist.status).toBe('ready')

    const contractText = await readFile(
      `${contract.target_workspace}/home/flow_agent_workspace_rerun_contract.v1.json`,
      'utf8',
    )
    expect(contractText).toContain(source)
    expect(contractText).not.toContain(
      `"source_workspace": "${contract.target_workspace}"`,
    )
  })

  it('executes the frozen contract through acknowledged ECC runtime operations', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    const runtime = {
      refreshConfig: vi.fn().mockResolvedValue({}),
      startFlowOperation: vi.fn().mockResolvedValue({ operationId: 'operation-flow' }),
      startStepOperation: vi.fn().mockResolvedValue({ operationId: 'operation-place' }),
      syncConfig: vi.fn().mockResolvedValue({}),
      waitForOperation: vi.fn().mockResolvedValue({ error: null, state: 'succeeded' }),
    }

    await executeWorkspaceRerun(contract, runtime, 'target-gui-handle')

    expect(runtime.syncConfig).not.toHaveBeenCalled()
    expect(runtime.refreshConfig).toHaveBeenCalledWith({
      workspaceHandle: 'target-gui-handle',
    })
    expect(runtime.startStepOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        rerun: false,
        step: 'place',
        workspaceHandle: 'target-gui-handle',
      }),
    )
    expect(runtime.waitForOperation).toHaveBeenCalledWith({
      operationId: 'operation-place',
      workspaceHandle: 'target-gui-handle',
    })
  })

  it('materializes resolved step-config writes in the isolated workspace', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.parameter_patch = [{ knob_id: 'place.density_weight', value: 0.1 }]
    contract.writes = [
      {
        file: 'config/dreamplace_ecc.json',
        json_path: ['density_weight'],
        knob_id: 'place.density_weight',
        surface: 'step_config',
        value: 0.1,
      },
    ]

    await prepareWorkspaceRerun(contract)

    await expect(
      readFile(`${contract.target_workspace}/config/dreamplace_ecc.json`, 'utf8'),
    ).resolves.toContain('0.1')
  })

  it('syncs step-config writes and executes every full-flow step in order', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.end_step = 'Harden'
    contract.execution_scope = 'full_flow'
    contract.parameter_patch = [{ knob_id: 'place.density_weight', value: 0.1 }]
    contract.writes = [
      {
        file: 'config/dreamplace_ecc.json',
        json_path: ['density_weight'],
        knob_id: 'place.density_weight',
        surface: 'step_config',
        value: 0.1,
      },
    ]
    const runtime = {
      refreshConfig: vi.fn().mockResolvedValue({}),
      startFlowOperation: vi.fn().mockResolvedValue({ operationId: 'operation-flow' }),
      startStepOperation: vi
        .fn()
        .mockImplementation(async (request: { step: string }) => ({
          operationId: `operation-${request.step}`,
        })),
      syncConfig: vi.fn().mockResolvedValue({}),
      waitForOperation: vi.fn().mockResolvedValue({ error: null, state: 'succeeded' }),
    }

    await executeWorkspaceRerun(contract, runtime, 'target-gui-handle')

    expect(runtime.syncConfig).toHaveBeenCalledWith({
      configPath: `${contract.target_workspace}/config/dreamplace_ecc.json`,
      workspaceHandle: 'target-gui-handle',
    })
    expect(runtime.startStepOperation).not.toHaveBeenCalled()
    expect(runtime.startFlowOperation).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      rerun: false,
      workspaceHandle: 'target-gui-handle',
    })
    expect(runtime.waitForOperation).toHaveBeenCalledWith({
      operationId: 'operation-flow',
      workspaceHandle: 'target-gui-handle',
    })
  })

  it('rejects a nonempty patch without resolved workspace writes', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.writes = []

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(
      'Workspace rerun contract is invalid',
    )
  })

  it('rejects a resolved write that differs from the confirmed patch', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = contractFor(source, flow, artifact)
    contract.writes![0]!.value = 0.45

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(
      'Workspace rerun contract is invalid',
    )
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

  it('rejects a full-flow end step that is not the catalog terminus', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = {
      ...contractFor(source, flow, artifact),
      end_step: 'CTS',
      execution_scope: 'full_flow' as const,
    }

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(
      'full-flow end step must be the catalog terminus',
    )
  })

  it('extends a short source flow to the catalog terminus for full_flow', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    const contract = {
      ...contractFor(source, flow, artifact),
      end_step: 'Harden',
      execution_scope: 'full_flow' as const,
    }

    await prepareWorkspaceRerun(contract)

    const targetFlow = JSON.parse(
      await readFile(`${contract.target_workspace}/home/flow.json`, 'utf8'),
    ) as { steps: Array<{ name: string; state: string }> }
    expect(targetFlow.steps.map((step) => step.name)).toEqual([
      'Floorplan',
      'place',
      'CTS',
      'legalization',
      'Timing optimization',
      'route',
      'drc',
      'lvs',
      'filler',
      'postRouteLec',
      'RCX',
      'sta',
      'Harden',
    ])
    expect(targetFlow.steps.find((step) => step.name === 'place')?.state).toBe('Unstart')
    expect(targetFlow.steps.find((step) => step.name === 'Harden')?.state).toBe('Unstart')
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
    [
      'uses a prototype-polluting json_path',
      (contract: DesktopAgentWorkspaceRerunContract) => {
        contract.parameter_patch = [{ knob_id: 'place.density_weight', value: 0.1 }]
        contract.writes = [
          {
            file: 'config/dreamplace_ecc.json',
            json_path: ['__proto__', 'toString'],
            knob_id: 'place.density_weight',
            surface: 'step_config',
            value: 0.1,
          },
        ]
      },
    ],
    [
      'aliases the same parameter leaf through both config files',
      (contract: DesktopAgentWorkspaceRerunContract) => {
        contract.parameter_patch = [
          { knob_id: 'place.target_density', value: 0.55 },
          { knob_id: 'place.target_overflow', value: 0.1 },
        ]
        contract.writes = [
          {
            file: 'home/params.toml',
            json_path: ['target_density'],
            knob_id: 'place.target_density',
            surface: 'parameters',
            value: 0.55,
          },
          {
            file: 'home/parameters.json',
            json_path: ['Target density'],
            knob_id: 'place.target_overflow',
            surface: 'parameters',
            value: 0.1,
          },
        ]
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

describe('prepareWorkspaceRerun with home/params.toml workspaces', () => {
  it('applies parameter writes to home/params.toml after display-key canonicalization', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    await rm(join(source, 'home', 'parameters.json'))
    await writeFile(
      join(source, 'home', 'params.toml'),
      [
        '[design]',
        'name = "gcd"',
        '',
        '[params]',
        'design = "gcd"',
        'target_density = 0.45',
        '',
      ].join('\n'),
    )
    const contract = contractFor(source, flow, artifact)
    contract.writes = [
      {
        file: 'home/params.toml',
        json_path: ['Target density'],
        knob_id: 'place.target_density',
        surface: 'parameters',
        value: 0.55,
      },
    ]

    await expect(prepareWorkspaceRerun(contract)).resolves.toEqual({
      directory: contract.target_workspace,
    })

    const written = await readFile(
      `${contract.target_workspace}/home/params.toml`,
      'utf8',
    )
    expect(written).toContain('target_density = 0.55')
    expect(written).not.toContain('0.45')
  })

  it('follows disk reality when the contract file says parameters.json but params.toml exists', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    await rm(join(source, 'home', 'parameters.json'))
    await writeFile(
      join(source, 'home', 'params.toml'),
      ['[params]', 'target_density = 0.45', ''].join('\n'),
    )
    const contract = contractFor(source, flow, artifact)
    contract.writes = [
      {
        file: 'home/parameters.json',
        json_path: ['target_density'],
        knob_id: 'place.target_density',
        surface: 'parameters',
        value: 0.55,
      },
    ]

    await expect(prepareWorkspaceRerun(contract)).resolves.toEqual({
      directory: contract.target_workspace,
    })

    const written = await readFile(
      `${contract.target_workspace}/home/params.toml`,
      'utf8',
    )
    expect(written).toContain('target_density = 0.55')
    await expect(
      readFile(`${contract.target_workspace}/home/parameters.json`, 'utf8'),
    ).rejects.toThrow(/ENOENT/)
  })

  it('refuses to materialize parameters through a symlinked config', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    await rm(join(source, 'home', 'parameters.json'))
    const outside = join(source, 'outside.toml')
    await writeFile(outside, '[params]\ntarget_density = 0.45\n')
    await symlink(outside, join(source, 'home', 'params.toml'))
    const contract = contractFor(source, flow, artifact)
    contract.writes = [
      {
        file: 'home/params.toml',
        json_path: ['target_density'],
        knob_id: 'place.target_density',
        surface: 'parameters',
        value: 0.55,
      },
    ]

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(/symlink/i)
    await expect(readFile(outside, 'utf8')).resolves.toBe(
      '[params]\ntarget_density = 0.45\n',
    )
  })

  it('rewrites source-rooted values in home/params.toml', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    await rm(join(source, 'home', 'parameters.json'))
    await writeFile(
      join(source, 'home', 'params.toml'),
      [
        '[params]',
        'design = "gcd"',
        'target_density = 0.45',
        `source_output_path = "${source}/place_dreamplace/output"`,
        `note = "compare ${source}-old against this run"`,
        '',
      ].join('\n'),
    )
    const contract = contractFor(source, flow, artifact)

    await prepareWorkspaceRerun(contract)

    const written = await readFile(
      `${contract.target_workspace}/home/params.toml`,
      'utf8',
    )
    expect(written).toContain(`${contract.target_workspace}/place_dreamplace/output`)
    expect(written).not.toContain(`${source}/place_dreamplace/output`)
    // Prose that merely shares the prefix is never rewritten.
    expect(written).toContain(`compare ${source}-old against this run`)
  })

  it('refuses to rewrite through a home directory swapped for a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecos-workspace-rerun-home-swap-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    const outside = join(root, 'outside')
    await mkdir(home)
    await mkdir(outside)
    const original = [
      '[params]',
      'design = "gcd"',
      'source_output_path = "/src/ws/place_dreamplace/output"',
      '',
    ].join('\n')
    await writeFile(join(home, 'params.toml'), original)
    await writeFile(join(outside, 'params.toml'), original)
    const authorizedHome = home

    await rm(home, { recursive: true })
    await symlink(outside, home)

    await expect(
      rewriteHomeJsonSourcePaths(authorizedHome, {
        sourceWorkspace: '/src/ws',
        sourceWorkspaceRaw: '/src/ws',
        targetWorkspace: '/src/ws_rerun',
      }),
    ).rejects.toThrow(/authorized|no longer resolves|parent directory changed|symlink/i)
    await expect(readFile(join(outside, 'params.toml'), 'utf8')).resolves.toBe(original)
  })

  it('refuses to rewrite home/params.toml when an untouched float cannot round-trip', async () => {
    const { artifact, flow, source } = await writeSourceWorkspace()
    await rm(join(source, 'home', 'parameters.json'))
    await writeFile(
      join(source, 'home', 'params.toml'),
      [
        '[params]',
        'design = "gcd"',
        `source_output_path = "${source}/place_dreamplace/output"`,
        '[flow]',
        'threshold = 0.12345678901234567',
        '',
      ].join('\n'),
    )
    const contract = contractFor(source, flow, artifact)

    await expect(prepareWorkspaceRerun(contract)).rejects.toThrow(/cannot round-trip/)
  })
})

describe('rewriteJsonSourcePathStrings', () => {
  it('rewrites JSON-escaped Windows path tokens without breaking the document', () => {
    const rewritten = rewriteJsonSourcePathStrings(
      '{"origin":"C:\\\\runs\\\\gcd\\\\origin\\\\gcd.v","keep":0.55}',
      [String.raw`C:\runs\gcd`],
      String.raw`C:\runs\gcd_rerun_place`,
    )
    expect(JSON.parse(rewritten)).toEqual({
      origin: String.raw`C:\runs\gcd_rerun_place\origin\gcd.v`,
      keep: 0.55,
    })
  })

  it('re-escapes a native Windows replacement into slash-based JSON', () => {
    const rewritten = rewriteJsonSourcePathStrings(
      '{"origin":"C:/runs/gcd/origin/gcd.v"}',
      [String.raw`C:\runs\gcd`],
      String.raw`C:\runs\gcd_rerun_place`,
    )
    expect(JSON.parse(rewritten)).toEqual({
      origin: String.raw`C:\runs\gcd_rerun_place\origin\gcd.v`,
    })
  })

  it('does not rewrite object keys that look like workspace paths', () => {
    const rewritten = rewriteJsonSourcePathStrings(
      '{"/src/ws/cache":"metadata","origin":"/src/ws/origin/gcd.v"}',
      ['/src/ws'],
      '/src/ws_rerun',
    )
    expect(JSON.parse(rewritten)).toEqual({
      '/src/ws/cache': 'metadata',
      origin: '/src/ws_rerun/origin/gcd.v',
    })
  })

  it('rewrites string values inside arrays', () => {
    const rewritten = rewriteJsonSourcePathStrings(
      '{"files":["/src/ws/origin/gcd.v"]}',
      ['/src/ws'],
      '/src/ws_rerun',
    )
    expect(JSON.parse(rewritten)).toEqual({
      files: ['/src/ws_rerun/origin/gcd.v'],
    })
  })
})

describe('rewriteSourceRootedPath', () => {
  it('rewrites Windows leaves against a slash-terminated prefix', () => {
    expect(
      rewriteSourceRootedPath(
        String.raw`C:\runs\gcd\origin\gcd.v`,
        [String.raw`C:\runs\gcd/`],
        String.raw`C:\runs\gcd_rerun_place`,
      ),
    ).toBe(String.raw`C:\runs\gcd_rerun_place\origin\gcd.v`)
  })

  it('leaves prose that only shares the prefix untouched', () => {
    expect(
      rewriteSourceRootedPath(
        String.raw`compare C:\runs\gcd-old against this run`,
        [String.raw`C:\runs\gcd`],
        String.raw`C:\runs\gcd_rerun_place`,
      ),
    ).toBe(String.raw`compare C:\runs\gcd-old against this run`)
  })
})
