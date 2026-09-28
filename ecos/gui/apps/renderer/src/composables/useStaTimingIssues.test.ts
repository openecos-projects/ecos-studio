import { effectScope, nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  session: null as Record<string, any> | null,
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    backendWorkspace: { getArtifact: testState.getArtifact },
  }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

import { staTimingIssuesLabel, useStaTimingIssues } from './useStaTimingIssues'

const descriptor = {
  artifactId: 'sta-issues',
  availability: 'available' as const,
  kind: 'sta_timing_issues',
  name: 'sta_timing_issues.json',
  stepId: 'STA',
}

const timingIssuesPayload = {
  missingCorners: ['WCL_0c'],
  issues: [
    {
      issueId: 'sta_timing:MAX_125/RCworst:setup:path-1',
      corner: 'MAX_125/RCworst',
      analysisType: 'setup' as const,
      slackNs: -0.42,
      startPoint: 'u0/Q',
      endPoint: 'u1/D',
      pathGroup: 'clk',
      stages: [{ pin: 'u0/Q', cell: 'DFF_X1', arrivalNs: 0.5, delayNs: 0.5 }],
    },
  ],
}

describe('useStaTimingIssues', () => {
  beforeEach(() => {
    testState.getArtifact.mockReset()
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

  it('lazy-loads the full issue list with stages through the artifact channel', async () => {
    testState.getArtifact.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      artifact: {
        status: 'ready',
        data: { artifactId: 'sta-issues', timingIssues: timingIssuesPayload },
      },
    })
    const scope = effectScope()
    const issues = scope.run(() => useStaTimingIssues())!

    await issues.open(descriptor)

    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'sta-issues',
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    expect(issues.visible.value).toBe(true)
    expect(issues.state.value).toEqual({
      status: 'ready',
      issues: [
        {
          id: 'sta_timing:MAX_125/RCworst:setup:path-1',
          corner: 'MAX_125/RCworst',
          analysisType: 'setup',
          slackNs: -0.42,
          stageCount: 1,
          stages: [{ pin: 'u0/Q', cell: 'DFF_X1', arrivalNs: 0.5, delayNs: 0.5 }],
        },
      ],
      missingCorners: ['WCL_0c'],
    })
    scope.stop()
  })

  it('serves the cached state on reopen without another read', async () => {
    testState.getArtifact.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      artifact: {
        status: 'ready',
        data: { artifactId: 'sta-issues', timingIssues: timingIssuesPayload },
      },
    })
    const scope = effectScope()
    const issues = scope.run(() => useStaTimingIssues())!

    await issues.open(descriptor)
    issues.close()
    await issues.open(descriptor)

    expect(issues.visible.value).toBe(true)
    expect(issues.state.value.status).toBe('ready')
    expect(testState.getArtifact).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('surfaces the unavailable code when the artifact cannot be served', async () => {
    testState.getArtifact.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_TOO_LARGE' }],
      },
    })
    const scope = effectScope()
    const issues = scope.run(() => useStaTimingIssues())!

    await issues.open(descriptor)

    expect(issues.state.value).toEqual({
      status: 'unavailable',
      code: 'ARTIFACT_TOO_LARGE',
    })
    expect(staTimingIssuesLabel('ARTIFACT_TOO_LARGE')).toContain('too large')
    scope.stop()
  })

  it('reports the missing artifact reference without issuing a read', async () => {
    const scope = effectScope()
    const issues = scope.run(() => useStaTimingIssues())!

    await issues.open(null)

    expect(issues.visible.value).toBe(true)
    expect(issues.state.value).toEqual({
      status: 'unavailable',
      code: 'ARTIFACT_REFERENCE_MISSING',
    })
    expect(testState.getArtifact).not.toHaveBeenCalled()
    scope.stop()
  })

  it('discards a late response after the workspace generation changes', async () => {
    let resolve!: (value: unknown) => void
    testState.getArtifact.mockReturnValue(new Promise((done) => (resolve = done)))
    const scope = effectScope()
    const issues = scope.run(() => useStaTimingIssues())!
    const pending = issues.open(descriptor)

    testState.session!.generation = 1
    await nextTick()
    resolve({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      artifact: {
        status: 'ready',
        data: { artifactId: 'sta-issues', timingIssues: timingIssuesPayload },
      },
    })
    await pending

    expect(issues.visible.value).toBe(false)
    expect(issues.state.value).toEqual({ status: 'idle' })
    scope.stop()
  })

  it('honours the artifact source revision for stale-predecessor evidence', async () => {
    testState.getArtifact.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 7,
      artifact: {
        status: 'ready',
        data: { artifactId: 'sta-issues', timingIssues: timingIssuesPayload },
      },
    })
    const scope = effectScope()
    const issues = scope.run(() => useStaTimingIssues())!

    await issues.open({ ...descriptor, sourceRevision: 7 })

    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'sta-issues',
      workspaceContextId: 'context-a',
      workspaceRevision: 7,
    })
    expect(issues.state.value.status).toBe('ready')
    scope.stop()
  })
})
