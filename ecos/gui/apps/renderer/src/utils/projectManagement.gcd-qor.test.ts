import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildProjectManagementProject,
  parseProjectManifest,
  parseWorkspaceFlowStateMap,
  type FlowStep,
  type ProjectWorkspaceAnalysisInputsById,
  type ProjectWorkspaceFlowStatesById,
} from './projectManagement'

const projectRoot = '/nfs/home/huangzengrong/test/gcd_qor'

const ANALYSIS_PATHS: Array<{ step: FlowStep; directory: string }> = [
  { step: 'Synth', directory: 'Synthesis_yosys' },
  { step: 'Floor', directory: 'Floorplan_ecc' },
  { step: 'Fanout', directory: 'fixFanout_ecc' },
  { step: 'Place', directory: 'place_dreamplace' },
  { step: 'CTS', directory: 'CTS_ecc' },
  { step: 'Legal', directory: 'legalization_dreamplace' },
  { step: 'Route', directory: 'route_ecc' },
  { step: 'DRC', directory: 'drc_ecc' },
  { step: 'Filler', directory: 'filler_ecc' },
  { step: 'RCX', directory: 'RCX_ecc' },
  { step: 'STA', directory: 'sta_ecc' },
  { step: 'Harden', directory: 'Harden_ecc' },
]

describe('gcd_qor Project Management V3 acceptance', () => {
  it('projects current V3 metrics and flow success for every workspace', () => {
    if (!existsSync(projectRoot)) return
    const manifest = parseProjectManifest(read(`${projectRoot}/project.json`))
    const model = buildProjectManagementProject(
      null,
      manifest,
      flowStates(manifest.workspaces.map((workspace) => workspace.workspace_id)),
      analysisInputs(manifest.workspaces.map((workspace) => workspace.workspace_id)),
    )
    const summaries = new Map(
      model.workspaceSummaries.map((summary) => [summary.workspaceId, summary]),
    )

    expect(
      model.qorTrendSummary.workspaces.map((workspace) => workspace.status),
    ).not.toContain('Blocked')
    expect(
      model.qorTrendSummary.workspaces.find(
        (workspace) => workspace.workspaceId === 'ws_0001',
      )?.areaScoringStep,
    ).toBe('STA')
    expect(summaries.get('ws_0001')?.finalMetrics).toMatchObject({
      area: { value: 2450 },
      dieArea: { value: 2926.485 },
      coreUtil: { value: 0.31 },
    })
    expect(summaries.get('ws_0002')?.finalMetrics).toMatchObject({
      area: { value: 1466.64 },
      dieArea: { value: 1832.268 },
      coreUtil: { value: 0.54 },
    })
    expect(summaries.get('ws_0003')?.finalMetrics).toMatchObject({
      area: { value: 1466.64 },
      dieArea: { value: 1832.268 },
      coreUtil: { value: 0.55 },
    })
  })
})

function analysisInputs(workspaceIds: string[]): ProjectWorkspaceAnalysisInputsById {
  return Object.fromEntries(
    workspaceIds.map((workspaceId) => {
      const stepMetricTexts = Object.fromEntries(
        ANALYSIS_PATHS.map(({ step, directory }) => [
          step,
          readOptional(
            `${projectRoot}/${workspaceId}/${directory}/analysis/qor_metrics.json`,
          ),
        ]),
      )
      const stepSummaryTexts = Object.fromEntries(
        ANALYSIS_PATHS.map(({ step, directory }) => [
          step,
          readOptional(
            `${projectRoot}/${workspaceId}/${directory}/analysis/qor_summary.json`,
          ),
        ]),
      )
      const stepHotspotTexts = Object.fromEntries(
        ANALYSIS_PATHS.map(({ step, directory }) => [
          step,
          readOptional(
            `${projectRoot}/${workspaceId}/${directory}/analysis/qor_hotspots.json`,
          ),
        ]),
      )
      return [
        workspaceId,
        {
          stepMetricTexts,
          stepSummaryTexts,
          stepHotspotTexts,
          staTimingIssuesText: readOptional(
            `${projectRoot}/${workspaceId}/sta_ecc/analysis/sta_timing_issues.json`,
          ),
        },
      ]
    }),
  )
}

function flowStates(workspaceIds: string[]): ProjectWorkspaceFlowStatesById {
  return Object.fromEntries(
    workspaceIds.map((workspaceId) => [
      workspaceId,
      parseWorkspaceFlowStateMap(read(`${projectRoot}/${workspaceId}/home/flow.json`)),
    ]),
  )
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function readOptional(path: string): string | null {
  return existsSync(path) ? read(path) : null
}
