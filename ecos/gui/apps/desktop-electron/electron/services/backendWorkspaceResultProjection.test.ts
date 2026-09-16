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
  const qor = {
    analysis: { steps: [] },
    metrics: [],
    qorAssessment: {
      status: 'ready',
      metrics: [],
      score: { gate: 'incomplete', threshold: 60, value: null },
      steps:
        revision === 1
          ? [
              {
                stepId: 'Route',
                name: 'Route',
                order: 0,
                status: 'pass',
                summaryMetricCount: 0,
              },
            ]
          : [],
    },
  }
  return {
    ok: true,
    readBytes: 1,
    snapshot: {
      checklist: {},
      parameters: {},
      schemaVersion: 3,
      workspaceId: 'workspace-1',
      workspaceRevision: revision,
      ...(stalePredecessor ? { stalePredecessor } : {}),
    },
    sections: {
      artifacts: section([]),
      flow: section({ steps: [] }),
      qor: section(qor),
      qorSnapshotExtension: section({ status: 'available' }),
      signoff: section({ groups: [], risks: [], status: 'ready' }),
    },
  } as unknown as ProjectEngineeringSnapshotReadResult
}

describe('projectWorkspaceResults', () => {
  it('marks the QoR v3 extension unavailable when the display mixes stale facts', () => {
    const current = readResult(2, { workspaceRevision: 1, invalidatedStepIds: ['Route'] })
    const result = projectWorkspaceResults({
      ...current,
      staleSnapshot: readResult(1),
    } as Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>)

    expect(result.freshness.status).toBe('stale')
    expect(result.snapshot.sections.qorSnapshotExtension).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_QOR_SNAPSHOT_STALE' }],
    })
  })
})
