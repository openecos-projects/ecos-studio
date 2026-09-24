import { effectScope, nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  getChecklistEvidence: vi.fn(),
  session: null as Record<string, any> | null,
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    backendWorkspace: { getChecklistEvidence: testState.getChecklistEvidence },
  }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

import { checklistEvidenceLabel, useChecklistEvidence } from './useChecklistEvidence'

const checklistItem = {
  id: 'place.legalization',
  title: 'Legalization clean',
  state: 'failed',
  blocked: true,
  owner: 'checklist',
  policy: 'block',
  step: 'Place',
  category: 'layout',
  summary: 'Legalization violations remain',
  source: { path: 'Place_ecc/analysis/qor_metrics.json' },
  evidence: [{ kind: 'metric', id: 'place_legality', value: 3 }],
}

describe('useChecklistEvidence', () => {
  beforeEach(() => {
    testState.getChecklistEvidence.mockReset()
    testState.session = reactive({
      generation: 0,
      workspaceContextId: 'context-a',
      projection: {
        data: {
          revision: {
            status: 'ready',
            data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
          },
        },
      },
    })
  })

  it('lazy-loads the original checklist record for the expanded finding', async () => {
    testState.getChecklistEvidence.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      evidence: {
        status: 'ready',
        data: { findingId: 'place.legalization', item: checklistItem },
      },
    })
    const scope = effectScope()
    const evidence = scope.run(() => useChecklistEvidence())!

    await evidence.toggleFinding('place.legalization')

    expect(testState.getChecklistEvidence).toHaveBeenCalledWith({
      findingId: 'place.legalization',
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    expect(evidence.expandedFindingId.value).toBe('place.legalization')
    const state = evidence.evidenceState('place.legalization')
    expect(state?.status).toBe('ready')
    // The rendered text is the producer's verbatim record, including the
    // fields the bounded projection drops.
    expect(state?.status === 'ready' && state.text).toContain('"owner": "checklist"')
    expect(state?.status === 'ready' && state.text).toContain('"place_legality"')
    scope.stop()
  })

  it('surfaces the unavailable code when evidence cannot be served', async () => {
    testState.getChecklistEvidence.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_REFERENCE_MISSING' }],
      },
    })
    const scope = effectScope()
    const evidence = scope.run(() => useChecklistEvidence())!

    await evidence.toggleFinding('place.legalization')

    expect(evidence.evidenceState('place.legalization')).toEqual({
      status: 'unavailable',
      code: 'ARTIFACT_REFERENCE_MISSING',
    })
    expect(checklistEvidenceLabel('ARTIFACT_REFERENCE_MISSING')).toContain(
      'not available',
    )
    scope.stop()
  })

  it('collapses on a second toggle and serves the cached state on re-expand', async () => {
    testState.getChecklistEvidence.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      evidence: {
        status: 'ready',
        data: { findingId: 'place.legalization', item: checklistItem },
      },
    })
    const scope = effectScope()
    const evidence = scope.run(() => useChecklistEvidence())!

    await evidence.toggleFinding('place.legalization')
    await evidence.toggleFinding('place.legalization')
    expect(evidence.expandedFindingId.value).toBeNull()
    await evidence.toggleFinding('place.legalization')

    expect(evidence.expandedFindingId.value).toBe('place.legalization')
    expect(testState.getChecklistEvidence).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('discards a late response after the workspace generation changes', async () => {
    let resolve!: (value: unknown) => void
    testState.getChecklistEvidence.mockReturnValue(
      new Promise((done) => (resolve = done)),
    )
    const scope = effectScope()
    const evidence = scope.run(() => useChecklistEvidence())!
    const pending = evidence.toggleFinding('place.legalization')

    testState.session!.generation = 1
    await nextTick()
    resolve({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      evidence: {
        status: 'ready',
        data: { findingId: 'place.legalization', item: checklistItem },
      },
    })
    await pending

    expect(evidence.expandedFindingId.value).toBeNull()
    expect(evidence.evidenceState('place.legalization')).toBeNull()
    scope.stop()
  })

  it('reports an unavailable state without a committed revision', async () => {
    testState.session!.projection.data = null
    const scope = effectScope()
    const evidence = scope.run(() => useChecklistEvidence())!

    await evidence.toggleFinding('place.legalization')

    expect(evidence.evidenceState('place.legalization')).toEqual({
      status: 'unavailable',
      code: 'WORKSPACE_REVISION_UNAVAILABLE',
    })
    expect(testState.getChecklistEvidence).not.toHaveBeenCalled()
    scope.stop()
  })
})
