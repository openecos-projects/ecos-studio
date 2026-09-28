import {
  parseProjectManifestFlowStep,
  type BackendProjectFindingsIssueCode,
  type BackendProjectStepFindings,
  type BackendProjectStepFindingsResult,
  type EccEngineeringAnalysisArtifactRef,
  type EccPersistedEngineeringSnapshot,
  type ProjectAnalysisSnapshot,
  type ProjectManifestFlowStep,
  type ProjectQorMetricRecord,
} from '@ecos-studio/shared'
import type { VerifiedProjectArtifactsReadResult } from './projectManagementReadService'

interface FindingsArtifactReader {
  readVerifiedArtifacts(request: {
    projectRoot: string
    workspacePath: string
    artifacts: Array<{ reference: string }>
  }): Promise<VerifiedProjectArtifactsReadResult>
}

export interface CommittedFindingsResult {
  analysis: ProjectAnalysisSnapshot
  comparisonMetrics: Partial<Record<ProjectManifestFlowStep, ProjectQorMetricRecord[]>>
  engineeringSnapshot: Pick<
    EccPersistedEngineeringSnapshot,
    'artifacts' | 'workspaceId' | 'workspaceRevision'
  >
}

export interface CommittedFindingsWorkspace extends CommittedFindingsResult {
  previous?: CommittedFindingsResult
  projectWorkspaceId: string
  workspacePath: string
}

interface FindingsContext {
  generation: number
  projectRoot: string
  ready: boolean
  windowId: number
  workspaces: Map<string, CommittedFindingsWorkspace>
}

const MAX_VERIFIED_FINDINGS_CACHE_ENTRIES = 128

export class ProjectStepFindingsService {
  private readonly contexts = new Map<string, FindingsContext>()
  private readonly cache = new Map<string, BackendProjectStepFindings>()

  constructor(private readonly reader: FindingsArtifactReader) {}

  register(windowId: number, contextId: string, projectRoot: string): void {
    this.contexts.set(contextId, {
      generation: 0,
      projectRoot,
      ready: false,
      windowId,
      workspaces: new Map(),
    })
  }

  unregister(contextId: string): void {
    this.contexts.delete(contextId)
    this.clearContextCache(contextId)
  }

  invalidate(contextId: string, generation: number): void {
    const context = this.contexts.get(contextId)
    if (!context) return
    context.generation = generation
    context.ready = false
    this.clearContextCache(contextId)
  }

  refreshArtifacts(contextId: string): void {
    this.clearContextCache(contextId)
  }

  commit(
    contextId: string,
    generation: number,
    workspaces: CommittedFindingsWorkspace[],
  ): void {
    const context = this.contexts.get(contextId)
    if (!context || context.generation !== generation) return
    context.workspaces = new Map(
      workspaces.map((workspace) => [workspace.projectWorkspaceId, workspace]),
    )
    context.ready = true
  }

  async get(
    windowId: number,
    request: {
      projectComparisonContextId: string
      projectWorkspaceId: string
      step: string
    },
  ): Promise<BackendProjectStepFindingsResult> {
    const context = this.contexts.get(request.projectComparisonContextId)
    if (!context || context.windowId !== windowId) {
      return { ok: false, code: 'unknown-context' }
    }
    if (!context.ready) {
      return { ok: false, code: 'FINDINGS_SNAPSHOT_REVISION_CHANGED' }
    }
    const workspace = context.workspaces.get(request.projectWorkspaceId)
    if (!workspace) return { ok: false, code: 'FINDINGS_WORKSPACE_UNAVAILABLE' }
    const step = parseProjectManifestFlowStep(request.step)
    if (!step) return { ok: false, code: 'FINDINGS_STEP_UNAVAILABLE' }
    const currentWorkspaceRevision = workspace.engineeringSnapshot.workspaceRevision
    const pending = workspace.analysis.resultState?.pendingStepIds.includes(step) ?? false
    const source =
      pending &&
      workspace.previous &&
      hasCommittedStepResults(workspace.previous.engineeringSnapshot, step)
        ? workspace.previous
        : workspace
    const hasResults = hasCommittedStepResults(source.engineeringSnapshot, step)
    const details = source.analysis.steps[step]
    if (!details || (!hasResults && details.flowStatus === undefined)) {
      return { ok: false, code: 'FINDINGS_STEP_UNAVAILABLE' }
    }
    const data: BackendProjectStepFindings = {
      details: { ...details, metrics: source.comparisonMetrics[step] ?? details.metrics },
      engineeringWorkspaceId: source.engineeringSnapshot.workspaceId,
      projectWorkspaceId: request.projectWorkspaceId,
      step,
      workspaceRevision: source.engineeringSnapshot.workspaceRevision,
      currentWorkspaceRevision,
      resultState:
        source !== workspace
          ? 'stale'
          : pending
            ? 'pending-rerun'
            : details.flowStatus === 'unstart' && !hasResults
              ? 'not-started'
              : 'current',
    }
    if (!hasResults) {
      return {
        ok: true,
        projectComparisonContextId: request.projectComparisonContextId,
        generation: context.generation,
        freshness: 'current',
        data,
      }
    }
    const artifacts = declaredArtifacts(source.engineeringSnapshot, step)
    if (!artifacts.ok) return artifacts

    const generation = context.generation
    const key = cacheKey(
      request.projectComparisonContextId,
      { ...workspace, ...source },
      step,
    )
    const read = await this.reader.readVerifiedArtifacts({
      artifacts: artifacts.data,
      projectRoot: context.projectRoot,
      workspacePath: workspace.workspacePath,
    })
    if (
      this.contexts.get(request.projectComparisonContextId) !== context ||
      !context.ready ||
      context.generation !== generation
    ) {
      return { ok: false, code: 'FINDINGS_SNAPSHOT_REVISION_CHANGED' }
    }
    if (!read.ok) return this.readFailure(read, key, context, request)

    const resultData = {
      ...data,
      ...(read.issues && read.issues.length > 0
        ? {
            artifactIssues: read.issues.map((issue) => ({
              code: issue.code,
              reference: issue.reference,
            })),
          }
        : {}),
    }
    this.cache.set(key, resultData)
    if (this.cache.size > MAX_VERIFIED_FINDINGS_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!)
    }
    return {
      ok: true,
      projectComparisonContextId: request.projectComparisonContextId,
      generation,
      freshness: 'current',
      data: resultData,
    }
  }

  private readFailure(
    read: Exclude<VerifiedProjectArtifactsReadResult, { ok: true }>,
    key: string,
    context: FindingsContext,
    request: { projectComparisonContextId: string },
  ): BackendProjectStepFindingsResult {
    const cached = this.cache.get(key)
    if (cached) {
      return {
        ok: true,
        projectComparisonContextId: request.projectComparisonContextId,
        generation: context.generation,
        freshness: 'last-committed',
        data: cached,
        issue: { code: read.code, detail: read.reference },
      }
    }
    return {
      ok: false,
      code: read.code,
      ...(read.reference ? { detail: read.reference } : {}),
    }
  }

  private clearContextCache(contextId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${contextId}\0`)) this.cache.delete(key)
    }
  }
}

function hasCommittedStepResults(
  snapshot: Pick<EccPersistedEngineeringSnapshot, 'artifacts'>,
  step: ProjectManifestFlowStep,
): boolean {
  return snapshot.artifacts.some(
    (artifact) =>
      artifact.kind === 'qor_metrics' &&
      artifact.availability === 'available' &&
      parseProjectManifestFlowStep(artifact.stepId) === step,
  )
}

function declaredArtifacts(
  snapshot: Pick<EccPersistedEngineeringSnapshot, 'artifacts'>,
  step: ProjectManifestFlowStep,
):
  | { ok: true; data: Array<{ reference: string }> }
  | { ok: false; code: BackendProjectFindingsIssueCode } {
  const kinds = ['qor_metrics', 'qor_summary', 'qor_hotspots']
  if (step === 'STA') kinds.push('sta_timing_issues')
  const artifacts: Array<{ reference: string }> = []
  for (const kind of kinds) {
    const artifact = snapshot.artifacts.find(
      (candidate: EccEngineeringAnalysisArtifactRef) =>
        candidate.kind === kind &&
        candidate.availability === 'available' &&
        parseProjectManifestFlowStep(candidate.stepId) === step,
    )
    if (!artifact) {
      return { ok: false, code: 'ARTIFACT_REFERENCE_MISSING' }
    }
    artifacts.push({ reference: artifact.reference })
  }
  return { ok: true, data: artifacts }
}

function cacheKey(
  contextId: string,
  workspace: CommittedFindingsWorkspace,
  step: ProjectManifestFlowStep,
): string {
  return [
    contextId,
    workspace.projectWorkspaceId,
    workspace.engineeringSnapshot.workspaceId,
    workspace.engineeringSnapshot.workspaceRevision,
    step,
  ].join('\0')
}
