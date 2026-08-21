import { describe, expect, it } from 'vitest'
import {
  BEST_WORKSPACE_PPA_METRIC_ORDER,
  DASHBOARD_METRIC_ORDER,
  buildBestWorkspacePpaMetrics,
  buildDashboardMetricRows,
  initialMetricSortDirection,
  metricHasComparableData,
  metricPointForWorkspace,
  metricSortAriaValue,
  metricValueClass,
  nextMetricSortState,
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
    workspaceName: workspaceId,
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
        metric('lvs', 'LVS', [point('ws_a', 0)]),
        metric('wns', 'WNS', [point('ws_a', 0.12)]),
        metric('tns', 'TNS', [point('ws_a', 0)]),
        metric('hold_wns', 'Hold WNS', [point('ws_a', 0.08)]),
        metric('hold_tns', 'Hold TNS', [point('ws_a', 0)]),
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
      'hold_wns',
      'hold_tns',
      'drc',
      'lvs',
    ])
    expect(rows.map((row) => row.id)).toEqual([
      'die_area',
      'core_util',
      'frequency',
      'wns',
      'tns',
      'hold_wns',
      'hold_tns',
      'drc',
      'lvs',
      'runtime',
      'memory',
    ])
    expect(rows[rows.length - 2]?.points).toEqual(flowMetricSummary.runtimePoints)
    expect(rows[rows.length - 1]?.points).toEqual(flowMetricSummary.memoryPoints)
  })

  it('falls back to a pending point when a workspace has no value for a metric', () => {
    const frequency = metric('frequency', 'Frequency [MHz]', [point('ws_a', 125)])

    expect(metricPointForWorkspace(frequency, 'ws_a')).toEqual(point('ws_a', 125))
    expect(metricPointForWorkspace(frequency, 'ws_b')).toEqual(pendingMetricPoint('ws_b'))
    expect(metricPointForWorkspace({ points: [] }, 'ws_missing')).toEqual(
      pendingMetricPoint('ws_missing'),
    )
  })

  it('summarizes the PPA metrics of a chosen workspace in the intended order', () => {
    const rows = [
      metric('core_util', 'Core Util', [point('ws_fast', 0.72, '72%')]),
      metric('drc', 'DRC', [point('ws_fast', 0, '0')]),
      metric('lvs', 'LVS', [point('ws_fast', 0, '0')]),
      metric('frequency', 'Frequency [MHz]', [
        point('ws_slow', 100, '100 MHz'),
        point('ws_fast', 150, '150 MHz'),
        point('ws_pending', null),
      ]),
      metric('wns', 'WNS', [point('ws_fast', 0.08, '0.08 ns')]),
      metric('tns', 'TNS', [point('ws_fast', 0, '0 ns')]),
      metric('hold_wns', 'Hold WNS', [point('ws_fast', 0.03, '0.03 ns')]),
      metric('hold_tns', 'Hold TNS', [point('ws_fast', 0, '0 ns')]),
      metric('die_area', 'Die Area', [point('ws_fast', 820, '820 um2')]),
    ]

    expect(BEST_WORKSPACE_PPA_METRIC_ORDER).toEqual([
      'frequency',
      'wns',
      'tns',
      'hold_wns',
      'hold_tns',
      'drc',
      'lvs',
      'die_area',
      'core_util',
    ])
    expect(buildBestWorkspacePpaMetrics(rows, 'ws_fast')).toEqual([
      {
        id: 'frequency',
        label: 'Frequency [MHz]',
        display: '150 MHz',
        state: 'good',
      },
      { id: 'wns', label: 'WNS', display: '0.08 ns', state: 'good' },
      { id: 'tns', label: 'TNS', display: '0 ns', state: 'good' },
      { id: 'hold_wns', label: 'Hold WNS', display: '0.03 ns', state: 'good' },
      { id: 'hold_tns', label: 'Hold TNS', display: '0 ns', state: 'good' },
      { id: 'drc', label: 'DRC', display: '0', state: 'good' },
      { id: 'lvs', label: 'LVS', display: '0', state: 'good' },
      { id: 'die_area', label: 'Die Area', display: '820 um2', state: 'good' },
      { id: 'core_util', label: 'Core Util', display: '72%', state: 'good' },
    ])
    expect(buildBestWorkspacePpaMetrics(rows, null)).toEqual([])
  })

  it('maps metric state, run state, and sort interactions to display values', () => {
    expect(runStateSliceClass('running')).toBe('run-state-running')
    expect(metricValueClass('good')).toBe('metric-good')
    expect(metricValueClass('warn')).toBe('metric-warn')
    expect(metricValueClass('bad')).toBe('metric-bad')
    expect(metricValueClass('pending')).toBe('metric-pending')
    expect(initialMetricSortDirection('frequency')).toBe('desc')
    expect(initialMetricSortDirection('runtime')).toBe('asc')
    expect(initialMetricSortDirection('memory')).toBe('asc')
    expect(initialMetricSortDirection('drc')).toBe('asc')
    expect(nextMetricSortState(null, 'frequency')).toEqual({
      key: 'frequency',
      direction: 'desc',
    })
    expect(nextMetricSortState(null, 'memory')).toEqual({
      key: 'memory',
      direction: 'asc',
    })
    expect(
      nextMetricSortState({ key: 'frequency', direction: 'desc' }, 'frequency'),
    ).toEqual({ key: 'frequency', direction: 'asc' })
    expect(
      metricSortAriaValue({ key: 'frequency', direction: 'desc' }, 'frequency'),
    ).toBe('descending')
    expect(metricSortAriaValue({ key: 'frequency', direction: 'desc' }, 'wns')).toBe(
      'none',
    )
    const runtimePoints = [point('ws_a', 32, '32 s'), point('ws_b', 48, '48 s')]
    expect(metricHasComparableData({ points: [pendingMetricPoint('ws_a')] })).toBe(false)
    expect(metricHasComparableData({ points: runtimePoints })).toBe(true)
  })
})
