import { describe, expect, it } from 'vitest'
import type { ResourceInfo } from '@ecos-studio/shared'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createProjectManifestDraft,
  createSelectionState,
  archiveWorkspaceInManifest,
  deleteWorkspaceFromManifest,
  parseProjectManifest,
  projectMpcOptionFromResource,
  resolveProjectQorBaselineWorkspace,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
} from './projectManagement'
import type { Project } from '@/types'
import { trendSummaryFixture } from '@/components/projectStepAnalysis.fixture'

const project: Project = {
  id: '/projects/gcd',
  name: 'gcd',
  path: '/projects/gcd',
  lastOpened: new Date('2026-07-20T00:00:00Z'),
  status: 'success',
  totalSteps: 12,
  completedSteps: 12,
}

function managedMpc(overrides: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    id: 'mpc:mpc-frame',
    type: 'mpc',
    name: 'mpc-frame',
    display_name: 'MPC Frame',
    description: 'Multi-project chip frame template.',
    category: 'mpc',
    status: 'installed',
    installed_version: '0.1.0',
    available_versions: ['0.1.0'],
    active_version: null,
    active: false,
    path: '/resources/mpcs/mpc-frame/0.1.0',
    managed_root: '/resources/mpcs',
    platform: null,
    size: null,
    source: 'registry',
    homepage: 'https://github.com/openecos-projects/mpc-frame',
    actions: ['uninstall'],
    health: { managed: true, status: 'ok' },
    error: null,
    ...overrides,
  }
}

function manifestWithWorkspace(workspaceId = 'ws_0004') {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      designName: 'gcd',
      now: '2026-07-20T00:00:00.000Z',
    }),
    {
      projectRoot: '/projects/gcd',
      workspacePath: `/projects/gcd/${workspaceId}`,
      startStep: 'Synth',
      endStep: 'Harden',
      now: '2026-07-20T00:00:00.000Z',
    },
  )
}

describe('project management V3 model', () => {
  it('selects only healthy managed MPC resources and derives their spec path', () => {
    expect(projectMpcOptionFromResource(managedMpc())).toEqual({
      resource_id: 'mpc:mpc-frame',
      display_name: 'MPC Frame',
      installed_version: '0.1.0',
      path: '/resources/mpcs/mpc-frame/0.1.0',
      spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
    })
    expect(
      projectMpcOptionFromResource(
        managedMpc({ health: { managed: false, status: 'ok' } }),
      ),
    ).toBeNull()
    expect(
      projectMpcOptionFromResource(
        managedMpc({ status: 'available', installed_version: null, path: null }),
      ),
    ).toBeNull()
  })

  it('rejects an imported manifest whose MPC spec path is outside the MPC root', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      designName: 'gcd',
      mpc: {
        resource_id: 'mpc:mpc-frame',
        display_name: 'MPC Frame',
        installed_version: '0.1.0',
        path: '/resources/mpcs/mpc-frame/0.1.0',
        spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
        design: { index: 0, design_name: 'frame' },
        core_template: { minimum_area: 100, maximum_area: 500 },
      },
    })

    expect(parseProjectManifest(JSON.stringify(manifest)).mpc).toEqual(manifest.mpc)
    expect(() =>
      parseProjectManifest(
        JSON.stringify({
          ...manifest,
          mpc: {
            ...manifest.mpc,
            spec_path: '/tmp/spec.json.in',
          },
        }),
      ),
    ).toThrow('Invalid project manifest MPC spec_path.')
  })

  it('uses the fixed project flow step order', () => {
    expect(FLOW_STEPS).toEqual([
      'Synth',
      'Floor',
      'Fanout',
      'Place',
      'CTS',
      'Legal',
      'Route',
      'DRC',
      'LVS',
      'Filler',
      'RCX',
      'STA',
      'Harden',
    ])
  })

  it('builds an empty model without manufacturing metric rows', () => {
    const model = buildProjectManagementProject(project, null)
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
    expect(createSelectionState(model).selectedWorkspaceId).toBe('')
  })

  it('keeps backend comparison steps that are not part of the built-in flow', () => {
    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      {},
      {
        qorTrendSummary: trendSummaryFixture([{ workspaceId: 'ws_0004' }]),
        snapshots: [],
        stepComparisons: [
          {
            stepId: 'CustomSignoff',
            order: 13,
            name: 'CustomSignoff',
            workspaces: [{ workspaceId: 'ws_0004', status: 'success', metrics: [] }],
          },
        ],
        recommendation: null,
      },
    )

    expect(model.stepCompareSummaries).toEqual([
      expect.objectContaining({
        step: 'CustomSignoff',
        configuredCount: 1,
        successCount: 1,
      }),
    ])
  })

  it('keeps baseline selection as project metadata without manifest metrics', () => {
    const manifest = manifestWithWorkspace()
    const updated = setQorBaselineInManifest(manifest, 'ws_0004')
    expect(updated.qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Selected from Project QoR Trend',
    })
    expect(updated.workspaces[0]).not.toHaveProperty('metrics_summary')
    expect(updated.workspaces[0]).not.toHaveProperty('step_metrics')
  })

  it('resolves and persists the project-local default QoR baseline rule', () => {
    const first = manifestWithWorkspace('ws_0001')
    const manifest = registerWorkspaceInManifest(first, {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    })
    const legacyManifest = { ...manifest, qor_baseline: null }

    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0004')).toEqual({
      workspaceId: 'ws_0001',
      source: 'default',
    })
    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0001')).toEqual({
      workspaceId: 'ws_0004',
      source: 'default',
    })
    expect(
      resolveProjectQorBaselineWorkspace(manifestWithWorkspace(), 'ws_0004'),
    ).toEqual({
      workspaceId: 'ws_0004',
      source: 'selected',
    })
  })

  it('moves a removed QoR baseline to the first remaining available workspace', () => {
    const first = manifestWithWorkspace('ws_0001')
    const manifest = registerWorkspaceInManifest(first, {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    })

    expect(archiveWorkspaceInManifest(manifest, 'ws_0001').qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Default project QoR baseline',
    })
    expect(deleteWorkspaceFromManifest(manifest, 'ws_0001').qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Default project QoR baseline',
    })
  })
})
