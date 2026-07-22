import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildProjectAnalysisSnapshot } from './projectAnalysisSnapshot'
import {
  buildProjectQorTrendSummary,
  type ProjectQorWorkspaceInput,
} from './projectQorTrend'

const acceptanceWorkspace = '/nfs/home/huangzengrong/test/gcd_qor/ws_0004'
describe('ws_0004 V3 QoR acceptance', () => {
  it('reads the current RCX and STA artifacts without direct feature parsing', () => {
    if (!existsSync(acceptanceWorkspace)) return
    const input = workspaceInput()
    const snapshot = buildProjectAnalysisSnapshot(input, ['RCX', 'STA'])
    const trend = buildProjectQorTrendSummary([input])
    const rcxDetail = snapshot.steps.RCX?.details.find(
      (detail) => detail.presentation === 'rcx_spef_corner_table',
    )
    const staDetail = snapshot.steps.STA?.details.find(
      (detail) => detail.presentation === 'path_group_table',
    )
    const setup = snapshot.steps.STA?.metrics.find(
      (metric) => metric.metricName === 'sta_setup_wns',
    )
    const hold = snapshot.steps.STA?.metrics.find(
      (metric) => metric.metricName === 'sta_hold_wns',
    )

    expect(snapshot.signoffReadiness).toMatchObject({
      status: 'pass',
      scoreEligible: true,
    })
    expect(rcxDetail?.summary.coverage).toMatchObject({
      status: 'pass',
      expected_count: 9,
      available_count: 9,
    })
    expect(staDetail?.summary.records).toHaveLength(13)
    expect(setup?.cornerContext?.label).toBe('WCL - SS - 1.08 V - -40 C - Cworst')
    expect(hold?.cornerContext?.label).toBe('MIN - FF - 1.32 V - -40 C - Cbest')
    expect(trend.workspaces[0]).toMatchObject({
      overallScore: expect.any(Number),
      signoffComparison: {
        rcxCornerFingerprint: expect.any(String),
        staPvtRcFingerprint: expect.any(String),
      },
    })
  })
})

function workspaceInput(): ProjectQorWorkspaceInput {
  const read = (path: string) => readFileSync(`${acceptanceWorkspace}/${path}`, 'utf8')
  return {
    workspaceId: 'ws_0004',
    workspaceName: 'ws_0004',
    workspacePath: acceptanceWorkspace,
    createdAt: '2026-07-20T00:00:00.000Z',
    status: 'success',
    branchFrom: null,
    stepMetricTexts: {
      RCX: read('RCX_ecc/analysis/qor_metrics.json'),
      STA: read('sta_ecc/analysis/qor_metrics.json'),
    },
    stepSummaryTexts: {
      RCX: read('RCX_ecc/analysis/qor_summary.json'),
      STA: read('sta_ecc/analysis/qor_summary.json'),
    },
    stepHotspotTexts: {
      RCX: read('RCX_ecc/analysis/qor_hotspots.json'),
      STA: read('sta_ecc/analysis/qor_hotspots.json'),
    },
    staTimingIssuesText: read('sta_ecc/analysis/sta_timing_issues.json'),
    stepStatuses: { RCX: 'success', STA: 'success' },
  }
}
