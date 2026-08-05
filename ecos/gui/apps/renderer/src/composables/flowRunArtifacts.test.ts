import type { WorkspaceStepResource } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import {
  flowStepArtifactFingerprint,
  flowStepRunArtifacts,
  isSuccessfulFlowState,
  isSuccessfulFlowStep,
} from './flowRunArtifacts'

function stepResource(
  overrides: Partial<WorkspaceStepResource> = {},
): WorkspaceStepResource {
  return {
    name: 'STA',
    tool: 'ecc',
    state: 'Success',
    runtime: '00:00:02',
    directory: '/workspace/sta_ecc',
    info: {},
    resources: {
      output: {
        image: {
          path: '/workspace/sta_ecc/output/design_sta.png',
          exists: true,
          kind: 'layout-image',
          mtimeMs: 20,
        },
      },
      data: {},
      feature: {},
      report: {
        db: {
          path: '/workspace/sta_ecc/report/sta.db.rpt',
          exists: true,
          kind: 'report',
          mtimeMs: 10,
        },
        nested: {
          timing: {
            path: '/workspace/sta_ecc/report/MAX/qor_summary.rpt',
            exists: true,
            kind: 'report',
            mtimeMs: 11,
          },
          ignored: {
            path: '/workspace/sta_ecc/report/summary.json',
            exists: true,
            kind: 'report',
          },
        },
      },
      log: {},
      script: {},
      analysis: {},
      subflow: {},
      checklist: {},
      config: {},
    },
    ...overrides,
  }
}

describe('flow run artifacts', () => {
  it('collects only existing report files before the step layout image', () => {
    const artifacts = flowStepRunArtifacts(stepResource())

    expect(artifacts.reports.map((file) => file.path)).toEqual([
      '/workspace/sta_ecc/report/MAX/qor_summary.rpt',
      '/workspace/sta_ecc/report/sta.db.rpt',
    ])
    expect(artifacts.layout?.path).toBe('/workspace/sta_ecc/output/design_sta.png')
  })

  it('recognizes supported success states and detects changed run output', () => {
    const initial = stepResource({ state: 'Completed' })
    const changed = stepResource({
      resources: {
        ...initial.resources,
        output: {
          image: {
            ...initial.resources.output.image!,
            mtimeMs: 42,
          },
        },
      },
    })

    expect(isSuccessfulFlowStep(initial)).toBe(true)
    expect(isSuccessfulFlowState('succeeded')).toBe(true)
    expect(isSuccessfulFlowState('failed')).toBe(false)
    expect(flowStepArtifactFingerprint(changed)).not.toBe(
      flowStepArtifactFingerprint(initial),
    )
  })
})
