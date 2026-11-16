import { afterEach, expect, it, vi } from 'vitest'
import { EccCliProcess } from './cliProcess'
import { EccCliRuntimeService } from './runtimeService'

afterEach(() => vi.restoreAllMocks())

it.each([1, undefined])(
  'discovers workspace execution capability %s through ECC CLI',
  async (capability) => {
    vi.spyOn(EccCliProcess.prototype, 'run').mockImplementation(async (args) => ({
      exitCode: 0,
      stderr: '',
      stdout:
        args[0] === 'version'
          ? JSON.stringify({
              schema_version: 2,
              runtime: 'ECC CLI',
              cli_contract: 1,
              workspace_execution_config: capability,
            })
          : '',
    }))
    const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
    expect((await service.describeWorkspaceSpec()).workspaceExecutionConfig).toBe(
      capability === 1,
    )
  },
)

it('rejects an explicit execution choice on an old runtime before creating a project', async () => {
  const run = vi.spyOn(EccCliProcess.prototype, 'run').mockResolvedValue({
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({ schema_version: 2, runtime: 'ECC CLI', cli_contract: 1 }),
  })
  const service = new EccCliRuntimeService({ resolveLaunch: vi.fn() })
  await expect(
    service.createWorkspace({
      commandId: 'create',
      targetDirectory: '/work/demo/ws',
      projectRoot: '/work/demo',
      workspaceBindings: {},
      workspaceSpec: { flow: { stepSubprocess: false } },
    }),
  ).rejects.toThrow('Update ECC')
  expect(run.mock.calls.map(([args]) => args)).toEqual([['version', '--json']])
})
