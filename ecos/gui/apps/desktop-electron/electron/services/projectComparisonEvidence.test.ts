import { describe, expect, it, vi } from 'vitest'
import {
  projectManifestFlowSteps,
  validateEngineeringSnapshot,
  type EccPersistedEngineeringSnapshot,
} from '@ecos-studio/shared'
import { representativeProjectComparisonFixture } from './backendProjectComparison.fixture'
import { BackendProjectComparisonService } from './backendProjectComparisonService'

function validated(snapshot: EccPersistedEngineeringSnapshot) {
  const result = validateEngineeringSnapshot(snapshot)
  if (!result.ok) throw new Error(result.issue.code)
  return { ...result, readBytes: 1 }
}

function invalidated(
  previous: EccPersistedEngineeringSnapshot,
  steps: readonly string[],
) {
  const snapshot = structuredClone(previous)
  snapshot.workspaceRevision += 1
  snapshot.stalePredecessor = {
    workspaceRevision: previous.workspaceRevision,
    invalidatedStepIds: [...steps],
  }
  snapshot.analysis.steps = snapshot.analysis.steps.filter(
    (step) => !steps.includes(step.stepId),
  )
  snapshot.artifacts = snapshot.artifacts.filter(
    (artifact) => !steps.includes(artifact.stepId ?? ''),
  )
  snapshot.flow = {
    steps: projectManifestFlowSteps.map((name) => ({
      name,
      state: steps.includes(name) ? 'Unstart' : 'Success',
    })),
  }
  snapshot.metrics = snapshot.metrics.filter(
    (metric) => !steps.some((step) => step.toLowerCase() === metric.analysis_group),
  )
  snapshot.qorAssessment = {
    status: 'ready',
    score: { gate: 'incomplete', threshold: 60, value: null },
    metrics: snapshot.metrics,
    steps: snapshot.analysis.steps.map((step) => ({
      stepId: step.stepId,
      name: step.stepId,
      order: step.order,
      status: 'pass',
      summaryMetricCount: 14,
    })),
  }
  snapshot.signoffAssessment = { status: 'attention', groups: [], risks: [] }
  return snapshot
}

async function harness(steps: readonly string[] = projectManifestFlowSteps) {
  const fixture = representativeProjectComparisonFixture()
  const previous = fixture.engineeringSnapshots.ws_0002!
  const current = invalidated(previous, steps)
  ;(previous.flow as { steps: Array<{ state: string }> }).steps[0]!.state = 'Warning'
  const readVerifiedArtifacts = vi.fn().mockResolvedValue({ ok: true, files: [] })
  const read = () => ({ ...validated(current), staleSnapshot: validated(previous) })
  const service = new BackendProjectComparisonService(
    {
      readManifest: async () => fixture.manifest,
      resolveProjectRoot: async (path) => path,
      readEngineeringSnapshot: async ({ workspacePath }) =>
        workspacePath.endsWith('ws_0002')
          ? read()
          : validated(fixture.engineeringSnapshots.ws_0001!),
      readVerifiedArtifacts,
    },
    () =>
      ({
        startProject: async () => {},
        reconcile: async () => {},
        close: async () => {},
      }) as never,
  )
  const selected = await service.selectProject(11, {
    projectRootLocator: '/projects/gcd',
  })
  if (!selected.ok) throw new Error('selection failed')
  const contextId = selected.projectComparisonContextId
  const comparison = await service.getComparison(11, contextId)
  if (!comparison.ok) throw new Error('comparison failed')
  const findings = (step: string) =>
    service.getStepFindings(11, {
      projectComparisonContextId: contextId,
      projectWorkspaceId: 'ws_0002',
      step,
    })
  return {
    service,
    contextId,
    comparison: comparison.data,
    previous,
    current,
    findings,
    readVerifiedArtifacts,
  }
}

describe('Project Comparison previous results', () => {
  it('keeps old Findings inspectable without adding them to current comparison or progress', async () => {
    const { comparison, findings, previous, readVerifiedArtifacts } = await harness()
    expect(comparison.workspaceSnapshots).toMatchObject({
      data: {
        flowStates: { ws_0002: { Synth: 'unstart', Legal: 'unstart' } },
        items: expect.arrayContaining([
          expect.objectContaining({
            workspaceId: 'ws_0002',
            resultState: {
              workspaceRevision: 15,
              pendingStepIds: [...projectManifestFlowSteps],
              previous: {
                workspaceRevision: 14,
                completedStepCount: projectManifestFlowSteps.length,
                stepCount: projectManifestFlowSteps.length,
              },
            },
          }),
        ]),
      },
    })
    expect(comparison.trend).toMatchObject({
      data: {
        baselineWorkspaceId: 'ws_0001',
        workspaces: expect.arrayContaining([
          expect.objectContaining({
            workspaceId: 'ws_0002',
            overallScore: null,
            records: [],
          }),
        ]),
      },
    })
    expect(comparison.stepComparisons).toMatchObject({
      data: {
        steps: expect.arrayContaining([
          expect.objectContaining({
            stepId: 'Legal',
            workspaces: expect.arrayContaining([
              { workspaceId: 'ws_0002', status: 'unstart', metrics: [] },
            ]),
          }),
        ]),
      },
    })
    const result = await findings('Legal')
    expect(result).toMatchObject({
      ok: true,
      data: {
        resultState: 'stale',
        currentWorkspaceRevision: 15,
        workspaceRevision: 14,
        details: { flowStatus: 'success', metrics: expect.any(Array) },
      },
    })
    if (!result.ok) throw new Error('findings failed')
    expect(result.data.details.metrics.length).toBeGreaterThan(0)
    expect(
      result.data.details.metrics.every((metric) => !metric.baselineComparison),
    ).toBe(true)
    expect(readVerifiedArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        artifacts: previous.artifacts
          .filter((artifact) => artifact.stepId === 'Legal')
          .map(({ reference, sha256, sizeBytes }) => ({ reference, sha256, sizeBytes })),
      }),
    )
  })

  it('keeps unaffected steps current and replaces old evidence after a Step commit', async () => {
    const { service, contextId, current, previous, findings } = await harness(['Legal'])
    expect(await findings('CTS')).toMatchObject({
      ok: true,
      data: { resultState: 'current', workspaceRevision: 15 },
    })
    expect(await findings('Legal')).toMatchObject({
      ok: true,
      data: { resultState: 'stale', workspaceRevision: 14 },
    })
    current.workspaceRevision += 1
    current.analysis.steps.push(
      structuredClone(previous.analysis.steps.find((step) => step.stepId === 'Legal')!),
    )
    current.artifacts.push(
      ...previous.artifacts.filter((artifact) => artifact.stepId === 'Legal'),
    )
    await service.refreshComparison(11, contextId)
    expect(await findings('Legal')).toMatchObject({
      ok: true,
      data: { resultState: 'current', workspaceRevision: 16 },
    })
  })

  it('reports an unstarted Step as a normal empty result', async () => {
    const { current, service, contextId, findings, readVerifiedArtifacts } =
      await harness()
    delete current.stalePredecessor
    await service.refreshComparison(11, contextId)
    expect(await findings('Legal')).toMatchObject({
      ok: true,
      data: {
        resultState: 'not-started',
        workspaceRevision: 15,
        details: { metrics: [] },
      },
    })
    expect(readVerifiedArtifacts).not.toHaveBeenCalled()
  })

  it('still verifies old artifacts and reports actual read failures', async () => {
    const { findings, readVerifiedArtifacts } = await harness()
    readVerifiedArtifacts.mockResolvedValue({
      ok: false,
      code: 'ARTIFACT_REVISION_MISMATCH',
      reference: 'legalization_dreamplace/analysis/qor_metrics.json',
    })
    expect(await findings('Legal')).toMatchObject({
      ok: false,
      code: 'ARTIFACT_REVISION_MISMATCH',
    })
  })
})
