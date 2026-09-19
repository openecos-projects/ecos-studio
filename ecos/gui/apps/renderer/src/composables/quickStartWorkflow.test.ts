import { describe, expect, it, vi } from 'vitest'
import {
  executeQuickStartWorkflow,
  parseQuickStartWorkflow,
  type QuickStartCapability,
} from './quickStartWorkflow'

const yaml = `
id: backend-gcd-quick-start
version: 1.0.0
schema_version: ecos.quick_start.workflow.v1
app_version:
  min: 0.1.0
  max: 1.0.0
steps:
  - id: preflight
    capability: preflight_resources
    bind: preflight
  - id: create-project
    capability: create_project
    depends_on: [preflight]
    when:
      binding: preflight
      path: ready
      equals: true
    inputs:
      name: gcd
      resource: { ref: design_resource }
    bind: project
`

describe('quick start workflow runtime', () => {
  it('parses and executes a trusted YAML workflow with typed bindings', async () => {
    const events: string[] = []
    const capabilities: Record<string, QuickStartCapability> = {
      preflight_resources: {
        projection: {
          detailKey: 'preflight.done',
          labelKey: 'preflight',
          surface: 'home',
        },
        run: vi.fn(() => ({ ready: true })),
      },
      create_project: {
        projection: {
          detailKey: 'project.done',
          labelKey: 'project.create',
          surface: 'project-management',
        },
        run: vi.fn(({ inputs }) => ({ id: 'project-1', name: inputs.name })),
      },
    }

    const result = await executeQuickStartWorkflow(yaml, capabilities, {
      appVersion: '0.1.0',
      bindings: { design_resource: { id: 'example:gcd' } },
      onEvent: (event) => events.push(`${event.stepId}:${event.status}`),
    })

    expect(result.bindings.project).toEqual({ id: 'project-1', name: 'gcd' })
    expect(capabilities.create_project.run).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: { name: 'gcd', resource: { id: 'example:gcd' } },
      }),
    )
    expect(events).toEqual([
      'preflight:pending',
      'preflight:running',
      'preflight:completed',
      'create-project:pending',
      'create-project:running',
      'create-project:completed',
    ])
  })

  it('rejects unknown capabilities before executing any step', () => {
    expect(() =>
      parseQuickStartWorkflow(
        yaml.replace('preflight_resources', 'run_shell'),
        {},
        '0.1.0',
      ),
    ).toThrow(/unknown capability/i)
  })

  it('rejects incompatible app versions before mutation', () => {
    expect(() => parseQuickStartWorkflow(yaml, {}, '2.0.0')).toThrow(
      /application version/i,
    )
  })

  it('accepts prerelease application versions', () => {
    const capability = {
      projection: { detailKey: 'detail', labelKey: 'label', surface: 'surface' },
      run: () => undefined,
    }
    expect(() =>
      parseQuickStartWorkflow(
        yaml,
        { create_project: capability, preflight_resources: capability },
        '0.1.0-alpha.8',
      ),
    ).not.toThrow()
  })

  it('skips a conditionally disabled step without emitting a fake completion', async () => {
    const events: string[] = []
    const capabilities: Record<string, QuickStartCapability> = {
      preflight_resources: {
        projection: {
          detailKey: 'preflight.done',
          labelKey: 'preflight',
          surface: 'home',
        },
        run: () => ({ ready: false }),
      },
      create_project: {
        projection: {
          detailKey: 'project.done',
          labelKey: 'project.create',
          surface: 'project-management',
        },
        run: vi.fn(),
      },
    }

    const result = await executeQuickStartWorkflow(yaml, capabilities, {
      appVersion: '0.1.0',
      bindings: { design_resource: {} },
      onEvent: (event) => events.push(`${event.stepId}:${event.status}`),
    })

    expect(result.bindings.project).toBeUndefined()
    expect(capabilities.create_project.run).not.toHaveBeenCalled()
    expect(events).toEqual([
      'preflight:pending',
      'preflight:running',
      'preflight:completed',
      'create-project:pending',
    ])
  })
})
