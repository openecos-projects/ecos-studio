import { describe, expect, it } from 'vitest'
import {
  BEST_WORKSPACE_PPA_METRIC_ORDER,
  DASHBOARD_METRIC_ORDER,
  buildBestWorkspacePpaMetrics,
  buildDashboardMetricRows,
  buildDashboardWorkspaceMetricRows,
  buildRunStatePieBackground,
  findBestFrequencyWorkspace,
  metricInlineWidth,
  metricPointForWorkspace,
  metricValueClass,
  pendingMetricPoint,
  runStateSliceClass,
} from './projectAnalysisPresentation'
import type {
  ProjectFlowMetricSummary,
  ProjectMetricPoint,
  ProjectMetricRow,
} from '@/utils/projectManagement'

function point(
  workspaceId: string,
  value: number | null,
  label = value === null ? 'N/A' : String(value),
): ProjectMetricPoint {
  return {
    workspaceId,
    value,
    label,
    state: value === null ? 'pending' : 'good',
  }
}

function metric(
  id: ProjectMetricRow['id'],
  label: string,
  points: ProjectMetricPoint[],
): ProjectMetricRow {
  return {
    id,
    label,
    hint: `${label} hint`,
    kind: 'bar',
    points,
  }
}

const flowMetricSummary: Pick<
  ProjectFlowMetricSummary,
  'runtimePoints' | 'memoryPoints'
> = {
  runtimePoints: [point('ws_a', 32, '32 s'), point('ws_b', 48, '48 s')],
  memoryPoints: [point('ws_a', 128, '128 MB'), point('ws_b', 256, '256 MB')],
}

describe('project analysis presentation', () => {
  it('builds dashboard metrics in the intended chip order, then runtime and memory', () => {
    const rows = buildDashboardMetricRows(
      [
        metric('drc', 'DRC', [point('ws_a', 0)]),
        metric('wns', 'WNS', [point('ws_a', 0.12)]),
        metric('frequency', 'Frequency [MHz]', [point('ws_a', 125)]),
        metric('die_area', 'Die Area', [point('ws_a', 820)]),
        metric('core_util', 'Core Util', [point('ws_a', 0.7)]),
        metric('area', 'Area', [point('ws_a', 600)]),
      ],
      flowMetricSummary,
    )

    expect(DASHBOARD_METRIC_ORDER).toEqual([
      'die_area',
      'core_util',
      'frequency',
      'wns',
      'tns',
      'drc',
    ])
    expect(rows.map((row) => row.id)).toEqual([
      'die_area',
      'core_util',
      'frequency',
      'wns',
      'drc',
      'runtime',
      'memory',
    ])
    expect(rows[rows.length - 2]?.points).toEqual(flowMetricSummary.runtimePoints)
    expect(rows[rows.length - 1]?.points).toEqual(flowMetricSummary.memoryPoints)
  })

  it('fills dashboard workspace rows with a pending metric point when data is absent', () => {
    const rows = buildDashboardWorkspaceMetricRows(
      [{ id: 'ws_a' }, { id: 'ws_b' }],
      [metric('frequency', 'Frequency [MHz]', [point('ws_a', 125)])],
    )

    expect(rows).toEqual([
      {
        workspaceId: 'ws_a',
        cells: [
          {
            metric: expect.objectContaining({ id: 'frequency' }),
            point: point('ws_a', 125),
          },
        ],
      },
      {
        workspaceId: 'ws_b',
        cells: [
          {
            metric: expect.objectContaining({ id: 'frequency' }),
            point: pendingMetricPoint('ws_b'),
          },
        ],
      },
    ])
    expect(metricPointForWorkspace({ points: [] }, 'ws_missing')).toEqual(
      pendingMetricPoint('ws_missing'),
    )
  })

  it('selects the best frequency workspace and summarizes its PPA metrics', () => {
    const rows = [
      metric('core_util', 'Core Util', [point('ws_fast', 0.72, '72%')]),
      metric('drc', 'DRC', [point('ws_fast', 0, '0')]),
      metric('frequency', 'Frequency [MHz]', [
        point('ws_slow', 100, '100 MHz'),
        point('ws_fast', 150, '150 MHz'),
        point('ws_pending', null),
      ]),
      metric('wns', 'WNS', [point('ws_fast', 0.08, '0.08 ns')]),
      metric('die_area', 'Die Area', [point('ws_fast', 820, '820 um2')]),
    ]

    const best = findBestFrequencyWorkspace(rows)

    expect(best).toMatchObject({ workspaceId: 'ws_fast', value: 150 })
    expect(BEST_WORKSPACE_PPA_METRIC_ORDER).toEqual([
      'frequency',
      'wns',
      'tns',
      'drc',
      'die_area',
      'core_util',
    ])
    expect(buildBestWorkspacePpaMetrics(rows, best?.workspaceId)).toEqual([
      {
        id: 'frequency',
        label: 'Frequency [MHz]',
        display: '150 MHz',
        state: 'good',
      },
      { id: 'wns', label: 'WNS', display: '0.08 ns', state: 'good' },
      { id: 'drc', label: 'DRC', display: '0', state: 'good' },
      { id: 'die_area', label: 'Die Area', display: '820 um2', state: 'good' },
      { id: 'core_util', label: 'Core Util', display: '72%', state: 'good' },
    ])
    expect(buildBestWorkspacePpaMetrics(rows, null)).toEqual([])
  })

  it('builds run-state pie backgrounds and metric display helpers', () => {
    expect(buildRunStatePieBackground([])).toBe(
      'conic-gradient(color-mix(in srgb, var(--text-secondary) 14%, transparent) 0deg 360deg)',
    )
    expect(
      buildRunStatePieBackground([
        { state: 'success', label: 'Success', count: 3, percent: 75 },
        { state: 'failed', label: 'Failed', count: 1, percent: 25 },
      ]),
    ).toBe(
      'conic-gradient(var(--success-color) 0deg 270deg, var(--danger-color) 270deg 360deg)',
    )
    expect(runStateSliceClass('running')).toBe('run-state-running')
    expect(metricValueClass('good')).toBe('metric-good')
    expect(metricValueClass('warn')).toBe('metric-warn')
    expect(metricValueClass('bad')).toBe('metric-bad')
    expect(metricValueClass('pending')).toBe('metric-pending')
    expect(metricInlineWidth(pendingMetricPoint('ws_a'))).toBe(28)
    expect(metricInlineWidth(point('ws_a', 0), [point('ws_a', 0)])).toBe(8)
    expect(
      metricInlineWidth(point('ws_a', -5), [point('ws_a', -5), point('ws_b', 10)]),
    ).toBe(50)
  })
})
