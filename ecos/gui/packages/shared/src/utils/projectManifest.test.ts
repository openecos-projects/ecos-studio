import { describe, expect, it } from 'vitest'
import {
  normalizeProjectManifestFlowStep,
  parseProjectManifestFlowStep,
  projectManifestForPresentation,
  projectManifestFlowSteps,
} from './projectManifest'

describe('project manifest presentation', () => {
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
    expect(parseProjectManifestFlowStep('fixFanout')).toBeNull()
    expect(parseProjectManifestFlowStep('future-step')).toBeNull()
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
