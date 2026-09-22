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
  const step = {
    stepId: 'Route',
    toolId: 'ecc',
    order: 0,
    flowState: revision === 1 ? 'Success' : 'Unstart',
    metricCount: 0,
    summaryStatus: revision === 1 ? 'pass' : 'unavailable',
    metrics: { artifactId: 'metrics', status: 'missing', data: null },
    summary: { artifactId: 'summary', status: 'missing', data: null },
    hotspots: { artifactId: 'hotspots', status: 'missing', data: null },
    timingIssues: null,
  }
  const qor = {
    analysis: { steps: [step] },
    metrics: [],
  }
  return {
    ok: true,
    readBytes: 1,
    snapshot: {
      checklist: {},
      parameters: {},
      schemaVersion: 5,
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
