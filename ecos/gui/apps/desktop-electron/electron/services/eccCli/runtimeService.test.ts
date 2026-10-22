import type {
  EccWorkspaceCreateRequest,
  EccWorkspaceUpdateRequest,
} from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertEccCliPlatformSupported,
  projectInitArgs,
  projectManifestCreateArgs,
  projectSettingsArgs,
  rtlImportArgs,
  workspaceCreateCommands,
  workspaceParameterValue,
  workspaceRefreshArgs,
  operationFlowMatches,
  registeredRunMatches,
  declaredWorkspaceForDirectory,
  EccCliRuntimeService,
} from './runtimeService'
import { EccCliCommandError, EccCliProcess } from './cliProcess'
import { readProjectManifest } from './persistedState'

const temporaryDirectories: string[] = []

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  vi.restoreAllMocks()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('ECC CLI platform gate', () => {
  it('allows the Linux platform', () => {
    expect(() => assertEccCliPlatformSupported('linux')).not.toThrow()
  })

  it.each(['darwin', 'win32', 'freebsd'] as const)(
    'throws a coded error on unsupported platform %s before any CLI operation',
    async (platform) => {
      expect(() => assertEccCliPlatformSupported(platform)).toThrow(
        expect.objectContaining({ code: 'ECC_CLI_PLATFORM_UNSUPPORTED' }),
      )

      const resolveLaunch = vi.fn()
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
      const service = new EccCliRuntimeService({ resolveLaunch })
      await expect(service.loadProjectManifest('/projects/demo')).rejects.toMatchObject({
        code: 'ECC_CLI_PLATFORM_UNSUPPORTED',
      })
      expect(resolveLaunch).not.toHaveBeenCalled()
    },
  )
})

describe('legacy project migration', () => {
  it('reads an existing Project index without launching ECC or reconciling hidden Workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-read-only-index-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'hidden', 'home'), { recursive: true })
    await writeFile(join(root, 'hidden', 'home', 'flow.json'), '{not-readable')
    await writeFile(
      join(root, 'project.json'),
      JSON.stringify({
        schema_version: 1,
        project_id: 'project',
        name: 'demo',
        design_name: 'gcd',
        root_path: root,
        base_design: {},
        objectives: {},
        workspaces: [
          { workspace_id: 'hidden', workspace_path: 'hidden', status: 'running' },
        ],
      }),
    )
    const run = vi.spyOn(EccCliProcess.prototype, 'run')
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    await expect(service.readProjectManifest(root)).resolves.toMatchObject({
      project_id: 'project',
      workspaces: [{ workspace_id: 'hidden', status: 'running' }],
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns a transient read-only projection when ECC migration is blocked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-runtime-legacy-'))
    temporaryDirectories.push(root)
    const workspace = join(root, 'runs', 'exp1')
    await mkdir(join(workspace, 'home'), { recursive: true })
    await writeFile(
      join(workspace, 'home', 'flow.json'),
      JSON.stringify({ steps: [{ name: 'Synth', state: 'Ongoing' }] }),
    )
    const run = vi
      .spyOn(EccCliProcess.prototype, 'run')
      .mockImplementation(async (args) => {
        if (args[0] === 'version') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              schema_version: 2,
              runtime: 'ECC CLI',
              cli_contract: 1,
            }),
          }
        }
        if (args[0] === 'migrate') {
          throw new EccCliCommandError(21, 'workspace is active', '')
        }
        throw new Error(`unexpected command: ${args.join(' ')}`)
      })
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })

    await expect(service.loadProjectManifest(root)).resolves.toMatchObject({
      project_migration: { status: 'legacy-readonly' },
      workspaces: [{ workspace_id: 'exp1', status: 'running' }],
    })
    await expect(
      service.mutateProjectManifest(root, {
        type: 'delete-workspace',
        workspaceId: 'exp1',
      }),
    ).rejects.toThrow('read-only')
    expect(run).toHaveBeenCalledWith(['migrate', '--project', root, '--yes', '--plain'], {
      cwd: root,
    })
  })
})

function request(
  overrides: Partial<EccWorkspaceCreateRequest> = {},
): EccWorkspaceCreateRequest {
  return {
    commandId: 'command-1',
    projectMode: 'create',
    projectName: 'Demo Project',
    projectRoot: '/projects/demo',
    targetDirectory: '/projects/demo/runs/ws_1',
    workspaceBindings: {
      inputs: {
        def: '/inputs/design.def',
        netlist: '/inputs/design.vg',
        rtl: '/inputs/design.v',
        sdc: '/inputs/design.sdc',
      },
      pdk: { root: '/pdks/ics55' },
    },
    workspaceSpec: {
      design: {
        clockPort: 'clk',
        name: 'gcd',
        topModule: 'gcd_top',
      },
      flow: { flowId: 'rtl2gds', fromStepId: 'synthesis', throughStepId: 'routing' },
      inputs: [
        { inputId: 'rtl', role: 'rtl' },
        { inputId: 'netlist', role: 'netlist' },
        { inputId: 'def', role: 'def' },
        { inputId: 'sdc', role: 'sdc' },
      ],
      parameters: { 'design.frequency_mhz': 500, 'place.density': 0.63 },
      pdk: { familyId: 'ics55' },
    },
    ...overrides,
  }
}

describe('ECC CLI workspace command planning', () => {
  it('persists the selected STA limit through CLI for fresh and derived workspaces', () => {
    const input = request()
    input.workspaceSpec.parameters = { 'sta.max_parallel_corners': 3 }
    expect(workspaceCreateCommands(input, '/projects/demo')[1]).toContain(
      'sta.max_parallel_corners=3',
    )
    input.deriveFrom = { sourceStep: 'placement', workspaceId: 'ws_source' }
    expect(workspaceCreateCommands(input, '/projects/demo')[1]).toEqual([
      'param',
      'set',
      'sta.max_parallel_corners',
      '3',
      '--project',
      '/projects/demo',
      '--workspace',
      'ws_1',
    ])
  })

  it('initializes an MPC Project before its Project and Workspace transactions', () => {
    const input = request({
      eccPdkConfig: {
        externalPaths: ['/macros'],
        overrides: { lefs: ['/macros/sram.lef'] },
      },
      projectMpc: {
        designIndex: 2,
        displayName: 'Frame',
        resourceId: 'mpc:frame',
        root: '/resources/mpc/frame/2.0.0',
        version: '2.0.0',
      },
    })

    expect(projectInitArgs(input, '/projects/demo')).toEqual([
      'init',
      '/projects/demo',
      '--project-name',
      'Demo Project',
      '--design-name',
      'gcd',
      '--mpc-resource-id',
      'mpc:frame',
      '--mpc-display-name',
      'Frame',
      '--mpc-version',
      '2.0.0',
      '--mpc-root',
      '/resources/mpc/frame/2.0.0',
      '--mpc-design-index',
      '2',
    ])
    const commands = workspaceCreateCommands(input, '/projects/demo')
    expect(commands.map((value) => value.slice(0, 2))).toEqual([
      ['project', 'apply'],
      ['workspace', 'create'],
    ])
    expect(commands[0]).toEqual(
      expect.arrayContaining([
        'pdk.external_paths=["/macros"]',
        'pdk.overrides.lefs=["/macros/sram.lef"]',
      ]),
    )
    expect(commands[0]).not.toContainEqual(expect.stringMatching(/^design\.rtl=/))
    expect(commands[1]).toEqual(
      expect.arrayContaining([
        '--from',
        'synthesis',
        '--to',
        'routing',
        '--set',
        'place.density=0.63',
      ]),
    )
  })

  it('uses an existing Project without another init', () => {
    const input = request({ projectMode: 'select' })
    expect(projectInitArgs(input, '/projects/demo')).toBeNull()
    expect(workspaceCreateCommands(input, '/projects/demo')).toHaveLength(2)
  })

  it('derives without applying Project settings or creating a blank Workspace', () => {
    const input = request({
      deriveFrom: { sourceStep: 'placement', workspaceId: 'ws_source' },
      projectMode: 'select',
    })
    expect(workspaceCreateCommands(input, '/projects/demo')).toEqual([
      [
        'workspace',
        'derive',
        'ws_source',
        'ws_1',
        '--project',
        '/projects/demo',
        '--from',
        'placement',
        '--command-id',
        'command-1',
        '--no-wait',
      ],
    ])
  })

  it('maps all supported Project fields into one apply command', () => {
    expect(projectSettingsArgs(request())).toEqual([
      '--set',
      'design.name=gcd',
      '--set',
      'design.top=gcd_top',
      '--set',
      'design.clock_port=clk',
      '--set',
      'design.frequency_mhz=500',
      '--set',
      'design.netlist=/inputs/design.vg',
      '--set',
      'design.def=/inputs/design.def',
      '--set',
      'design.sdc=/inputs/design.sdc',
      '--set',
      'pdk.name=ics55',
      '--set',
      'pdk.root=/pdks/ics55',
      '--set',
      'flow.preset=rtl2gds',
    ])
  })

  it('maps a managed refresh to the public revision-checked CLI command', () => {
    expect(
      workspaceRefreshArgs({
        commandId: 'refresh-1',
        expectedWorkspaceRevision: 4,
        force: true,
        keepBackup: true,
        projectRoot: '/projects/demo',
        workspaceId: 'ws_1',
      }),
    ).toEqual([
      'workspace',
      'refresh',
      'ws_1',
      '--project',
      '/projects/demo',
      '--expected-revision',
      '4',
      '--command-id',
      'refresh-1',
      '--no-wait',
      '--force',
      '--keep-backup',
    ])
  })

  it('maps Project Management MPC creation to the public init options', () => {
    expect(
      projectManifestCreateArgs('/projects/demo', {
        designName: 'gcd',
        mpc: {
          design: { index: 1 },
          display_name: 'Frame',
          installed_version: '2.0.0',
          path: '/resources/frame/2.0.0',
          resource_id: 'mpc:frame',
        },
        name: 'Demo',
        type: 'create',
      }),
    ).toEqual([
      'init',
      '/projects/demo',
      '--project-name',
      'Demo',
      '--design-name',
      'gcd',
      '--mpc-resource-id',
      'mpc:frame',
      '--mpc-display-name',
      'Frame',
      '--mpc-version',
      '2.0.0',
      '--mpc-root',
      '/resources/frame/2.0.0',
      '--mpc-design-index',
      '1',
    ])
  })
})

describe('ECC CLI RTL import planning', () => {
  const mockCliRun = (commands: string[][]) =>
    vi.spyOn(EccCliProcess.prototype, 'run').mockImplementation(async (args) => {
      if (args[0] !== 'version') commands.push([...args])
      if (args[0] === 'version') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            schema_version: 2,
            runtime: 'ECC CLI',
            cli_contract: 1,
          }),
        }
      }
      return { exitCode: 0, stderr: '', stdout: '' }
    })

  it('builds the import argv for exclusive filelist or verilog selections', () => {
    expect(rtlImportArgs('/projects/demo', { filelist: '/inputs/files.f' })).toEqual([
      'rtl',
      'import',
      '--project',
      '/projects/demo',
      '--filelist',
      '/inputs/files.f',
      '--plain',
    ])
    expect(
      rtlImportArgs('/projects/demo', { verilog: ['/inputs/a.v', '/inputs/b.v'] }),
    ).toEqual([
      'rtl',
      'import',
      '--project',
      '/projects/demo',
      '--verilog',
      '/inputs/a.v',
      '--verilog',
      '/inputs/b.v',
      '--plain',
    ])
    expect(rtlImportArgs('/projects/demo', {})).toBeNull()
    expect(
      rtlImportArgs('/projects/demo', { filelist: '/inputs/files.f', verilog: [] }),
    ).toEqual([
      'rtl',
      'import',
      '--project',
      '/projects/demo',
      '--filelist',
      '/inputs/files.f',
      '--plain',
    ])
    expect(() =>
      rtlImportArgs('/projects/demo', {
        filelist: '/inputs/files.f',
        verilog: ['/inputs/a.v'],
      }),
    ).toThrow('not both')
  })

  it('imports pending RTL after init and before the workspace commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-rtl-import-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, 'project.json'), '{"schema_version":1}')
    const commands: string[][] = []
    mockCliRun(commands)
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    vi.spyOn(service, 'openWorkspace').mockResolvedValue({
      directory: join(root, 'runs', 'ws_1'),
      workspaceHandle: 'handle-1',
      workspaceRevision: 1,
    })
    await service.createWorkspace(
      request({ projectRoot: root, targetDirectory: join(root, 'runs', 'ws_1') }),
    )

    expect(commands.map((args) => args.slice(0, 2))).toEqual([
      ['init', root],
      ['rtl', 'import'],
      ['project', 'apply'],
      ['workspace', 'create'],
    ])
    expect(commands[1]).toContain('--verilog')
    expect(commands[1]).toContain('/inputs/design.v')
    expect(commands[2]).not.toContainEqual(expect.stringMatching(/^design\.rtl=/))
  })

  it('skips the import when the project design RTL is reused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-rtl-reuse-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, 'project.json'), '{"schema_version":1}')
    const commands: string[][] = []
    mockCliRun(commands)
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    vi.spyOn(service, 'openWorkspace').mockResolvedValue({
      directory: join(root, 'runs', 'ws_1'),
      workspaceHandle: 'handle-1',
      workspaceRevision: 1,
    })
    const input = request({
      projectRoot: root,
      targetDirectory: join(root, 'runs', 'ws_1'),
    })
    const inputs = (input.workspaceSpec.inputs as Array<Record<string, unknown>>) ?? []
    input.workspaceSpec.inputs = inputs.filter((value) => value.role !== 'rtl')
    delete (input.workspaceBindings.inputs as Record<string, unknown>).rtl
    await service.createWorkspace(input)

    expect(commands.map((args) => args.slice(0, 2))).toEqual([
      ['init', root],
      ['project', 'apply'],
      ['workspace', 'create'],
    ])
  })

  it('never imports for derived workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-rtl-derive-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, 'project.json'), '{"schema_version":1}')
    const commands: string[][] = []
    mockCliRun(commands)
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    vi.spyOn(service, 'openWorkspace').mockResolvedValue({
      directory: join(root, 'runs', 'ws_1'),
      workspaceHandle: 'handle-1',
      workspaceRevision: 1,
    })
    await service.createWorkspace(
      request({
        deriveFrom: { sourceStep: 'placement', workspaceId: 'ws_source' },
        projectMode: 'select',
        projectRoot: root,
        targetDirectory: join(root, 'runs', 'ws_1'),
      }),
    )

    expect(commands.map((args) => args.slice(0, 2))).toEqual([['workspace', 'derive']])
  })

  it('imports RTL after init for a standalone Project creation mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-rtl-mutate-'))
    temporaryDirectories.push(root)
    const commands: string[][] = []
    vi.spyOn(EccCliProcess.prototype, 'run').mockImplementation(async (args) => {
      if (args[0] !== 'version') commands.push([...args])
      if (args[0] === 'version') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            schema_version: 2,
            runtime: 'ECC CLI',
            cli_contract: 1,
          }),
        }
      }
      if (args[0] === 'init') {
        await writeFile(
          join(root, 'project.json'),
          JSON.stringify({
            schema_version: 1,
            project_id: 'proj_demo_ab12cd34ef56',
            name: 'Demo',
            design_name: 'gcd',
            root_path: root,
            base_design: {},
            objectives: {},
            workspaces: [],
          }),
        )
      }
      return { exitCode: 0, stderr: '', stdout: '' }
    })
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    await service.mutateProjectManifest(root, {
      type: 'create',
      name: 'Demo',
      designName: 'gcd',
      rtlImport: { verilog: ['/inputs/design.v'] },
    })

    expect(commands).toEqual([
      ['init', root, '--project-name', 'Demo', '--design-name', 'gcd'],
      ['rtl', 'import', '--project', root, '--verilog', '/inputs/design.v', '--plain'],
    ])
  })
})

describe('ECC CLI Workspace configuration boundary', () => {
  function serviceWithSession() {
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    ;(service as any).sessions.set('handle-1', {
      directory: '/projects/demo/ws_1',
      handle: 'handle-1',
      projectRoot: '/projects/demo',
      workspaceId: 'ws_1',
      workspaceRevision: 4,
    })
    return service
  }

  it('rejects Project fields instead of silently dropping them', async () => {
    const service = serviceWithSession()

    await expect(
      service.updateWorkspaceConfiguration({
        commandId: 'config-1',
        configuration: {
          design: { topModule: 'new_top' },
          parameters: {},
          pdk: {},
        },
        expectedWorkspaceRevision: 4,
        workspaceHandle: 'handle-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONFIGURATION_SCOPE' })
  })

  it('returns the current revision without starting an empty param transaction', async () => {
    const run = vi.spyOn(EccCliProcess.prototype, 'run')
    const service = serviceWithSession()

    await expect(
      service.updateWorkspaceConfiguration({
        commandId: 'config-1',
        configuration: { design: {}, parameters: {}, pdk: {} },
        expectedWorkspaceRevision: 4,
        workspaceHandle: 'handle-1',
      }),
    ).resolves.toMatchObject({ workspaceId: 'ws_1', workspaceRevision: 4 })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('ECC CLI Workspace update transaction', () => {
  function serviceWithSession() {
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    ;(service as any).sessions.set('handle-1', {
      directory: '/projects/demo/ws_1',
      handle: 'handle-1',
      projectRoot: '/projects/demo',
      workspaceId: 'ws_1',
      workspaceRevision: 4,
    })
    return service
  }

  it('persists Wizard project settings, refreshes with a backup, and applies parameters', async () => {
    const input = request()
    const commands: string[][] = []
    vi.spyOn(EccCliProcess.prototype, 'run').mockImplementation(async (args) => {
      commands.push([...args])
      return { exitCode: 0, stderr: '', stdout: '' }
    })
    const readSnapshot = vi.spyOn(
      await import('./engineeringSnapshotReader'),
      'readPersistedEngineeringSnapshot',
    )
    readSnapshot
      .mockResolvedValueOnce({
        workspaceBindings: input.workspaceBindings,
        workspaceRevision: 4,
        workspaceSpec: input.workspaceSpec,
      } as never)
      .mockResolvedValueOnce({ workspaceRevision: 5 } as never)
      .mockResolvedValueOnce({ workspaceRevision: 6 } as never)
    const update: EccWorkspaceUpdateRequest = {
      commandId: 'update-1',
      eccPdkConfig: {
        externalPaths: ['/macros/sram'],
        overrides: { lefs: ['/macros/sram/sram.lef'] },
      },
      expectedWorkspaceRevision: 4,
      retainBackup: true,
      workspaceBindings: input.workspaceBindings,
      workspaceHandle: 'handle-1',
      workspaceSpec: input.workspaceSpec,
    }

    await expect(serviceWithSession().updateWorkspace(update)).resolves.toMatchObject({
      directory: '/projects/demo/ws_1',
      workspaceRevision: 6,
      workspaceId: 'ws_1',
    })

    expect(commands.map((args) => args.slice(0, 2))).toEqual([
      ['project', 'apply'],
      ['workspace', 'refresh'],
      ['param', 'apply'],
    ])
    expect(commands[0]).toEqual(
      expect.arrayContaining([
        '--set',
        'design.top=gcd_top',
        '--set',
        'pdk.external_paths=["/macros/sram"]',
        '--set',
        'pdk.overrides.lefs=["/macros/sram/sram.lef"]',
      ]),
    )
    expect(commands[1]).toEqual([
      'workspace',
      'refresh',
      'ws_1',
      '--project',
      '/projects/demo',
      '--expected-revision',
      '4',
      '--command-id',
      'update-1',
      '--no-wait',
      '--force',
      '--keep-backup',
    ])
    expect(commands[2]).toEqual([
      'param',
      'apply',
      '--project',
      '/projects/demo',
      '--workspace',
      'ws_1',
      '--expected-revision',
      '5',
      '--command-id',
      'update-1:parameters',
      '--no-wait',
      '--set',
      'design.frequency_mhz=500',
      '--set',
      'place.density=0.63',
    ])
  })
})

describe('ECC CLI workspace refresh legacy RTL recovery', () => {
  async function serviceWithLegacyWorkspace() {
    const root = await mkdtemp(join(tmpdir(), 'ecc-refresh-recovery-'))
    temporaryDirectories.push(root)
    const workspace = join(root, 'ws_1')
    await mkdir(join(workspace, 'origin'), { recursive: true })
    await writeFile(join(workspace, 'origin', 'gcd.v'), 'module gcd(); endmodule')
    await writeFile(join(workspace, 'origin', 'gcd.sdc'), 'create_clock')
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    ;(service as any).sessions.set('handle-1', {
      directory: workspace,
      handle: 'handle-1',
      projectRoot: root,
      workspaceId: 'ws_1',
      workspaceRevision: 36,
    })
    vi.spyOn(
      await import('./engineeringSnapshotReader'),
      'readPersistedEngineeringSnapshot',
    ).mockResolvedValue({ workspaceRevision: 37 } as never)
    return { root, workspace, service }
  }

  const MISSING_RTL_ERROR = () =>
    new EccCliCommandError(
      1,
      'kind=error error=step_input_missing step_input_missing: Synthesis requires design.rtl',
      '',
    )

  it('imports workspace origin RTL into the project and retries the refresh', async () => {
    const { root, workspace, service } = await serviceWithLegacyWorkspace()
    let refreshAttempts = 0
    const run = vi
      .spyOn(EccCliProcess.prototype, 'run')
      .mockImplementation(async (args) => {
        if (args[0] === 'workspace' && args[1] === 'refresh') {
          refreshAttempts += 1
          if (refreshAttempts === 1) throw MISSING_RTL_ERROR()
        }
        return { exitCode: 0, stderr: '', stdout: '' }
      })

    await expect(
      service.refreshConfig({ workspaceHandle: 'handle-1' }),
    ).resolves.toMatchObject({
      directory: workspace,
      refreshed: true,
      workspaceRevision: 37,
    })
    expect(refreshAttempts).toBe(2)
    expect(run).toHaveBeenCalledWith(
      [
        'rtl',
        'import',
        '--project',
        root,
        '--verilog',
        join(workspace, 'origin', 'gcd.v'),
        '--plain',
      ],
      { cwd: root },
    )
  })

  it('surfaces unrelated refresh failures without importing RTL', async () => {
    const { service } = await serviceWithLegacyWorkspace()
    const run = vi.spyOn(EccCliProcess.prototype, 'run').mockImplementation(async () => {
      throw new EccCliCommandError(1, 'kind=error error=derived_configs_modified', '')
    })

    await expect(service.refreshConfig({ workspaceHandle: 'handle-1' })).rejects.toThrow(
      'derived_configs_modified',
    )
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls.some((call) => call[0][0] === 'rtl')).toBe(false)
  })

  it('keeps the original failure when the workspace has no origin RTL', async () => {
    const { workspace, service } = await serviceWithLegacyWorkspace()
    const { rm } = await import('node:fs/promises')
    await rm(join(workspace, 'origin', 'gcd.v'), { force: true })
    const run = vi.spyOn(EccCliProcess.prototype, 'run').mockImplementation(async () => {
      throw MISSING_RTL_ERROR()
    })

    await expect(service.refreshConfig({ workspaceHandle: 'handle-1' })).rejects.toThrow(
      'requires design.rtl',
    )
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('ECC CLI Workspace parameter projection', () => {
  it('reads legacy flat Snapshot values through the catalog mapping', () => {
    expect(
      workspaceParameterValue(
        { frequency_max: 125 },
        {
          backendMapping: 'frequency_max',
          default: 100,
          display_key: 'frequency_max',
          id: 'design.frequency_mhz',
        },
      ),
    ).toBe(125)
  })

  it('reads nested Snapshot values through object mappings', () => {
    expect(
      workspaceParameterValue(
        { core: { utilitization: 0.63 } },
        {
          backendMapping: { core: 'utilitization' },
          default: 0.4,
          id: 'floorplan.core_util',
        },
      ),
    ).toBe(0.63)
  })
})

describe('ECC CLI run registration handshake', () => {
  const entry = {
    run_id: 'run-1',
    runtime_id: 'runtime-1',
    pid: 222,
  } as import('@ecos-studio/shared').ProjectRuntimeProcessEntry

  it('accepts the registered ECC child when a launcher owns a different PID', () => {
    expect(registeredRunMatches(entry, 'run-1', 'runtime-1')).toBe(true)
  })

  it('rejects entries from another run or runtime', () => {
    expect(registeredRunMatches(entry, 'run-2', 'runtime-1')).toBe(false)
    expect(registeredRunMatches(entry, 'run-1', 'runtime-2')).toBe(false)
  })
})

describe('ECC CLI live flow projection', () => {
  const flow = {
    steps: [
      {
        name: 'Synthesis',
        peakMemory: 68.3,
        runtime: '0:0:19',
        state: 'Success',
        tool: 'yosys',
      },
      {
        name: 'place',
        peakMemory: 0,
        runtime: '',
        state: 'Ongoing',
        tool: 'dreamplace',
      },
    ],
  }

  it('does not invalidate an unchanged parsed flow', () => {
    expect(operationFlowMatches(flow, flow)).toBe(true)
  })

  it('detects step state and runtime changes', () => {
    expect(
      operationFlowMatches(flow, {
        steps: flow.steps.map((step) =>
          step.name === 'place'
            ? { ...step, peakMemory: 190.2, runtime: '0:0:48', state: 'Success' }
            : step,
        ),
      }),
    ).toBe(false)
  })

  it('refreshes after watcher readiness and through process polling fallback', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ecc-runtime-live-flow-'))
    temporaryDirectories.push(projectRoot)
    const workspaceDirectory = join(projectRoot, 'ws_1')
    await mkdir(join(workspaceDirectory, 'home'), { recursive: true })
    const runId = '11111111-1111-4111-8111-111111111111'
    const now = '2026-09-28T00:00:00.000Z'
    await writeFile(
      join(projectRoot, 'project.json'),
      JSON.stringify({
        schema_version: 1,
        project_id: 'project-1',
        name: 'Demo',
        design_name: 'gcd',
        description: '',
        root_path: projectRoot,
        created_at: now,
        updated_at: now,
        base_design: {},
        objectives: { primary: '', directions: {} },
        workspaces: [
          {
            workspace_id: 'ws_1',
            name: 'ws_1',
            workspace_path: workspaceDirectory,
            source_workspace_id: null,
            branch_from: null,
            start_step: 'Synth',
            end_step: 'Harden',
            status: 'running',
            created_at: now,
            updated_at: now,
            parameter_patch: {},
          },
        ],
        mpc: null,
        best_workspace: null,
        qor_baseline: null,
        runtime_processes: {
          ws_1: {
            schema_version: 1,
            run_id: runId,
            pid: 1234,
            pgid: 1234,
            process_start_id: 'start-1',
            boot_id: 'boot-1',
            host_id: 'host-1',
            workspace_path: workspaceDirectory,
            started_at: 1,
            runtime_id: 'runtime-1',
            log_path: `log/${runId}.log`,
          },
        },
      }),
    )
    const writeFlow = (steps: unknown[]) =>
      writeFile(
        join(workspaceDirectory, 'home', 'flow.json'),
        JSON.stringify({ schema_version: 1, steps }),
      )
    await writeFlow([
      {
        name: 'Synthesis',
        state: 'Ongoing',
        tool: 'yosys',
        runtime: '',
        'peak memory (mb)': 64,
      },
    ])
    vi.spyOn(EccCliProcess.prototype, 'run').mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: '',
    })
    const service = new EccCliRuntimeService({
      resolveLaunch: vi.fn(),
      runtimeId: 'runtime-1',
    })
    const session = {
      directory: workspaceDirectory,
      handle: 'handle-1',
      projectRoot,
      workspaceId: 'ws_1',
      workspaceRevision: 1,
    }

    await (service as any).restoreRegisteredOperation(
      session,
      await readProjectManifest(projectRoot),
    )
    expect(service.operationProjection().operations).toEqual([
      expect.objectContaining({
        currentStep: 'Synthesis',
        flow: {
          steps: [
            expect.objectContaining({
              name: 'Synthesis',
              peakMemory: 64,
              state: 'Ongoing',
            }),
          ],
        },
      }),
    ])

    const tracked = (service as any).operations.get(runId)
    await tracked.watcher.close()
    tracked.watcher = null
    await writeFlow([
      {
        name: 'Synthesis',
        state: 'Success',
        tool: 'yosys',
        runtime: '00:00:03',
        'peak memory (mb)': 68,
      },
      {
        name: 'place',
        state: 'Ongoing',
        tool: 'dreamplace',
        runtime: '',
        'peak memory (mb)': 120,
      },
    ])

    await (service as any).inspectTrackedProcess(tracked)
    expect(service.operationProjection().operations).toEqual([
      expect.objectContaining({
        currentStep: 'place',
        flow: {
          steps: [
            expect.objectContaining({ name: 'Synthesis', state: 'Success' }),
            expect.objectContaining({
              name: 'place',
              peakMemory: 120,
              state: 'Ongoing',
            }),
          ],
        },
      }),
    ])
    await service.shutdown()
  })
})

describe('ECC CLI Workspace discovery', () => {
  it('treats a legacy path moved during migration as no direct match', async () => {
    const project = await mkdtemp(join(tmpdir(), 'ecc-runtime-project-'))
    temporaryDirectories.push(project)
    const manifest = {
      workspaces: [
        {
          workspace_id: 'ws_migrated',
          workspace_path: join(project, 'ws_migrated'),
        },
      ],
    } as unknown as import('@ecos-studio/shared').ProjectManifest

    await expect(
      declaredWorkspaceForDirectory(manifest, join(project, 'runs', 'ws_migrated')),
    ).resolves.toBeNull()
  })

  it('accepts the exact external Workspace path declared by the Project manifest', async () => {
    const project = await mkdtemp(join(tmpdir(), 'ecc-runtime-project-'))
    const externalWorkspace = await mkdtemp(join(tmpdir(), 'ecc-runtime-external-'))
    temporaryDirectories.push(project, externalWorkspace)
    const manifest = {
      workspaces: [
        {
          workspace_id: 'ws_external',
          workspace_path: externalWorkspace,
        },
      ],
    } as unknown as import('@ecos-studio/shared').ProjectManifest

    await expect(
      declaredWorkspaceForDirectory(manifest, externalWorkspace),
    ).resolves.toMatchObject({
      directory: externalWorkspace,
      entry: { workspace_id: 'ws_external' },
    })
    await expect(declaredWorkspaceForDirectory(manifest, project)).resolves.toBeNull()
  })
})
