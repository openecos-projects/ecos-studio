import { effectScope, reactive, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string }> | null,
  getArtifact: vi.fn(),
  session: null as Record<string, any> | null,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: testState.currentProject }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendWorkspace: { getArtifact: testState.getArtifact } }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

import { clearHomeSnapshotCache, useHomeSnapshots } from './useHomeSnapshots'

function overview(revision = 9) {
  return {
    artifacts: {
      status: 'ready',
      issues: [],
      data: {
        items: [
          {
            artifactId: 'layout-place',
            availability: 'available',
            kind: 'layout_image',
            name: 'gcd_Place.png',
            stepId: 'Place',
          },
          {
            artifactId: 'geometry-place',
            availability: 'available',
            kind: 'layout_geometry',
            name: 'geometry.manifest',
            stepId: 'Place',
          },
        ],
      },
    },
    flow: {
      status: 'ready',
      issues: [],
      data: {
        steps: [{ name: 'Place', order: 0, state: 'succeeded', stepId: 'Place' }],
      },
    },
    revision: {
      status: 'ready',
      issues: [],
      data: { workspaceId: 'engineering-a', workspaceRevision: revision },
    },
  }
}

describe('useHomeSnapshots', () => {
  let scope: EffectScope
  const createObjectURL = vi.fn(() => 'blob:layout-place')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    clearHomeSnapshotCache()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    scope = effectScope()
    testState.currentProject = ref({ path: '/project/ws-a' })
    testState.session = reactive({
      generation: 0,
      projection: { data: overview() },
      workspaceContextId: 'context-a',
    })
    testState.getArtifact.mockReset()
    testState.getArtifact.mockResolvedValue({
      artifact: {
        status: 'ready',
        issues: [],
        data: {
          artifactId: 'layout-place',
          bytes: new Uint8Array([1, 2, 3]),
          kind: 'layout_image',
          mimeType: 'image/png',
          name: 'gcd_Place.png',
        },
      },
      generation: 0,
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
  })

  afterEach(() => {
    scope.stop()
    clearHomeSnapshotCache()
    vi.unstubAllGlobals()
  })

  it('loads declared layout bytes by artifact identity and reuses the Blob URL', async () => {
    const snapshots = scope.run(() => useHomeSnapshots())!
    await vi.waitFor(() => expect(snapshots.layoutThumbnails.value).toHaveLength(1))

    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'layout-place',
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    expect(snapshots.layoutThumbnails.value[0]).toMatchObject({
      hasGeometry: true,
      step: 'Place',
      url: 'blob:layout-place',
    })
    expect(JSON.stringify(snapshots.layoutThumbnails.value)).not.toContain('/project/')

    await snapshots.refresh()
    expect(testState.getArtifact).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('reads stale layout bytes using the artifact source Revision', async () => {
    testState.session!.projection.data.artifacts.data.items[0].sourceRevision = 8
    testState.session!.projection.data.flow.data.steps[0].state = 'not-started'
    testState.getArtifact.mockResolvedValue({
      artifact: {
        status: 'ready',
        issues: [],
        data: {
          artifactId: 'layout-place',
          bytes: new Uint8Array([1, 2, 3]),
          kind: 'layout_image',
          mimeType: 'image/png',
          name: 'gcd_Place.png',
        },
      },
      generation: 0,
      workspaceContextId: 'context-a',
      workspaceRevision: 8,
    })
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => expect(snapshots.layoutThumbnails.value).toHaveLength(1))

    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'layout-place',
      workspaceContextId: 'context-a',
      workspaceRevision: 8,
    })
  })

  it('retains existing thumbnails while the revision is temporarily unavailable', async () => {
    const snapshots = scope.run(() => useHomeSnapshots())!
    await vi.waitFor(() => expect(snapshots.layoutThumbnails.value).toHaveLength(1))

    testState.session!.projection.data.revision = {
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_SNAPSHOT_READ_FAILED' }],
    }

    await vi.waitFor(() => expect(snapshots.loading.value).toBe(false))
    expect(snapshots.layoutThumbnails.value).toHaveLength(1)
    expect(snapshots.error.value).toBe('WORKSPACE_REVISION_UNAVAILABLE')
  })

  it.each(['preFloorplan', 'macroPlacement', 'postFloorplan'])(
    'includes %s layout artifacts in Home snapshots',
    async (step) => {
      testState.session!.projection.data.artifacts.data.items = [
        {
          artifactId: `layout-${step}`,
          availability: 'available',
          kind: 'layout_image',
          name: `gcd_${step}.png`,
          stepId: step,
        },
      ]
      testState.session!.projection.data.flow.data.steps = [
        { name: step, order: 0, state: 'succeeded', stepId: step },
      ]
      testState.getArtifact.mockResolvedValue({
        artifact: {
          status: 'ready',
          issues: [],
          data: {
            artifactId: `layout-${step}`,
            bytes: new Uint8Array([1, 2, 3]),
            kind: 'layout_image',
            mimeType: 'image/png',
            name: `gcd_${step}.png`,
          },
        },
        generation: 0,
        workspaceContextId: 'context-a',
        workspaceRevision: 9,
      })

      const snapshots = scope.run(() => useHomeSnapshots())!

      await vi.waitFor(() => expect(snapshots.layoutThumbnails.value).toHaveLength(1))
      expect(snapshots.layoutThumbnails.value[0]).toMatchObject({
        step,
        url: 'blob:layout-place',
      })
    },
  )

  it('does not count a missing stale layout reference as a layout', async () => {
    testState.session!.projection.data.artifacts.data.items[0].availability = 'missing'
    testState.session!.projection.data.artifacts.data.items[0].sourceRevision = 8
    testState.session!.projection.data.flow.data.steps[0].state = 'not-started'
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => expect(snapshots.loading.value).toBe(false))

    expect(snapshots.layoutThumbnails.value).toEqual([])
    expect(testState.getArtifact).not.toHaveBeenCalled()
  })

  it('does not display an Artifact response from another revision', async () => {
    testState.getArtifact.mockResolvedValue({
      artifact: { status: 'ready', issues: [], data: {} },
      generation: 0,
      workspaceContextId: 'context-a',
      workspaceRevision: 8,
    })
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => expect(snapshots.loading.value).toBe(false))

    expect(snapshots.layoutThumbnails.value).toEqual([])
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps a stale declared preview visible without requesting its bytes', async () => {
    testState.session!.projection.data.artifacts.data.items[0].availability = 'stale'
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => expect(snapshots.loading.value).toBe(false))

    expect(snapshots.layoutThumbnails.value).toEqual([
      expect.objectContaining({
        availability: 'stale',
        step: 'Place',
        url: null,
      }),
    ])
    expect(testState.getArtifact).not.toHaveBeenCalled()
  })

  it('marks a preview stale when its declared bytes fail verification', async () => {
    testState.getArtifact.mockResolvedValue({
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'FINDINGS_ARTIFACT_HASH_MISMATCH' }],
      },
      generation: 0,
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => expect(snapshots.loading.value).toBe(false))

    expect(snapshots.layoutThumbnails.value).toEqual([
      expect.objectContaining({
        availability: 'stale',
        reason: 'FINDINGS_ARTIFACT_HASH_MISMATCH',
        url: null,
      }),
    ])
  })
})
