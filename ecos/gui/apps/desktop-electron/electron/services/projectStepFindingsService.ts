import {
  parseProjectManifestFlowStep,
  projectAnalysisArtifactPolicy,
  projectManagementWorkspaceStepAnalysisSpecs,
  type BackendProjectStepFindings,
  type BackendProjectStepFindingsResult,
  type EccEngineeringAnalysisArtifactRef,
  type EccPersistedEngineeringSnapshot,
  type ProjectAnalysisSnapshot,
  type ProjectAnalysisStepSnapshot,
  type ProjectManifestFlowStep,
  type ProjectAnalysisArtifactKind,
  type ProjectQorMetricRecord,
} from '@ecos-studio/shared'
import type { VerifiedProjectArtifactsReadResult } from './projectManagementReadService'
import { buildProjectAnalysisStepSnapshot } from './projectAnalysisSnapshot'

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
  workspaceName?: string
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

    const artifactIssues = uniqueArtifactIssues([
      ...artifacts.missing.map(({ reference }) => ({
        code: 'ARTIFACT_REFERENCE_MISSING' as const,
        reference,
      })),
      ...(read.issues ?? []),
    ])
    const resultData = {
      ...data,
      details: rehydrateDetails(
        data.details,
        artifacts.data,
        read.texts ?? {},
        source,
        request.projectWorkspaceId,
      ),
      ...(artifactIssues.length > 0 ? { artifactIssues } : {}),
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
): {
  data: DeclaredFindingsArtifact[]
  missing: Array<{ kind: FindingsArtifactKind; reference: string }>
} {
  const spec = projectManagementWorkspaceStepAnalysisSpecs.find(
    (candidate) => candidate.step === step,
  )
  if (!spec) return { data: [], missing: [] }
  const policy = projectAnalysisArtifactPolicy(step)
  const kinds = [...new Set([...policy.requiredKinds, ...policy.optionalKinds])]
  const policyRequired = new Set(policy.requiredKinds)
  const artifacts: DeclaredFindingsArtifact[] = []
  const missing: Array<{ kind: FindingsArtifactKind; reference: string }> = []
  for (const kind of kinds) {
    const artifact = findDeclaredArtifact(snapshot.artifacts, spec.eccStepIds, kind)
    if (artifact?.availability === 'available') {
      artifacts.push({ kind, reference: artifact.reference, stepId: artifact.stepId })
    } else if (artifact?.required ?? policyRequired.has(kind)) {
      missing.push({ kind, reference: artifact?.reference ?? specPath(spec, kind) })
    }
  }
  return { data: artifacts, missing }
}

function findDeclaredArtifact(
  artifacts: readonly EccEngineeringAnalysisArtifactRef[],
  eccStepIds: readonly string[],
  kind: FindingsArtifactKind,
): EccEngineeringAnalysisArtifactRef | undefined {
  let fallback: EccEngineeringAnalysisArtifactRef | undefined
  for (const stepId of eccStepIds) {
    const candidates = artifacts.filter(
      (artifact) => artifact.stepId === stepId && artifact.kind === kind,
    )
    const available = candidates.find((artifact) => artifact.availability === 'available')
    if (available) return available
    fallback ??= candidates[0]
  }
  return fallback
}

type FindingsArtifactKind = ProjectAnalysisArtifactKind

interface DeclaredFindingsArtifact {
  kind: FindingsArtifactKind
  reference: string
  stepId: string
}

function specPath(
  spec: (typeof projectManagementWorkspaceStepAnalysisSpecs)[number],
  kind: FindingsArtifactKind,
): string {
  if (kind === 'qor_metrics') return spec.metricsPath
  if (kind === 'qor_summary') return spec.summaryPath
  if (kind === 'qor_hotspots') return spec.hotspotsPath
  return 'sta_ecc/analysis/sta_timing_issues.json'
}

function rehydrateDetails(
  details: ProjectAnalysisStepSnapshot,
  artifacts: readonly DeclaredFindingsArtifact[],
  texts: Record<string, string>,
  workspace: CommittedFindingsResult & { workspaceName?: string },
  projectWorkspaceId: string,
): ProjectAnalysisStepSnapshot {
  const textFor = (kind: FindingsArtifactKind): string | undefined => {
    const artifact = artifacts.find((candidate) => candidate.kind === kind)
    return artifact ? texts[artifact.reference] : undefined
  }
  const hydrated = buildProjectAnalysisStepSnapshot({
    flowStatus: details.flowStatus,
    hotspotText: textFor('qor_hotspots'),
    metricsText: textFor('qor_metrics'),
    reportItems: details.reportItems,
    staTimingIssuesText: details.step === 'STA' ? textFor('sta_timing_issues') : null,
    step: details.step,
    summaryText: textFor('qor_summary'),
    workspaceId: workspace.engineeringSnapshot.workspaceId,
    workspaceName: workspace.workspaceName ?? projectWorkspaceId,
  })
  return {
    ...hydrated,
    metrics: hydrated.metrics.length > 0 ? hydrated.metrics : details.metrics,
  }
}

function uniqueArtifactIssues(
  issues: NonNullable<BackendProjectStepFindings['artifactIssues']>,
): NonNullable<BackendProjectStepFindings['artifactIssues']> {
  const unique = new Map<string, (typeof issues)[number]>()
  for (const issue of issues) unique.set(`${issue.code}\0${issue.reference}`, issue)
  return [...unique.values()]
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
