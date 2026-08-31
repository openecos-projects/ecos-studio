import type { WorkspaceResourceIndex, WorkspaceStepResource } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { workspaceDashboardMetrics } from './workspaceDashboardAnalysis'

function step(
  name: string,
  state: string,
  feature: WorkspaceStepResource['resources']['feature'],
): WorkspaceStepResource {
  return {
    name,
    state,
    tool: 'ecc',
    runtime: '',
    directory: `/workspace/${name}`,
    info: {},
    resources: {
      analysis: {},
      checklist: {},
      config: {},
      data: {},
      feature,
      log: {},
      output: {},
      report: {},
      script: {},
      subflow: {},
    },
  }
}

function index(steps: WorkspaceStepResource[]): WorkspaceResourceIndex {
  const file = (kind: 'checklist' | 'flow' | 'home' | 'parameters') => ({
    exists: true,
    kind,
    path: `/workspace/home/${kind}.json`,
  })
  return {
    design: 'gcd',
    flow: { steps },
    home: {
      checklistJson: file('checklist'),
      flowJson: file('flow'),
      homeJson: file('home'),
      parametersJson: file('parameters'),
    },
    homeData: {},
    messages: [],
    parameters: {},
    pdk: 'ics55',
    root: '/workspace',
    status: 'available',
    topModule: 'gcd',
  }
}

describe('workspaceDashboardMetrics', () => {
  it('combines normalized QoR with the latest successful DB feature', async () => {
    const readText = vi.fn(async () =>
      JSON.stringify({
        'Design Statis': { num_instances: 423, num_iopins: 54, num_nets: 322 },
        Instances: {
          iopads: { num: 0 },
          logic: { area: 709, num: 286 },
          macros: { area: 0, num: 0 },
        },
      }),
    )
    const metrics = await workspaceDashboardMetrics(
      index([
        step('place', 'Success', {
          db: {
            exists: true,
            kind: 'analysis',
            path: '/workspace/place/feature/place.db.json',
          },
        }),
      ]),
      [
        {
          id: 'die_area',
          name: 'Die Area',
          polarity: 'trend_only',
          stepId: 'Place',
          unit: 'um2',
          value: 2798.4,
        },
      ],
      readText,
    )

    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'die-area', value: 2798.4 }),
        expect.objectContaining({ id: 'instances', value: 423 }),
        expect.objectContaining({ id: 'std-cell-number', value: 286 }),
      ]),
    )
  })

  it('falls back to the preceding successful step feature when the latest DB is missing', async () => {
    const readText = vi.fn(async (path: string) =>
      path.endsWith('route.step.json')
        ? JSON.stringify({ route: { instance_cnt: 432, net_cnt: 777, total_pins: 54 } })
        : null,
    )
    const metrics = await workspaceDashboardMetrics(
      index([
        step('route', 'Success', {
          step: {
            exists: true,
            kind: 'analysis',
            path: '/workspace/route/feature/route.step.json',
          },
        }),
        step('sta', 'Success', {
          db: {
            exists: false,
            kind: 'analysis',
            path: '/workspace/sta/feature/sta.db.json',
          },
        }),
      ]),
      [],
      readText,
    )

    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'instances', value: 432 }),
        expect.objectContaining({ id: 'nets', value: 777 }),
      ]),
    )
  })
})
