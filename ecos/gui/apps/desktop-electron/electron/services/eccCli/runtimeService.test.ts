import type { EccWorkspaceCreateRequest } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertEccCliPlatformSupported,
  projectInitArgs,
  projectManifestCreateArgs,
  projectSettingsArgs,
  workspaceCreateCommands,
  EccCliRuntimeService,
} from './runtimeService'

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
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
        filelist: '/inputs/files.f',
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
        { inputId: 'filelist', role: 'filelist' },
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
        'design.rtl=["/inputs/design.v","/inputs/files.f"]',
        'pdk.external_paths=["/macros"]',
        'pdk.overrides.lefs=["/macros/sram.lef"]',
      ]),
    )
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
      'design.rtl=["/inputs/design.v","/inputs/files.f"]',
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
