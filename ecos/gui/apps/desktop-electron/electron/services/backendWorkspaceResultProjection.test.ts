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
      schemaVersion: 6 as const,
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
