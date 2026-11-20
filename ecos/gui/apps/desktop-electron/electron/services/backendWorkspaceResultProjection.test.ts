import { describe, expect, it } from 'vitest'
import { projectWorkspaceResults } from './backendWorkspaceResultProjection'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'

function section<T>(data: T) {
  return { status: 'ready' as const, data, issues: [] }
}

function readResult(
  revision: number,
  stalePredecessor?: { workspaceRevision: number; invalidatedStepIds: string[] },
) {
  return {
    ok: true as const,
    readBytes: 1,
    snapshot: {
      cause: 'flow_step.success',
      parameters: {},
      schemaVersion: 7 as const,
      workspaceId: 'workspace-1',
      workspaceRevision: revision,
      ...(stalePredecessor ? { stalePredecessor } : {}),
    },
    sections: {
      artifacts: section([]),
      checklist: section({ items: [] }),
      flow: section({ steps: [] }),
      hotspotPreview: section({
        hotspotCount: 0,
        hotspots: [],
        hotspotsTruncated: false,
      }),
      metrics: section([]),
      qorSnapshotExtension: { status: 'unavailable' as const, issues: [] },
      signoff: section({ groups: [], risks: [], status: 'ready' }),
      timingPreview: section({ issueCount: 0, issues: [], issuesTruncated: false }),
    },
  }
}

describe('projectWorkspaceResults', () => {
  it('inherits metrics for only the inserted LEC that still needs a result', () => {
    const synthMetric = { id: 'runtime_seconds', scope: 'lec@synthesis_execution' }
    const ctsMetric = { id: 'runtime_seconds', scope: 'lec@cts_execution' }
    const current = readResult(2, {
      workspaceRevision: 1,
      invalidatedStepIds: ['lec@synthesis', 'lec@cts'],
    })
    const predecessor = readResult(1)
    const result = projectWorkspaceResults({
      ...current,
      sections: {
        ...current.sections,
        flow: section({
          steps: [
            { name: 'lec@synthesis', state: 'Success' },
            { name: 'lec@cts', state: 'Unstart' },
          ],
        }),
        metrics: section([{ ...synthMetric, value: 2 }]),
      },
      staleSnapshot: {
        ...predecessor,
        sections: {
          ...predecessor.sections,
          metrics: section([
            { ...synthMetric, value: 1 },
            { ...ctsMetric, value: 3 },
          ]),
        },
      },
    } as unknown as Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>)

    expect(result.freshness).toMatchObject({
      status: 'mixed',
      currentStepIds: ['lec@synthesis'],
      staleStepIds: ['lec@cts'],
    })
    expect(result.snapshot.sections.metrics).toEqual(
      section([
        { ...synthMetric, value: 2 },
        { ...ctsMetric, value: 3 },
      ]),
    )
  })

  it('marks the QoR v3 extension unavailable when the display mixes stale facts', () => {
    const current = readResult(2, { workspaceRevision: 1, invalidatedStepIds: ['Route'] })
    const result = projectWorkspaceResults({
      ...current,
      staleSnapshot: readResult(1),
    } as unknown as Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>)

    expect(result.freshness.status).toBe('stale')
    expect(result.snapshot.sections.qorSnapshotExtension).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_QOR_SNAPSHOT_STALE' }],
    })
  })
})
