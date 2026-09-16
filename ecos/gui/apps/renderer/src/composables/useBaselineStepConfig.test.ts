import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StepEnum } from '@/api/type'
import { projectManifestForPresentation } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ designTool?: string; path: string } | null> | null,
  readManifest: vi.fn(),
  readWorkspaceStepConfiguration: vi.fn(),
  route: { query: { projectRoot: '/projects/gcd' } as Record<string, unknown> },
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: testState.currentProject }),
}))
vi.mock('vue-router', () => ({ useRoute: () => testState.route }))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    projectManagement: {
      readManifest: testState.readManifest,
      readWorkspaceStepConfiguration: testState.readWorkspaceStepConfiguration,
    },
  }),
}))
vi.mock('@/utils/projectManifestRegistration', () => ({
  resolveProjectRouteContextForWorkspace: vi.fn().mockResolvedValue(null),
}))

import {
  clearBaselineStepConfigCache,
  useBaselineStepConfig,
} from './useBaselineStepConfig'

function projectManifest() {
  const now = '2026-08-04T00:00:00.000Z'
  return projectManifestForPresentation(
    {
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      description: '',
      root_path: '/projects/gcd',
      created_at: now,
      updated_at: now,
      base_design: { pdk: 'ics55', top_module: 'gcd_top', parameters: {} },
      objectives: { primary: 'timing', directions: {} },
      workspaces: ['ws_0001', 'ws_0004'].map((workspaceId) => ({
        workspace_id: workspaceId,
        name: workspaceId,
        workspace_path: workspaceId,
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'Harden',
        status: 'not_started' as const,
        created_at: now,
        updated_at: now,
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      })),
      mpc: null,
      best_workspace: null,
      qor_baseline: { workspace_id: 'ws_0001', reason: 'selected' },
    },
    '/projects/gcd',
  )
}

describe('useBaselineStepConfig', () => {
  let scope: EffectScope
  let step: Ref<StepEnum | undefined>

  beforeEach(() => {
    clearBaselineStepConfigCache()
    scope = effectScope()
    step = ref(StepEnum.CTS)
    testState.currentProject = ref({
      designTool: 'backend',
      path: '/projects/gcd/ws_0004',
    })
    testState.readManifest.mockReset().mockResolvedValue(projectManifest())
    testState.readWorkspaceStepConfiguration.mockReset().mockResolvedValue({
      parameters: [
        {
          applies: 'cts',
          default: ['BUF'],
          description: 'CTS buffers',
          param: 'cts.buffer_type',
          type: 'json',
          value: ['BUF'],
        },
      ],
      status: 'available',
      step: 'CTS',
      stepId: 'CTS',
      workspaceId: 'engineering-workspace-1',
      workspaceRevision: 1,
    })
  })

  afterEach(() => {
    scope.stop()
    clearBaselineStepConfigCache()
  })

  it('reads baseline parameters through the ECC domain API', async () => {
    const baseline = scope.run(() => useBaselineStepConfig(step))!

    await vi.waitFor(() => expect(baseline.status.value).toBe('available'))

    expect(testState.readWorkspaceStepConfiguration).toHaveBeenCalledWith({
      projectRoot: '/projects/gcd',
      step: 'CTS',
      workspacePath: '/projects/gcd/ws_0001',
    })
    expect(baseline.parsed.value).toEqual({ 'cts.buffer_type': ['BUF'] })
    expect(baseline.workspaceRevision.value).toBe(1)
  })

  it('does not request ECC options for a frontend workspace', async () => {
    testState.currentProject = ref({
      designTool: 'frontend',
      path: '/projects/gcd/ws_0004',
    })
    const baseline = scope.run(() => useBaselineStepConfig(step))!

    await vi.waitFor(() => expect(baseline.status.value).toBe('no-config-for-step'))
    expect(baseline.noConfigReason.value).toBe('frontend')
    expect(testState.readWorkspaceStepConfiguration).not.toHaveBeenCalled()
  })

  it('reports no project without an open workspace', async () => {
    testState.currentProject = ref(null)
    const baseline = scope.run(() => useBaselineStepConfig(step))!

    await vi.waitFor(() => expect(baseline.status.value).toBe('no-project'))
  })
})
