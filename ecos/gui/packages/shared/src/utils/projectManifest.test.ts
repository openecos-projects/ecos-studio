import { describe, expect, it } from 'vitest'
import {
  isProjectRuntimeProcessEntry,
  normalizeProjectManifestFlowStep,
  parseProjectManifestFlowStep,
  projectManifestForPresentation,
  projectManifestFlowSteps,
  sameProjectManifestFlowStep,
  type ProjectManifest,
} from './projectManifest'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
} from './frontendProjectManifest'

const NOW = '2026-07-01T00:00:00.000Z'

function backendManifestWithArchivedBackup(): ProjectManifest {
  return projectManifestForPresentation(
    {
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      description: '',
      root_path: '/work/gcd',
      created_at: NOW,
      updated_at: NOW,
      base_design: { pdk: 'ics55', top_module: 'gcd_top', parameters: {} },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [
        {
          workspace_id: 'ws_0001',
          name: 'ws_0001',
          workspace_path: 'ws_0001',
          source_workspace_id: null,
          branch_from: null,
          start_step: 'Synth',
          end_step: 'Harden',
          status: 'not_started',
          created_at: NOW,
          updated_at: NOW,
          parameter_patch: {},
          metrics_summary: {},
          step_metrics: {},
        },
        {
          workspace_id: '.ws_0001.replace-backup-1',
          name: '.ws_0001.replace-backup-1 backup',
          workspace_path: '.ws_0001.replace-backup-1',
          source_workspace_id: 'ws_0001',
          branch_from: null,
          start_step: 'Synth',
          end_step: 'Harden',
          status: 'archived',
          created_at: NOW,
          updated_at: NOW,
          parameter_patch: {},
          metrics_summary: {},
          step_metrics: {},
        },
      ],
      mpc: null,
      best_workspace: null,
      qor_baseline: { workspace_id: 'ws_0001', reason: 'Default project QoR baseline' },
    },
    '/work/gcd',
  )
}

describe('project manifest presentation', () => {
  it('validates the durable ECC process identity contract', () => {
    const entry = {
      schema_version: 1 as const,
      run_id: '7ed8d4bb-7b54-4c37-8aa3-d1a2fed9a4ee',
      pid: 18241,
      pgid: 18241,
      process_start_id: '987654321',
      boot_id: 'boot-id',
      host_id: 'host-id',
      workspace_path: 'runs/ws_0001',
      started_at: 1_710_000_000,
      runtime_id: 'ecc-linux-x86_64-1.8.0+17',
      log_path: 'log/7ed8d4bb-7b54-4c37-8aa3-d1a2fed9a4ee.log',
    }
    expect(isProjectRuntimeProcessEntry(entry)).toBe(true)
    expect(isProjectRuntimeProcessEntry({ ...entry, pgid: 1 })).toBe(false)
    expect(isProjectRuntimeProcessEntry({ ...entry, workspace_path: '../escape' })).toBe(
      false,
    )
    expect(
      isProjectRuntimeProcessEntry({ ...entry, log_path: 'home/run-logs/other.log' }),
    ).toBe(false)
  })

  it('keeps the canonical flow order and legacy display aliases', () => {
    expect(projectManifestFlowSteps).toEqual([
      'Synth',
      'LEC',
      'Floor',
      'Place',
      'CTS',
      'Legal',
      'Timing Opt',
      'Route',
      'Filler',
      'RCX',
      'STA',
      'Power Analysis',
      'LVS',
      'Post-route LEC',
      'DRC',
      'Harden',
    ])
    expect(normalizeProjectManifestFlowStep('lvs')).toBe('LVS')
    expect(parseProjectManifestFlowStep('routing')).toBe('Route')
    expect(parseProjectManifestFlowStep('lec')).toBe('LEC')
    expect(parseProjectManifestFlowStep('postRouteLec')).toBe('Post-route LEC')
    expect(parseProjectManifestFlowStep('post_route_lec')).toBe('Post-route LEC')
    expect(parseProjectManifestFlowStep('timing-optimization')).toBe('Timing Opt')
    expect(parseProjectManifestFlowStep('powerAnalysis')).toBe('Power Analysis')
    expect(parseProjectManifestFlowStep('power-analysis')).toBe('Power Analysis')
    expect(parseProjectManifestFlowStep('fixFanout')).toBeNull()
    expect(parseProjectManifestFlowStep('future-step')).toBeNull()
    expect(sameProjectManifestFlowStep('placement', 'place')).toBe(true)
    expect(sameProjectManifestFlowStep('routing', 'route')).toBe(true)
    expect(sameProjectManifestFlowStep('Synthesis', 'Synth')).toBe(true)
    expect(sameProjectManifestFlowStep('floorplan', 'Floor')).toBe(true)
    expect(sameProjectManifestFlowStep('preFloorplan', 'Floor')).toBe(true)
    expect(sameProjectManifestFlowStep('macroPlacement', 'Floor')).toBe(true)
    expect(sameProjectManifestFlowStep('postFloorplan', 'Floor')).toBe(true)
    expect(sameProjectManifestFlowStep('placement', 'route')).toBe(false)
    expect(sameProjectManifestFlowStep('all', 'Synthesis')).toBe(false)
  })

  it('projects the portable ECC manifest for existing Studio consumers', () => {
    const parsed = projectManifestForPresentation(
      {
        schema_version: 1,
        project_id: 'proj_gcd',
        name: 'gcd',
        design_name: 'gcd',
        description: '',
        root_path: '/work/gcd',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        base_design: { pdk: 'ics55', top_module: 'gcd_top', parameters: {} },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [
          {
            workspace_id: 'baseline',
            name: 'Baseline',
            workspace_path: 'runs/default',
            source_workspace_id: null,
            branch_from: null,
            start_step: 'Synth',
            end_step: 'Harden',
            status: 'archived',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
            parameter_patch: {},
            metrics_summary: {},
            step_metrics: {},
          },
        ],
        mpc: {
          resource_id: 'mpc:frame',
          display_name: 'Frame',
          installed_version: '1.0.0',
          path: '/resources/frame',
          spec_path: '/resources/frame/spec.json',
          design: { index: 0, design_name: 'gcd' },
          core_template: {},
        },
        best_workspace: null,
        qor_baseline: null,
      },
      '/work/gcd',
    )

    expect(parsed.root_path).toBe('/work/gcd')
    expect(parsed.workspaces[0]).toMatchObject({
      workspace_id: 'baseline',
      workspace_path: '/work/gcd/runs/default',
      status: 'archived',
    })
    expect(parsed.mpc).toMatchObject({
      resource_id: 'mpc:frame',
      installed_version: '1.0.0',
      design: { design_name: 'gcd' },
    })
  })
})

describe('QoR baseline mutation with archived entries', () => {
  it('accepts an archived entry as the QoR baseline', () => {
    const manifest = backendManifestWithArchivedBackup()

    const updated = setQorBaselineInManifest(manifest, '.ws_0001.replace-backup-1')

    expect(updated.qor_baseline).toEqual({
      workspace_id: '.ws_0001.replace-backup-1',
      reason: 'Selected from Project QoR Trend',
    })
  })

  it('still rejects unknown workspace ids and non-backend projects', () => {
    const manifest = backendManifestWithArchivedBackup()

    expect(setQorBaselineInManifest(manifest, 'ws_missing')).toBe(manifest)

    const frontend = createProjectManifestDraft({
      rootPath: '/work/cpu',
      name: 'cpu',
      designName: 'cpu',
      projectType: 'frontend',
    })
    expect(setQorBaselineInManifest(frontend, 'ws_0001')).toBe(frontend)
  })

  it('keeps a baseline pointing at an archived backup across later mutations', () => {
    const manifest = {
      ...backendManifestWithArchivedBackup(),
      qor_baseline: {
        workspace_id: '.ws_0001.replace-backup-1',
        reason: 'Default project QoR baseline',
      },
    }

    // A repointed baseline (generation replacement followed the archived
    // backup) survives subsequent workspace registrations instead of being
    // re-resolved to the first active workspace.
    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot: '/work/gcd',
      workspacePath: '/work/gcd/ws_0002',
    })

    expect(updated.qor_baseline).toEqual({
      workspace_id: '.ws_0001.replace-backup-1',
      reason: 'Default project QoR baseline',
    })
  })
})
