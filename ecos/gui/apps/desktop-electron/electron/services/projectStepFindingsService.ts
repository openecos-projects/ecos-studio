import {
  parseProjectManifestFlowStep,
  type BackendProjectFindingsIssueCode,
  type BackendProjectStepFindings,
  type BackendProjectStepFindingsResult,
  type EccEngineeringAnalysisFile,
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
    artifacts: Array<{ reference: string; sha256: string; sizeBytes: number }>
  }): Promise<VerifiedProjectArtifactsReadResult>
}

export interface CommittedFindingsWorkspace {
  analysis: ProjectAnalysisSnapshot
  comparisonMetrics: Partial<Record<ProjectManifestFlowStep, ProjectQorMetricRecord[]>>
  engineeringSnapshot: Pick<
    EccPersistedEngineeringSnapshot,
    'analysis' | 'artifacts' | 'workspaceId' | 'workspaceRevision'
  >
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
    const analysisStep = workspace.engineeringSnapshot.analysis.steps.find(
      (candidate) => parseProjectManifestFlowStep(candidate.stepId) === step,
    )
    const details = workspace.analysis.steps[step]
    if (!analysisStep || !details) {
      return { ok: false, code: 'FINDINGS_STEP_UNAVAILABLE' }
    }
    const artifacts = declaredArtifacts(workspace.engineeringSnapshot, analysisStep, step)
    if (!artifacts.ok) return artifacts

    const generation = context.generation
    const key = cacheKey(request.projectComparisonContextId, workspace, step)
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

    const data: BackendProjectStepFindings = {
      details: {
        ...details,
        metrics: workspace.comparisonMetrics[step] ?? details.metrics,
      },
      engineeringWorkspaceId: workspace.engineeringSnapshot.workspaceId,
      projectWorkspaceId: request.projectWorkspaceId,
      step,
      workspaceRevision: workspace.engineeringSnapshot.workspaceRevision,
    }
    this.cache.set(key, data)
    if (this.cache.size > MAX_VERIFIED_FINDINGS_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!)
    }
    return {
      ok: true,
      projectComparisonContextId: request.projectComparisonContextId,
      generation,
      freshness: 'current',
      data,
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

function declaredArtifacts(
  snapshot: Pick<EccPersistedEngineeringSnapshot, 'artifacts'>,
  analysisStep: {
    hotspots: EccEngineeringAnalysisFile
    metrics: EccEngineeringAnalysisFile
    summary: EccEngineeringAnalysisFile
    timingIssues: EccEngineeringAnalysisFile | null
  },
  step: ProjectManifestFlowStep,
):
  | { ok: true; data: Array<{ reference: string; sha256: string; sizeBytes: number }> }
  | { ok: false; code: BackendProjectFindingsIssueCode } {
  const files = [analysisStep.metrics, analysisStep.summary, analysisStep.hotspots]
  if (step === 'STA' && analysisStep.timingIssues) files.push(analysisStep.timingIssues)
  const artifacts = []
  for (const file of files) {
    if (file.status !== 'available') {
      return { ok: false, code: 'ARTIFACT_REFERENCE_MISSING' }
    }
    const artifact = snapshot.artifacts.find(
      (candidate) =>
        candidate.artifactId === file.artifactId &&
        candidate.stepId !== undefined &&
        parseProjectManifestFlowStep(candidate.stepId) === step,
    )
    if (
      !artifact ||
      artifact.availability !== 'available' ||
      artifact.sizeBytes === undefined ||
      artifact.sha256 === undefined
    ) {
      return { ok: false, code: 'ARTIFACT_REFERENCE_MISSING' }
    }
    artifacts.push({
      reference: artifact.reference,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    })
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
