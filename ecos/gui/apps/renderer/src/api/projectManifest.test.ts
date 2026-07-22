import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectManifestMutation } from '@ecos-studio/shared'

const mutate = vi.fn()

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: vi.fn(async () => ({
    projectManifest: {
      mutate,
    },
  })),
}))

vi.mock('@/utils/projectManagement', () => ({
  parseProjectManifest: vi.fn((content: string) => JSON.parse(content)),
}))

describe('mutateProjectManifest', () => {
  beforeEach(() => {
    mutate.mockReset()
    mutate.mockResolvedValue({
      content: JSON.stringify({
        schema_version: 1,
        project_id: 'proj_demo',
        name: 'demo',
        root_path: '/projects/demo',
        created_at: '2026-07-17T00:00:00.000Z',
        updated_at: '2026-07-17T00:00:00.000Z',
        base_design: { rtl_list: [], parameters: {} },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [],
        best_workspace: null,
      }),
    })
  })

  it('serializes reactive-like config payloads before desktop IPC', async () => {
    const { mutateProjectManifest } = await import('./projectManifest')
    const reactiveParameters = new Proxy(
      { design: 'gcd', top_module: 'gcd' },
      {
        get(target, property, receiver) {
          return Reflect.get(target, property, receiver)
        },
      },
    )
    const mutation: ProjectManifestMutation = {
      type: 'register-workspace',
      input: {
        projectRoot: '/projects/demo',
        workspacePath: '/projects/demo/ws_0001',
        config: {
          pdk: 'ics55',
          pdk_root: '/pdk/ics55',
          origin_def: '',
          origin_verilog: '',
          rtl_list: [],
          parameters: reactiveParameters,
        },
      },
    }

    expect(() => structuredClone(mutation)).toThrow('could not be cloned')

    await mutateProjectManifest('/projects/demo', mutation)

    expect(mutate).toHaveBeenCalledWith({
      projectRoot: '/projects/demo',
      mutation: {
        type: 'register-workspace',
        input: expect.objectContaining({
          workspacePath: '/projects/demo/ws_0001',
          config: expect.objectContaining({
            parameters: { design: 'gcd', top_module: 'gcd' },
          }),
        }),
      },
    })
    expect(() => structuredClone(mutate.mock.calls[0]?.[0])).not.toThrow()
  })
})
