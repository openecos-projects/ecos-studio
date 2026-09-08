import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  type BackendProjectComparison,
  type BackendProjectComparisonInvalidatedEvent,
  type BackendProjectComparisonQueryResult,
  type BackendProjectComparisonSelectResult,
  type BackendProjectExecutionSnapshotResult,
  type BackendProjectStepFindingsResult,
  type EccRuntimeOperation,
  type ProjectManifest,
  type ReadIssue,
} from '@ecos-studio/shared'
import { projectQorInputForWorkspace, workspaceFlowStates } from './workspaceQorAnalysis'
import { electronLogger } from './logger'
import { isPathWithinRoot } from './pathScope'
import { mapWithConcurrency } from './boundedConcurrency'
import type {
  ProjectEngineeringSnapshotReadResult,
  VerifiedProjectArtifactsReadResult,
} from './projectManagementReadService'
import {
  ProjectComparisonFileWatcher,
  type ProjectComparisonFileWatcherCallbacks,
} from './projectComparisonFileWatcher'
import {
  ProjectExecutionOverlay,
  type CommittedProjectWorkspace,
} from './projectExecutionOverlay'
import { ProjectStepFindingsService } from './projectStepFindingsService'
import { projectComparisonEvidence } from './projectComparisonEvidence'
import {
  analysisTextsFromSnapshot,
  buildProjectComparisonSnapshots,
  buildProjectComparisonSteps,
  buildProjectComparisonTrend,
  comparisonSection,
  selectRecommendation,
  type ProjectComparisonInput,
  workspaceIssue,
} from './projectComparisonProjection'

interface ProjectComparisonReader {
  resolveProjectRoot?(projectRoot: string): Promise<string>
  readManifest(projectRoot: string): Promise<ProjectManifest | null>
  readEngineeringSnapshot(request: {
    projectRoot: string
    workspacePath: string
  }): Promise<ProjectEngineeringSnapshotReadResult>
  readVerifiedArtifacts?(request: {
    projectRoot: string
    workspacePath: string
    artifacts: Array<{ reference: string; sha256: string; sizeBytes: number }>
  }): Promise<VerifiedProjectArtifactsReadResult>
}

interface ProjectComparisonContext {
  id: string
  windowId: number
  projectRoot: string
  generation: number
  dependencies: Set<string>
  cache: BackendProjectComparisonQueryResult | null
  inFlight: Promise<BackendProjectComparisonQueryResult> | null
  coalescedRequests: number
  engineeringWorkspaceIds: Map<string, string>
  manifestFingerprint: string
  snapshotCache: Map<string, ProjectEngineeringSnapshotReadResult>
  watcher: ProjectComparisonFileWatcher
  watcherIssue: ReadIssue | null
}

interface WorkspaceComparisonEntry {
  engineeringWorkspaceId?: string
  executionWorkspace?: CommittedProjectWorkspace
  identityKey?: string
  input?: ProjectComparisonInput
  issues: ReadIssue[]
}

type ProjectComparisonFileWatcherFactory = (
  callbacks: ProjectComparisonFileWatcherCallbacks,
) => ProjectComparisonFileWatcher

type InvalidationListener = (
  windowId: number,
  event: BackendProjectComparisonInvalidatedEvent,
) => void

export class BackendProjectComparisonService {
  private readonly contextsByWindow = new Map<number, ProjectComparisonContext>()
  private readonly listeners = new Set<InvalidationListener>()
  private readonly execution: ProjectExecutionOverlay
  private readonly findings: ProjectStepFindingsService

  constructor(
    private readonly reader: ProjectComparisonReader,
    private readonly createWatcher: ProjectComparisonFileWatcherFactory = (callbacks) =>
      new ProjectComparisonFileWatcher(callbacks),
    activeOperations: () => EccRuntimeOperation[] = () => [],
  ) {
    this.execution = new ProjectExecutionOverlay(activeOperations)
    this.findings = new ProjectStepFindingsService({
      readVerifiedArtifacts: (request) =>
        this.reader.readVerifiedArtifacts?.(request) ??
        Promise.resolve({ ok: false, code: 'FINDINGS_READ_FAILED', reference: '' }),
    })
  }

  async selectProject(
    windowId: number,
    request: { projectRootLocator: string },
  ): Promise<BackendProjectComparisonSelectResult> {
    const previous = this.contextsByWindow.get(windowId)
    if (previous) {
      this.contextsByWindow.delete(windowId)
      this.execution.unregister(previous.id)
      this.findings.unregister(previous.id)
      await previous.watcher.close()
    }
    let watcher: ProjectComparisonFileWatcher | null = null
    try {
      const projectRoot = await (this.reader.resolveProjectRoot ?? realpath)(
        request.projectRootLocator,
      )
      let context: ProjectComparisonContext | null = null
      let manifestChangedBeforeRead = false
      let watcherIssue: ReadIssue | null = null
      watcher = this.createWatcher({
        onError: () => {
          watcherIssue = autoRefreshIssue()
          if (context) this.markWatcherUnavailable(context)
        },
        onManifestChanged: () => {
          if (context) void this.handleManifestChanged(context)
          else manifestChangedBeforeRead = true
        },
        onSnapshotChanged: (workspaceRoot) => {
          if (context) void this.handleSnapshotChanged(context, workspaceRoot)
        },
      })
      try {
        await watcher.startProject(projectRoot)
      } catch {
        watcherIssue = autoRefreshIssue()
      }
      let manifest: ProjectManifest
      do {
        manifestChangedBeforeRead = false
        manifest = await this.readManifest(projectRoot)
      } while (manifestChangedBeforeRead)
      context = {
        id: randomUUID(),
        windowId,
        projectRoot,
        generation: 0,
        dependencies: new Set(
          manifest.workspaces.map((workspace) => resolve(workspace.workspace_path)),
        ),
        cache: null,
        inFlight: null,
        coalescedRequests: 0,
        engineeringWorkspaceIds: new Map(),
        manifestFingerprint: manifestFingerprint(manifest),
        snapshotCache: new Map(),
        watcher,
        watcherIssue,
      }
      try {
        await watcher.reconcile(
          projectRoot,
          manifest.workspaces.map((workspace) => workspace.workspace_path),
        )
      } catch {
        context.watcherIssue = autoRefreshIssue()
      }
      this.contextsByWindow.set(windowId, context)
      this.execution.register(windowId, context.id)
      this.findings.register(windowId, context.id, projectRoot)
      return {
        ok: true,
        projectComparisonContextId: context.id,
        generation: context.generation,
      }
    } catch (error) {
      await watcher?.close()
      return failure('invalid-project', error)
    }
  }

  getComparison(
    windowId: number,
    projectComparisonContextId: string,
  ): Promise<BackendProjectComparisonQueryResult> {
    const context = this.context(windowId, projectComparisonContextId)
    if (!context) return Promise.resolve({ ok: false, code: 'unknown-context' })
    if (context.cache) return Promise.resolve(context.cache)
    if (context.inFlight) {
      context.coalescedRequests += 1
      return context.inFlight
    }

    const generation = context.generation
    const query = this.buildComparison(context, generation).then((result) => {
      if (this.isCurrent(context, generation)) context.cache = result
      return result
    })
    const inFlight = query.finally(() => {
      if (context.inFlight === inFlight) context.inFlight = null
    })
    context.inFlight = inFlight
    return inFlight
  }

  refreshComparison(
    windowId: number,
    projectComparisonContextId: string,
  ): Promise<BackendProjectComparisonQueryResult> {
    const context = this.context(windowId, projectComparisonContextId)
    if (!context) return Promise.resolve({ ok: false, code: 'unknown-context' })
    context.snapshotCache.clear()
    context.generation += 1
    this.findings.invalidate(context.id, context.generation)
    context.cache = null
    context.inFlight = null
    return this.getComparison(windowId, projectComparisonContextId)
  }

  getExecutionSnapshot(
    windowId: number,
    projectComparisonContextId: string,
  ): Promise<BackendProjectExecutionSnapshotResult> {
    return Promise.resolve(this.execution.get(windowId, projectComparisonContextId))
  }

  getStepFindings(
    windowId: number,
    request: {
      projectComparisonContextId: string
      projectWorkspaceId: string
      step: string
    },
  ): Promise<BackendProjectStepFindingsResult> {
    return this.findings.get(windowId, request)
  }

  invalidateExecution(): void {
    this.execution.invalidate()
  }

  onExecutionInvalidated(
    listener: Parameters<ProjectExecutionOverlay['onInvalidated']>[0],
  ): () => void {
    return this.execution.onInvalidated(listener)
  }

  invalidateWorkspace(workspaceRoot: string): void {
    const dependency = resolve(workspaceRoot)
    for (const context of this.contextsByWindow.values()) {
      if (
        ![...context.dependencies].some(
          (root) => dependency === root || dependency.startsWith(`${root}/`),
        )
      )
        continue
      for (const root of context.dependencies) {
        if (dependency === root || dependency.startsWith(`${root}/`)) {
          context.snapshotCache.delete(root)
        }
      }
      this.invalidateContext(context)
    }
  }

  invalidateProject(projectRoot: string): void {
    const root = resolve(projectRoot)
    for (const context of this.contextsByWindow.values()) {
      if (context.projectRoot !== root) continue
      this.invalidateContext(context)
    }
  }

  private invalidateContext(context: ProjectComparisonContext): void {
    context.generation += 1
    this.findings.invalidate(context.id, context.generation)
    context.cache = null
    context.inFlight = null
    const event = {
      projectComparisonContextId: context.id,
      generation: context.generation,
    }
    for (const listener of this.listeners) listener(context.windowId, event)
  }

  onInvalidated(listener: InvalidationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async closeProject(
    windowId: number,
    projectComparisonContextId: string,
  ): Promise<void> {
    const context = this.context(windowId, projectComparisonContextId)
    if (!context) return
    this.contextsByWindow.delete(windowId)
    this.execution.unregister(context.id)
    this.findings.unregister(context.id)
    await context.watcher.close()
  }

  disposeWindow(windowId: number): void {
    const context = this.contextsByWindow.get(windowId)
    this.contextsByWindow.delete(windowId)
    if (context) {
      this.execution.unregister(context.id)
      this.findings.unregister(context.id)
      void context.watcher.close()
    }
  }

  async checkForUpdates(windowId: number): Promise<void> {
    const context = this.contextsByWindow.get(windowId)
    if (!context || (await this.handleManifestChanged(context))) return
    await Promise.all(
      [...context.dependencies].map((workspaceRoot) =>
        this.handleSnapshotChanged(context, workspaceRoot),
      ),
    )
  }

  private context(windowId: number, id: string): ProjectComparisonContext | null {
    const context = this.contextsByWindow.get(windowId)
    return context?.id === id ? context : null
  }

  private isCurrent(context: ProjectComparisonContext, generation: number): boolean {
    return (
      this.contextsByWindow.get(context.windowId) === context &&
      context.generation === generation
    )
  }

  private markWatcherUnavailable(context: ProjectComparisonContext): void {
    if (context.watcherIssue) return
    context.watcherIssue = autoRefreshIssue()
    if (context.cache) this.invalidateContext(context)
  }

  private async handleManifestChanged(
    context: ProjectComparisonContext,
  ): Promise<boolean> {
    if (this.contextsByWindow.get(context.windowId) !== context) return false
    try {
      const manifest = await this.readManifest(context.projectRoot)
      if (this.contextsByWindow.get(context.windowId) !== context) return false
      const fingerprint = manifestFingerprint(manifest)
      if (fingerprint === context.manifestFingerprint) return false
      context.manifestFingerprint = fingerprint
      this.invalidateContext(context)
      return true
    } catch {
      if (this.contextsByWindow.get(context.windowId) === context) {
        this.invalidateContext(context)
      }
      return true
    }
  }

  private async handleSnapshotChanged(
    context: ProjectComparisonContext,
    workspaceRoot: string,
  ): Promise<void> {
    if (this.contextsByWindow.get(context.windowId) !== context) return
    const key = resolve(workspaceRoot)
    const previous = context.snapshotCache.get(key)
    const next = await this.reader.readEngineeringSnapshot({
      projectRoot: context.projectRoot,
      workspacePath: key,
    })
    if (this.contextsByWindow.get(context.windowId) !== context) return
    context.snapshotCache.set(key, next)
    if (!previous || snapshotRevision(previous) === snapshotRevision(next)) return
    this.invalidateContext(context)
  }

  private async readManifest(projectRoot: string): Promise<ProjectManifest> {
    const manifest = await this.reader.readManifest(projectRoot)
    if (!manifest) throw new Error('Project manifest does not exist.')
    const manifestRoot = await (this.reader.resolveProjectRoot ?? realpath)(
      manifest.root_path,
    )
    if (manifestRoot !== projectRoot) {
      throw new Error('Project manifest root_path does not match the selected project.')
    }
    for (const workspace of manifest.workspaces) {
      const workspacePath = resolve(workspace.workspace_path)
      if (
        workspacePath === projectRoot ||
        !isPathWithinRoot(workspacePath, projectRoot)
      ) {
        throw new Error('Project manifest contains an invalid workspace path.')
      }
    }
    return manifest
  }

  private async buildComparison(
    context: ProjectComparisonContext,
    generation: number,
  ): Promise<BackendProjectComparisonQueryResult> {
    const startedAt = performance.now()
    const eventLoopDelay = eventLoopDelayMs()
    try {
      const manifest = await this.readManifest(context.projectRoot)
      context.manifestFingerprint = manifestFingerprint(manifest)
      try {
        await context.watcher.reconcile(
          context.projectRoot,
          manifest.workspaces.map((workspace) => workspace.workspace_path),
        )
      } catch {
        this.markWatcherUnavailable(context)
      }
      let readBytes = 0
      let readFileCount = 0
      let unavailableFileCount = 0
      const readStartedAt = performance.now()
      const entries: WorkspaceComparisonEntry[] = await mapWithConcurrency(
        manifest.workspaces,
        2,
        async (workspace) => {
          try {
            const snapshotKey = resolve(workspace.workspace_path)
            let snapshotResult = context.snapshotCache.get(snapshotKey)
            if (!snapshotResult) {
              snapshotResult = await this.reader.readEngineeringSnapshot({
                projectRoot: context.projectRoot,
                workspacePath: workspace.workspace_path,
              })
              context.snapshotCache.set(snapshotKey, snapshotResult)
              readFileCount += 1
              readBytes += snapshotResult.readBytes
            }
            if (!snapshotResult.ok) {
              unavailableFileCount += 1
              return {
                issues: [workspaceIssue(workspace.workspace_id, snapshotResult.issue)],
              }
            }
            const identityKey = engineeringIdentityKey(
              workspace.workspace_id,
              workspace.workspace_path,
            )
            const expectedEngineeringWorkspaceId =
              context.engineeringWorkspaceIds.get(identityKey)
            if (
              expectedEngineeringWorkspaceId &&
              expectedEngineeringWorkspaceId !== snapshotResult.snapshot.workspaceId
            ) {
              unavailableFileCount += 1
              return {
                issues: [
                  workspaceIssue(workspace.workspace_id, {
                    code: 'ENGINEERING_WORKSPACE_ID_MISMATCH',
                  }),
                ],
              }
            }
            const sectionIssues = Object.values(snapshotResult.sections).flatMap(
              (section) => section.issues,
            )
            unavailableFileCount += sectionIssues.length
            const envelope = snapshotResult.snapshot
            const flow =
              snapshotResult.sections.flow.status === 'ready'
                ? snapshotResult.sections.flow.data
                : undefined
            const stepStatuses = workspaceFlowStates(flow)
            const entry = {
              ...(flow
                ? {
                    executionWorkspace: {
                      engineeringWorkspaceId: envelope.workspaceId,
                      projectWorkspaceId: workspace.workspace_id,
                      stepStatuses,
                      workspaceRevision: envelope.workspaceRevision,
                    } satisfies CommittedProjectWorkspace,
                  }
                : {}),
              engineeringWorkspaceId: envelope.workspaceId,
              identityKey,
              issues: sectionIssues.map((issue) =>
                workspaceIssue(workspace.workspace_id, issue),
              ),
            }
            if (snapshotResult.sections.qor.status !== 'ready') return entry
            const qor = snapshotResult.sections.qor.data
            const artifacts =
              snapshotResult.sections.artifacts.status === 'ready'
                ? snapshotResult.sections.artifacts.data
                : []
            const engineeringFacts = {
              analysis: qor.analysis,
              metrics: qor.metrics,
              qorAssessment: qor.qorAssessment,
              ...(flow ? { flow } : {}),
              ...(snapshotResult.sections.signoff.status === 'ready'
                ? { signoffAssessment: snapshotResult.sections.signoff.data }
                : {}),
            }
            const texts = analysisTextsFromSnapshot(qor.analysis, artifacts)
            const input = projectQorInputForWorkspace(
              manifest,
              workspace.workspace_id,
              texts,
              engineeringFacts,
            )
            return input
              ? {
                  ...entry,
                  input,
                }
              : {
                  ...entry,
                  issues: [...entry.issues, workspaceIssue(workspace.workspace_id)],
                }
          } catch (error) {
            unavailableFileCount += 1
            return { issues: [workspaceIssue(workspace.workspace_id, error)] }
          }
        },
      )
      if (!this.isCurrent(context, generation)) {
        return { ok: false, code: 'unknown-context' }
      }

      this.execution.setCommittedWorkspaces(
        context.id,
        entries.flatMap((entry) =>
          entry.executionWorkspace ? [entry.executionWorkspace] : [],
        ),
      )

      context.dependencies = new Set(
        manifest.workspaces.map((workspace) => resolve(workspace.workspace_path)),
      )
      for (const key of context.snapshotCache.keys()) {
        if (!context.dependencies.has(key)) context.snapshotCache.delete(key)
      }
      const currentIdentityKeys = new Set(
        manifest.workspaces.map((workspace) =>
          engineeringIdentityKey(workspace.workspace_id, workspace.workspace_path),
        ),
      )
      for (const key of context.engineeringWorkspaceIds.keys()) {
        if (!currentIdentityKeys.has(key)) context.engineeringWorkspaceIds.delete(key)
      }
      for (const entry of entries) {
        if (entry.identityKey && entry.engineeringWorkspaceId) {
          context.engineeringWorkspaceIds.set(
            entry.identityKey,
            entry.engineeringWorkspaceId,
          )
        }
      }
      const inputs = entries.flatMap((entry) => (entry.input ? [entry.input] : []))
      const issues = entries.flatMap((entry) => entry.issues)
      const baselineWorkspaceId = manifest.qor_baseline?.workspace_id
      if (
        baselineWorkspaceId &&
        !inputs.some((input) => input.workspaceId === baselineWorkspaceId)
      ) {
        issues.push({
          code: 'PROJECT_BASELINE_UNAVAILABLE',
          detail: baselineWorkspaceId,
        })
      }
      const readMs = performance.now() - readStartedAt
      const analysisStartedAt = performance.now()
      const trend = buildProjectComparisonTrend(
        inputs,
        manifest.qor_baseline?.workspace_id ?? null,
      )
      const snapshots = buildProjectComparisonSnapshots(inputs)
      const flowStates = Object.fromEntries(
        entries.flatMap((entry) =>
          entry.executionWorkspace
            ? [
                [
                  entry.executionWorkspace.projectWorkspaceId,
                  entry.executionWorkspace.stepStatuses,
                ],
              ]
            : [],
        ),
      )
      const stepComparisons = buildProjectComparisonSteps(
        manifest,
        inputs,
        trend,
        flowStates,
      )
      const analysisByWorkspace = new Map(
        snapshots.map((snapshot) => [snapshot.workspaceId, snapshot]),
      )
      this.findings.commit(
        context.id,
        generation,
        manifest.workspaces.flatMap((workspace) => {
          const snapshot = context.snapshotCache.get(resolve(workspace.workspace_path))
          const analysis = analysisByWorkspace.get(workspace.workspace_id)
          if (!snapshot?.ok || !analysis) return []
          const evidence = projectComparisonEvidence(
            snapshot,
            manifest,
            workspace,
            analysis,
            stepComparisons,
          )
          return evidence ? [evidence] : []
        }),
      )
      const recommendation = selectRecommendation(trend.workspaces)
      const data: BackendProjectComparison = {
        identity: {
          projectId: manifest.project_id,
          projectName: manifest.name,
          designName: manifest.design_name,
          ...(manifest.qor_baseline?.workspace_id
            ? { baselineWorkspaceId: manifest.qor_baseline.workspace_id }
            : {}),
        },
        refresh: context.watcherIssue
          ? { automatic: 'unavailable', issue: context.watcherIssue }
          : { automatic: 'available' },
        trend: comparisonSection(trend, issues),
        workspaceSnapshots: comparisonSection({ items: snapshots, flowStates }, issues),
        stepComparisons: comparisonSection({ steps: stepComparisons }, issues),
        recommendation: recommendation
          ? comparisonSection(recommendation, issues)
          : {
              status: 'unavailable',
              issues: [...issues, { code: 'NO_ELIGIBLE_WORKSPACE' }],
            },
        risks: comparisonSection({ items: trend.risks }, issues),
        timingTriage: comparisonSection({ items: trend.timingClosure.triage }, issues),
      }
      const result: BackendProjectComparisonQueryResult = {
        ok: true,
        projectComparisonContextId: context.id,
        generation,
        data,
      }
      electronLogger.debug('[backend-project-comparison] query metrics', {
        analysisMs: roundMs(performance.now() - analysisStartedAt),
        coalescedRequests: context.coalescedRequests,
        eventLoopDelayMs: roundMs(await eventLoopDelay),
        fileCount: readFileCount,
        ipcPayloadBytes: Buffer.byteLength(JSON.stringify(result)),
        readBytes,
        readMs: roundMs(readMs),
        totalMs: roundMs(performance.now() - startedAt),
        unavailableFileCount,
        workspaceCount: manifest.workspaces.length,
      })
      context.coalescedRequests = 0
      return result
    } catch (error) {
      return queryFailure('read-failed', error)
    }
  }
}

function snapshotRevision(result: ProjectEngineeringSnapshotReadResult): string {
  return result.ok
    ? `${result.snapshot.workspaceId}:${result.snapshot.workspaceRevision}`
    : `${result.issue.code}:${result.issue.actualSizeBytes ?? ''}:${result.issue.allowedSizeBytes ?? ''}`
}

function manifestFingerprint(manifest: ProjectManifest): string {
  return JSON.stringify(manifest)
}

function autoRefreshIssue(): ReadIssue {
  return { code: 'PROJECT_COMPARISON_AUTO_REFRESH_UNAVAILABLE' }
}

function engineeringIdentityKey(workspaceId: string, workspacePath: string): string {
  return `${workspaceId}\0${resolve(workspacePath)}`
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

function failure(
  code: 'invalid-project' | 'read-failed',
  error: unknown,
): BackendProjectComparisonSelectResult {
  return {
    ok: false,
    code,
    detail: error instanceof Error ? error.message : String(error),
  }
}

function queryFailure(
  code: 'read-failed',
  error: unknown,
): BackendProjectComparisonQueryResult {
  return {
    ok: false,
    code,
    detail: error instanceof Error ? error.message : String(error),
  }
}
