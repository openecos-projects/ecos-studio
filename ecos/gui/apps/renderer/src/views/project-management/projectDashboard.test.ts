import { describe, expect, it } from 'vitest'
import {
  dashboardSummaryFixture,
  metricPointFixture,
  metricRowFixture,
  projectFixture,
  trendSummaryWithScoresFixture,
  workspaceFixture,
} from './projectDashboard.fixture'
import {
  stepSnapshotFixture,
  workspaceSummaryFixture,
} from '@/components/projectStepAnalysis.fixture'
import {
  buildDashboardAttention,
  buildDashboardHealth,
  buildDashboardRecommendation,
  buildDashboardWorkspaceRows,
  countAttentionBySeverity,
  dashboardGridTemplate,
  formatScore,
  sortDashboardWorkspaceRows,
} from './projectDashboard'

describe('buildDashboardHealth', () => {
  it('summarizes flow progress, run states, and readiness coverage', () => {
    const health = buildDashboardHealth(dashboardSummaryFixture())

    expect(health.flowLabel).toBe('2/3')
    expect(health.stepsNote).toBe('4 of 12 steps left')
    expect(health.runSegments.map((segment) => segment.state)).toEqual([
      'success',
      'failed',
    ])
    expect(health.checks.map((check) => [check.id, check.value])).toEqual([
      ['drc', '2/3'],
      ['timing', '1/3'],
      ['signoff', '3/3'],
    ])
  })

  it('tones each readiness check by how much of the project it covers', () => {
    const health = buildDashboardHealth(dashboardSummaryFixture())

    expect(health.checks.map((check) => check.tone)).toEqual(['warn', 'warn', 'good'])
    expect(
      buildDashboardHealth(
        dashboardSummaryFixture({ drcCleanCount: 0, workspaceCount: 3 }),
      ).checks[0].tone,
    ).toBe('bad')
  })

  it('notes the at-risk and incomplete split only when timing has a shortfall', () => {
    const health = buildDashboardHealth(dashboardSummaryFixture())

    expect(health.checks[1].note).toBe('1 at risk · 1 incomplete')
    expect(
      buildDashboardHealth(
        dashboardSummaryFixture({ timingAtRiskCount: 0, timingIncompleteCount: 0 }),
      ).checks[1].note,
    ).toBeNull()
  })

  it('keeps the label gloss out of the inline copy so the checks stay one line tall', () => {
    const health = buildDashboardHealth(dashboardSummaryFixture())

    expect(health.checks.map((check) => check.note)).toEqual([
      null,
      '1 at risk · 1 incomplete',
      null,
    ])
    expect(health.checks[0].hint).toBe('Workspaces reporting zero DRC violations')
  })

  // The headline counts workspaces, matching the checks beside it, because a step-cell
  // total cannot tell one stalled workspace apart from many that are each one step short.
  it('counts flow progress in workspaces rather than step cells', () => {
    const health = buildDashboardHealth(
      dashboardSummaryFixture({
        workspaceCount: 50,
        flowCompleteWorkspaceCount: 47,
        configuredStepCount: 600,
        successStepCount: 583,
      }),
    )

    expect(health.flowLabel).toBe('47/50')
    expect(health.stepsNote).toBe('17 of 600 steps left')
  })

  it('drops the step note once nothing is left to run', () => {
    const health = buildDashboardHealth(
      dashboardSummaryFixture({
        workspaceCount: 50,
        flowCompleteWorkspaceCount: 50,
        configuredStepCount: 600,
        successStepCount: 600,
      }),
    )

    expect(health.flowLabel).toBe('50/50')
    expect(health.stepsNote).toBeNull()
  })

  it('reports no progress rather than dividing by zero without configured steps', () => {
    const health = buildDashboardHealth(
      dashboardSummaryFixture({
        workspaceCount: 3,
        flowCompleteWorkspaceCount: 0,
        configuredStepCount: 0,
        successStepCount: 0,
      }),
    )

    expect(health.flowLabel).toBe('0/3')
    expect(health.stepsNote).toBeNull()
  })
})

describe('buildDashboardRecommendation', () => {
  it('reports the QoR best workspace with its score and threshold standing', () => {
    const recommendation = buildDashboardRecommendation(
      trendSummaryWithScoresFixture(),
      'ws_b',
      'Highest eligible QoR score: 74.2',
    )

    expect(recommendation).toMatchObject({
      workspaceId: 'ws_b',
      score: '74.2',
      scoreTone: 'good',
      signoff: 'pass',
      scoreNote: 'Meets the 60 analysis threshold',
    })
  })

  it('drops a reason that only restates the score shown beside it', () => {
    expect(
      buildDashboardRecommendation(
        trendSummaryWithScoresFixture(),
        'ws_b',
        'Highest eligible QoR score: 74.2',
      )?.reason,
    ).toBeNull()
    expect(
      buildDashboardRecommendation(
        trendSummaryWithScoresFixture(),
        'ws_b',
        'Only workspace with a complete run',
      )?.reason,
    ).toBe('Only workspace with a complete run')
  })

  it('warns when the leading workspace is still under the analysis threshold', () => {
    expect(
      buildDashboardRecommendation(trendSummaryWithScoresFixture(), 'ws_a', 'reason'),
    ).toMatchObject({ score: '58.4', scoreTone: 'warn' })
  })

  it('says the threshold does not gate signoff when a passing workspace scores low', () => {
    expect(
      buildDashboardRecommendation(trendSummaryWithScoresFixture(), 'ws_a', 'reason')
        ?.scoreNote,
    ).toBe('Below the 60 analysis threshold, which does not gate signoff')
  })

  it('explains an unrated score instead of naming a threshold', () => {
    expect(
      buildDashboardRecommendation(trendSummaryWithScoresFixture(), 'ws_c', 'reason'),
    ).toMatchObject({ score: 'NR', scoreNote: expect.stringContaining('Not rated') })
  })

  it('returns null when the named workspace has no QoR entry', () => {
    expect(
      buildDashboardRecommendation(trendSummaryWithScoresFixture(), 'ws_missing', ''),
    ).toBeNull()
  })
})

describe('buildDashboardWorkspaceRows', () => {
  it('builds one row per workspace carrying progress, score, and signoff', () => {
    const project = projectFixture()
    const rows = buildDashboardWorkspaceRows(project, project.metricsRows, 'ws_b')

    expect(rows.map((row) => row.workspaceId)).toEqual(['ws_a', 'ws_b', 'ws_c'])
    expect(rows[0]).toMatchObject({
      stepsLabel: '2/4',
      stepsPercent: 50,
      score: '58.4',
      isBaseline: true,
      isRecommended: false,
      signoffLabel: 'Ready',
    })
    expect(rows[1]).toMatchObject({
      score: '74.2',
      isBaseline: false,
      isRecommended: true,
      statusLabel: 'Running',
      statusTone: 'warn',
    })
    expect(rows[2]).toMatchObject({ score: 'NR', signoffLabel: 'Incomplete' })
    expect(rows.every((row) => row.analysisState === 'unavailable')).toBe(true)
  })

  it('uses clean only when every completed step has a complete analysis report', () => {
    const project = projectFixture({
      workspaces: [
        workspaceFixture('ws_a', {
          steps: [
            {
              step: 'Route',
              status: 'success',
              label: 'Route',
              canCreateWorkspace: false,
            },
          ],
        }),
      ],
      workspaceSummaries: [
        workspaceSummaryFixture('ws_a', {
          Route: stepSnapshotFixture({ step: 'Route' }),
        }),
      ],
      stepCompareSummaries: [
        {
          step: 'Route',
          title: 'Route',
          metricLabel: '',
          metricHint: '',
          configuredCount: 1,
          successCount: 1,
          missingCount: 0,
          points: [],
          metrics: [],
        },
      ],
    })

    const [row] = buildDashboardWorkspaceRows(project, project.metricsRows, 'ws_a')

    expect(row).toMatchObject({
      analysisState: 'clean',
      analysisLabel: 'clean',
      analysisTone: 'good',
    })
  })

  it('gives every row a cell for each metric column, padding absent values', () => {
    const project = projectFixture()
    const rows = buildDashboardWorkspaceRows(project, project.metricsRows, 'ws_b')

    expect(rows[0].cells.map((cell) => cell.metric.id)).toEqual([
      'die_area',
      'core_util',
      'frequency',
      'wns',
      'drc',
      'lvs',
    ])
    expect(rows[0].cells[2].point.label).toBe('100 MHz')
    // ws_c has no metric points at all, so every cell falls back to pending.
    expect(rows[2].cells.every((cell) => cell.point.state === 'pending')).toBe(true)
  })
})

describe('sortDashboardWorkspaceRows', () => {
  const project = projectFixture()
  const rows = buildDashboardWorkspaceRows(project, project.metricsRows, 'ws_b')

  it('returns the original order when no sort is active', () => {
    expect(sortDashboardWorkspaceRows(rows, null).map((row) => row.workspaceId)).toEqual([
      'ws_a',
      'ws_b',
      'ws_c',
    ])
  })

  it('sorts by workspace id in both directions', () => {
    expect(
      sortDashboardWorkspaceRows(rows, { key: 'workspace', direction: 'desc' }).map(
        (row) => row.workspaceId,
      ),
    ).toEqual(['ws_c', 'ws_b', 'ws_a'])
  })

  it('sorts by the non-metric columns and pushes missing values last', () => {
    expect(
      sortDashboardWorkspaceRows(rows, { key: 'score', direction: 'desc' }).map(
        (row) => row.workspaceId,
      ),
    ).toEqual(['ws_b', 'ws_a', 'ws_c'])
  })

  it('sorts by a metric column using its numeric value', () => {
    expect(
      sortDashboardWorkspaceRows(rows, { key: 'frequency', direction: 'desc' }).map(
        (row) => row.workspaceId,
      ),
    ).toEqual(['ws_b', 'ws_a', 'ws_c'])
  })
})

describe('buildDashboardAttention', () => {
  const items = buildDashboardAttention(trendSummaryWithScoresFixture())

  it('merges risks and baseline regressions, quoting severity only where reported', () => {
    // Regressions are a baseline comparison, so no artifact rates them; they sort last.
    expect(items.map((item) => [item.severity, item.workspaceId])).toEqual([
      ['critical', 'ws_b'],
      ['warning', 'ws_a'],
      [null, 'ws_b'],
    ])
  })

  it('keeps the step on risks so the row can drill into Step Analysis', () => {
    expect(items[0]).toMatchObject({
      workspaceId: 'ws_b',
      step: 'STA',
      kind: 'Blocking issue',
      title: 'Setup WNS',
      detail: 'Setup WNS is -0.42 ns against a 0 ns target.',
      metric: 'setup_wns',
    })
  })

  it('leaves regressions without a step because they span the whole workspace', () => {
    const regression = items.find((item) => item.kind === 'Regression')

    expect(regression).toMatchObject({ workspaceId: 'ws_b', step: null })
  })

  it('counts only the findings whose severity was reported', () => {
    expect(countAttentionBySeverity(items)).toEqual({
      critical: 1,
      warning: 1,
      info: 0,
    })
  })
})

describe('dashboard formatting helpers', () => {
  it('renders an unrated score as NR and a rated score to one decimal', () => {
    expect(formatScore(null)).toBe('NR')
    expect(formatScore(74.25)).toBe('74.3')
  })

  it('narrows the column for metrics that have no comparable data', () => {
    const populated = metricRowFixture('frequency', 'Frequency', [
      metricPointFixture('ws_a', 125),
    ])
    const empty = metricRowFixture('drc', 'DRC', [metricPointFixture('ws_a', null)])

    expect(dashboardGridTemplate([populated, empty])).toBe(
      'minmax(148px, 1.05fr) 92px 62px 76px 84px minmax(96px, 1fr) minmax(82px, 0.8fr) 78px',
    )
  })
})
