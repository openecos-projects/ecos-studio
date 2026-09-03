import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  parseProjectManifest,
  type BackendWorkspaceOverviewResult,
  type BackendWorkspaceArtifactRequest,
  type BackendWorkspaceArtifactResult,
  type BackendWorkspaceStepDetailRequest,
  type BackendWorkspaceStepDetailResult,
  type ProjectManifest,
  type ReadIssue,
  type ReadSection,
  type WorkspaceDashboardMetric,
  type WorkspaceFlowInsightsSummary,
  type WorkspaceOverviewCore,
  type WorkspaceBaselineComparison,
  type WorkspaceQorSummary,
} from '@ecos-studio/shared'
import { requireWindowScopeId } from './windowScopeContext'
import {
  analyzeWorkspaceQor,
  type WorkspaceEngineeringFacts,
} from './workspaceQorAnalysis'
import { electronLogger } from './logger'
import { workspaceDashboardMetrics } from './workspaceDashboardAnalysis'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import { artifactDescriptor, workspaceStepDetail } from './backendWorkspaceDetail'
import {
  readWorkspaceArtifact,
  type WorkspaceArtifactReader,
} from './backendWorkspaceArtifact'
import type {
  ProjectComparisonFileWatcher,
  ProjectComparisonFileWatcherCallbacks,
} from './projectComparisonFileWatcher'
import {
  checklistSection,
  configurationSection,
  flowSection,
  identityFromManifest,
  pathsEqual,
} from './backendWorkspaceOverviewProjection'
import { flowInsightsSection } from './backendWorkspaceFlowInsights'
import { isPathWithinRoot } from './pathScope'

interface BackendWorkspaceServiceOptions {
  workspaceRootProvider: {
    getProjectRoot(): Promise<string>
  }
  projectManagementReadService: {
    readManifest(projectRoot: string): Promise<string | null>
    readEngineeringSnapshot(request: {
      projectRoot: string
      workspacePath: string
    }): Promise<ProjectEngineeringSnapshotReadResult>
    readVerifiedArtifact?: WorkspaceArtifactReader
  }
  snapshotWatcherFactory?: (
    callbacks: ProjectComparisonFileWatcherCallbacks,
  ) => ProjectComparisonFileWatcher
}

interface WorkspaceContext {
  id: string
  generation: number
  cache?: BackendWorkspaceOverviewResult
  inFlight?: Promise<BackendWorkspaceOverviewResult>
  coalescedRequests: number
  snapshot?: ProjectEngineeringSnapshotReadResult
  workspaceRoot?: string
  watchKey?: string
  watchedRoots?: string[]
  watcher?: ProjectComparisonFileWatcher
  flowInsights?: ReadSection<WorkspaceFlowInsightsSummary>
  windowId: number
}

interface BuiltWorkspaceOverview {
  result: BackendWorkspaceOverviewResult
  snapshot: ProjectEngineeringSnapshotReadResult | null
  workspaceRoot: string
  watchedRoots: string[]
}

export interface BackendWorkspaceInvalidation {
  windowId: number
  workspaceContextId: string
  generation: number
}

const NOT_MIGRATED_ISSUE: ReadIssue = { code: 'BACKEND_SECTION_NOT_MIGRATED' }

function unavailable<T>(): ReadSection<T> {
  return { status: 'unavailable', issues: [NOT_MIGRATED_ISSUE] }
}

export class BackendWorkspaceService {
  private readonly contexts = new Map<number, WorkspaceContext>()
  private readonly invalidationListeners = new Set<
    (event: BackendWorkspaceInvalidation) => void
  >()

  constructor(private readonly options: BackendWorkspaceServiceOptions) {}

  async getOverview(): Promise<BackendWorkspaceOverviewResult> {
    const windowId = requireWindowScopeId()
    const context = this.contextForWindow(windowId)
    if (context.cache) return context.cache
    if (context.inFlight) {
      context.coalescedRequests += 1
      return await context.inFlight
    }

    const generation = context.generation
    let query: Promise<BackendWorkspaceOverviewResult>
    query = this.buildOverview(context, generation)
      .then(({ result, snapshot, workspaceRoot, watchedRoots }) => {
        const current = this.contexts.get(windowId)
        if (current === context && current.generation === generation) {
          current.cache = result
          current.flowInsights = result.overview.flowInsights
          if (snapshot?.ok || !current.snapshot) current.snapshot = snapshot ?? undefined
          current.workspaceRoot = workspaceRoot
          this.observeWorkspace(current, workspaceRoot, watchedRoots)
          current.coalescedRequests = 0
        }
        return result
      })
      .finally(() => {
        if (context.inFlight === query) context.inFlight = undefined
      })
    context.inFlight = query
    return await query
  }

  async refreshOverview(): Promise<BackendWorkspaceOverviewResult> {
    const windowId = requireWindowScopeId()
    this.invalidateWindow(windowId, false)
    return await this.getOverview()
  }

  async checkForUpdates(windowId: number): Promise<void> {
    const context = this.contexts.get(windowId)
    if (!context?.workspaceRoot || !context.snapshot?.ok) return
    const latest = await this.readEngineeringSnapshot(context.workspaceRoot)
    if (
      latest?.ok &&
      (latest.snapshot.workspaceId !== context.snapshot.snapshot.workspaceId ||
        latest.snapshot.workspaceRevision !== context.snapshot.snapshot.workspaceRevision)
    ) {
      this.invalidateWindow(windowId)
    }
  }

  async getStepDetail(
    request: BackendWorkspaceStepDetailRequest,
  ): Promise<BackendWorkspaceStepDetailResult> {
    const context = this.contextForWindow(requireWindowScopeId())
    if (
      !request ||
      typeof request.stepId !== 'string' ||
      !request.stepId.trim() ||
      typeof request.workspaceContextId !== 'string' ||
      !Number.isSafeInteger(request.workspaceRevision) ||
      request.workspaceRevision < 1
    ) {
      return this.unavailableStepDetail(context, 'BACKEND_WORKSPACE_REQUEST_INVALID')
    }
    if (request.workspaceContextId !== context.id) {
      return this.unavailableStepDetail(context, 'BACKEND_WORKSPACE_CONTEXT_MISMATCH')
    }
    if (!context.snapshot) await this.getOverview()
    const snapshot = context.snapshot
    if (!snapshot?.ok) {
      return this.unavailableStepDetail(
        context,
        snapshot?.issue.code ?? 'ENGINEERING_SNAPSHOT_READ_FAILED',
      )
    }
    if (snapshot.snapshot.workspaceRevision !== request.workspaceRevision) {
      return this.unavailableStepDetail(
        context,
        'ENGINEERING_SNAPSHOT_REVISION_MISMATCH',
        snapshot,
      )
    }
    const flow = flowSection(snapshot)
    const checklist = checklistSection(snapshot, flow)
    const insights = context.flowInsights
    return {
      detail: workspaceStepDetail(
        snapshot,
        request.stepId,
        flow,
        checklist,
        insights?.status === 'ready' || insights?.status === 'partial'
          ? insights.data
          : null,
      ),
      generation: context.generation,
      workspaceContextId: context.id,
      workspaceId: snapshot.snapshot.workspaceId,
      workspaceRevision: snapshot.snapshot.workspaceRevision,
    }
  }

  async getArtifact(
    request: BackendWorkspaceArtifactRequest,
  ): Promise<BackendWorkspaceArtifactResult> {
    const context = this.contextForWindow(requireWindowScopeId())
    const unavailable = (code: string): BackendWorkspaceArtifactResult => ({
      artifact: { status: 'unavailable', issues: [{ code }] },
      generation: context.generation,
      workspaceContextId: context.id,
      ...(context.snapshot?.ok
        ? {
            workspaceId: context.snapshot.snapshot.workspaceId,
            workspaceRevision: context.snapshot.snapshot.workspaceRevision,
          }
        : {}),
    })
    if (
      !request ||
      typeof request.artifactId !== 'string' ||
      !request.artifactId ||
      typeof request.workspaceContextId !== 'string' ||
      !Number.isSafeInteger(request.workspaceRevision) ||
      request.workspaceRevision < 1
    ) {
      return unavailable('BACKEND_WORKSPACE_REQUEST_INVALID')
    }
    if (request.workspaceContextId !== context.id) {
      return unavailable('BACKEND_WORKSPACE_CONTEXT_MISMATCH')
    }
    const snapshot = context.snapshot
    if (!snapshot?.ok || !context.workspaceRoot) {
      return unavailable('ENGINEERING_SNAPSHOT_READ_FAILED')
    }
    if (snapshot.snapshot.workspaceRevision !== request.workspaceRevision) {
      return unavailable('ENGINEERING_SNAPSHOT_REVISION_MISMATCH')
    }
    return {
      artifact: await readWorkspaceArtifact(
        snapshot,
        context.workspaceRoot,
        request.artifactId,
        this.options.projectManagementReadService.readVerifiedArtifact
          ? (artifactRequest) =>
              this.options.projectManagementReadService.readVerifiedArtifact!(
                artifactRequest,
              )
          : undefined,
      ),
      generation: context.generation,
      workspaceContextId: context.id,
      workspaceId: snapshot.snapshot.workspaceId,
      workspaceRevision: snapshot.snapshot.workspaceRevision,
    }
  }

  invalidateWindow(windowId: number, notify = true): void {
    const context = this.contexts.get(windowId)
    if (!context) return
    context.generation += 1
    context.cache = undefined
    context.inFlight = undefined
    if (notify) {
      const event = {
        generation: context.generation,
        windowId,
        workspaceContextId: context.id,
      }
      for (const listener of this.invalidationListeners) listener(event)
    }
  }

  onInvalidated(listener: (event: BackendWorkspaceInvalidation) => void): () => void {
    this.invalidationListeners.add(listener)
    return () => this.invalidationListeners.delete(listener)
  }

  clearWindow(windowId: number): void {
    const context = this.contexts.get(windowId)
    this.contexts.delete(windowId)
    void context?.watcher?.close()
  }

  private contextForWindow(windowId: number): WorkspaceContext {
    const existing = this.contexts.get(windowId)
    if (existing) return existing
    const context = {
      id: randomUUID(),
      generation: 0,
      coalescedRequests: 0,
      windowId,
    }
    this.contexts.set(windowId, context)
    return context
  }

  private async buildOverview(
    context: WorkspaceContext,
    generation: number,
  ): Promise<BuiltWorkspaceOverview> {
    const startedAt = performance.now()
    const eventLoopDelay = eventLoopDelayMs()
    const readStartedAt = performance.now()
    const previousSnapshot = context.snapshot
    const previousWorkspaceRoot = context.workspaceRoot
    const workspaceRoot = await this.options.workspaceRootProvider.getProjectRoot()
    const [manifest, snapshot] = await Promise.all([
      this.readManifest(workspaceRoot),
      this.readEngineeringSnapshot(workspaceRoot),
    ])
    if (!manifest && previousSnapshot?.ok && previousWorkspaceRoot) {
      throw new Error('PROJECT_MANIFEST_READ_FAILED')
    }
    const projectRoot = dirname(workspaceRoot)
    const baseline = manifest?.workspaces.find(
      (workspace) => workspace.workspace_id === manifest.qor_baseline?.workspace_id,
    )
    const baselineRoot = baseline ? resolve(baseline.workspace_path) : null
    const watchedRoots = [
      workspaceRoot,
      ...(baselineRoot &&
      baselineRoot !== projectRoot &&
      isPathWithinRoot(baselineRoot, projectRoot) &&
      !pathsEqual(baselineRoot, workspaceRoot)
        ? [baselineRoot]
        : []),
    ]
    if (!snapshot?.ok && previousSnapshot?.ok) {
      throw new Error(snapshot?.issue.code ?? 'ENGINEERING_SNAPSHOT_READ_FAILED')
    }
    if (
      snapshot?.ok &&
      previousSnapshot?.ok &&
      previousWorkspaceRoot &&
      pathsEqual(workspaceRoot, previousWorkspaceRoot)
    ) {
      if (snapshot.snapshot.workspaceId !== previousSnapshot.snapshot.workspaceId) {
        throw new Error('ENGINEERING_WORKSPACE_ID_MISMATCH')
      }
      if (
        snapshot.snapshot.workspaceRevision < previousSnapshot.snapshot.workspaceRevision
      ) {
        throw new Error('ENGINEERING_SNAPSHOT_REVISION_REGRESSION')
      }
    }
    const flow = flowSection(snapshot)
    const checklist = checklistSection(snapshot, flow)
    const qor = await this.readQor(workspaceRoot, manifest, snapshot)
    const flowInsights = flowInsightsSection(snapshot, flow, qor.qor)
    const keyMetrics = this.readKeyMetrics(qor.qor)
    const readMs = performance.now() - readStartedAt
    const normalizeStartedAt = performance.now()
    const overview: WorkspaceOverviewCore = {
      revision: snapshot?.ok
        ? {
            status: 'ready',
            data: {
              workspaceId: snapshot.snapshot.workspaceId,
              workspaceRevision: snapshot.snapshot.workspaceRevision,
            },
            issues: [],
          }
        : {
            status: 'unavailable',
            issues: [snapshot?.issue ?? { code: 'ENGINEERING_SNAPSHOT_READ_FAILED' }],
          },
      artifacts:
        snapshot?.ok && snapshot.sections.artifacts.status === 'ready'
          ? {
              status: 'ready',
              data: {
                items: snapshot.sections.artifacts.data.map(artifactDescriptor),
              },
              issues: [],
            }
          : {
              status: 'unavailable',
              issues:
                snapshot?.ok && snapshot.sections.artifacts.status !== 'ready'
                  ? snapshot.sections.artifacts.issues
                  : snapshot && !snapshot.ok
                    ? [snapshot.issue]
                    : [{ code: 'ENGINEERING_ARTIFACT_INVALID' }],
            },
      identity: identityFromManifest(workspaceRoot, manifest),
      configuration: configurationSection(snapshot),
      flow,
      flowInsights,
      checklist,
      qor: qor.qor,
      keyMetrics,
      baselineComparison: qor.baselineComparison,
    }
    const result = {
      workspaceContextId: context.id,
      generation,
      overview,
    }
    electronLogger.debug('[backend-workspace] query metrics', {
      baselineSnapshotReads:
        manifest?.qor_baseline?.workspace_id &&
        manifest.qor_baseline.workspace_id !== overview.identity.workspaceId
          ? 1
          : 0,
      coalescedRequests: context.coalescedRequests,
      eventLoopDelayMs: roundMs(await eventLoopDelay),
      snapshotFileCount: snapshot ? 1 : 0,
      snapshotBytes: snapshot?.readBytes ?? 0,
      ipcPayloadBytes: Buffer.byteLength(JSON.stringify(result)),
      normalizeMs: roundMs(performance.now() - normalizeStartedAt),
      readMs: roundMs(readMs),
      totalMs: roundMs(performance.now() - startedAt),
    })
    return { result, snapshot, workspaceRoot, watchedRoots }
  }

  private async readManifest(workspaceRoot: string): Promise<ProjectManifest | null> {
    try {
      const content = await this.options.projectManagementReadService.readManifest(
        dirname(workspaceRoot),
      )
      return content ? parseProjectManifest(content) : null
    } catch {
      return null
    }
  }

  private async readEngineeringSnapshot(
    workspaceRoot: string,
  ): Promise<ProjectEngineeringSnapshotReadResult | null> {
    try {
      return await this.options.projectManagementReadService.readEngineeringSnapshot({
        projectRoot: dirname(workspaceRoot),
        workspacePath: workspaceRoot,
      })
    } catch {
      return null
    }
  }

  private async readQor(
    workspaceRoot: string,
    manifest: ProjectManifest | null,
    snapshot: ProjectEngineeringSnapshotReadResult | null,
  ): Promise<{
    qor: ReadSection<WorkspaceQorSummary>
    baselineComparison: ReadSection<WorkspaceBaselineComparison>
  }> {
    const currentWorkspace = manifest?.workspaces.find((workspace) =>
      pathsEqual(workspace.workspace_path, workspaceRoot),
    )
    if (!manifest || !currentWorkspace) {
      return { qor: unavailable(), baselineComparison: unavailable() }
    }

    const baselineWorkspaceId = manifest.qor_baseline?.workspace_id
    const requestedIds = [
      currentWorkspace.workspace_id,
      ...(baselineWorkspaceId && baselineWorkspaceId !== currentWorkspace.workspace_id
        ? [baselineWorkspaceId]
        : []),
    ]
    const snapshotsByWorkspaceId: Record<string, WorkspaceEngineeringFacts | null> = {}
    const failedIds = new Set<string>()
    await Promise.all(
      requestedIds.map(async (workspaceId) => {
        const workspace = manifest.workspaces.find(
          (candidate) => candidate.workspace_id === workspaceId,
        )
        if (!workspace) {
          failedIds.add(workspaceId)
          return
        }
        const projectRoot = dirname(workspaceRoot)
        const candidate = resolve(workspace.workspace_path)
        if (candidate === projectRoot || !isPathWithinRoot(candidate, projectRoot)) {
          failedIds.add(workspaceId)
          return
        }
        if (workspaceId === currentWorkspace.workspace_id && snapshot) {
          snapshotsByWorkspaceId[workspaceId] = engineeringFacts(snapshot)
          if (!snapshotsByWorkspaceId[workspaceId]) failedIds.add(workspaceId)
          return
        }
        try {
          snapshotsByWorkspaceId[workspaceId] = engineeringFacts(
            await this.readEngineeringSnapshot(workspace.workspace_path),
          )
          if (!snapshotsByWorkspaceId[workspaceId]) failedIds.add(workspaceId)
        } catch {
          snapshotsByWorkspaceId[workspaceId] = null
          failedIds.add(workspaceId)
        }
      }),
    )
    if (failedIds.has(currentWorkspace.workspace_id)) {
      return {
        qor: {
          status: 'unavailable',
          issues: [{ code: 'WORKSPACE_QOR_UNAVAILABLE' }],
        },
        baselineComparison: {
          status: 'unavailable',
          issues: [{ code: 'WORKSPACE_BASELINE_UNAVAILABLE' }],
        },
      }
    }

    const result = analyzeWorkspaceQor(
      manifest,
      currentWorkspace.workspace_id,
      snapshotsByWorkspaceId,
    )
    if (baselineWorkspaceId && failedIds.has(baselineWorkspaceId)) {
      result.baselineComparison = {
        status: 'unavailable',
        issues: [{ code: 'WORKSPACE_BASELINE_UNAVAILABLE' }],
      }
    }
    return result
  }

  private readKeyMetrics(
    qor: ReadSection<WorkspaceQorSummary>,
  ): ReadSection<{ items: WorkspaceDashboardMetric[] }> {
    const metrics =
      qor.status === 'ready' || qor.status === 'partial' ? qor.data.metrics : []
    return {
      status: 'ready',
      data: {
        items: workspaceDashboardMetrics(metrics),
      },
      issues: [],
    }
  }

  private observeWorkspace(
    context: WorkspaceContext,
    workspaceRoot: string,
    watchedRoots: string[],
  ): void {
    const createWatcher = this.options.snapshotWatcherFactory
    const watchKey = watchedRoots
      .map((root) => resolve(root))
      .sort()
      .join('\0')
    if (!createWatcher || context.watchKey === watchKey) return
    void context.watcher?.close()
    const watcher = createWatcher({
      onError: (error) =>
        electronLogger.warn('[backend-workspace] snapshot watcher failed', error),
      onManifestChanged: () => this.invalidateWindow(context.windowId),
      onSnapshotChanged: (changedRoot) => {
        if (context.watchedRoots?.some((root) => pathsEqual(changedRoot, root))) {
          this.invalidateWindow(context.windowId)
        }
      },
    })
    context.watcher = watcher
    context.watchKey = watchKey
    context.watchedRoots = watchedRoots
    void Promise.all([
      watcher.startProject(dirname(workspaceRoot)),
      watcher.reconcile(dirname(workspaceRoot), watchedRoots),
    ]).catch((error) => {
      if (context.watcher === watcher) {
        context.watcher = undefined
        context.watchKey = undefined
        context.watchedRoots = undefined
      }
      void watcher.close()
      electronLogger.warn('[backend-workspace] snapshot watcher start failed', error)
    })
  }

  private unavailableStepDetail(
    context: WorkspaceContext,
    code: string,
    snapshot?: ProjectEngineeringSnapshotReadResult,
  ): BackendWorkspaceStepDetailResult {
    return {
      detail: { status: 'unavailable', issues: [{ code }] },
      generation: context.generation,
      workspaceContextId: context.id,
      ...(snapshot?.ok
        ? {
            workspaceId: snapshot.snapshot.workspaceId,
            workspaceRevision: snapshot.snapshot.workspaceRevision,
          }
        : {}),
    }
  }
}

function engineeringFacts(
  result: ProjectEngineeringSnapshotReadResult | null,
): WorkspaceEngineeringFacts | null {
  if (!result?.ok || result.sections.qor.status !== 'ready') return null
  const flow = result.sections.flow
  const signoff = result.sections.signoff
  return {
    ...result.sections.qor.data,
    ...(flow.status === 'ready' ? { flow: flow.data } : {}),
    ...(signoff.status === 'ready' ? { signoffAssessment: signoff.data } : {}),
  }
}

function eventLoopDelayMs(): Promise<number> {
  const startedAt = performance.now()
  return new Promise((resolveDelay) => {
    setImmediate(() => resolveDelay(performance.now() - startedAt))
  })
}

function roundMs(value: number): number {
  return Number(value.toFixed(2))
}
