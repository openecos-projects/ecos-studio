import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  parseProjectManifest,
  projectManagementWorkspaceSummaryPaths,
  type BackendProjectComparison,
  type BackendProjectComparisonInvalidatedEvent,
  type BackendProjectComparisonQueryResult,
  type BackendProjectComparisonSelectResult,
  type DesktopProjectManagementWorkspaceTextsResult,
  type EccEngineeringSnapshot,
  type ProjectAnalysisSnapshot,
  type ProjectManifest,
  type ProjectQorMetricRecord,
  type ProjectQorTrendSummary,
  type ProjectQorTrendWorkspaceSummary,
  type ProjectRecommendation,
  type ProjectStepComparison,
  type ReadIssue,
  type ReadSection,
} from '@ecos-studio/shared'
import { buildProjectAnalysisSnapshot } from './projectAnalysisSnapshot'
import { buildProjectQorTrendSummary } from './qorAnalysis'
import { projectQorInputForWorkspace } from './workspaceQorAnalysis'
import { electronLogger } from './logger'
import { isPathWithinRoot } from './pathScope'

interface ProjectComparisonReader {
  resolveProjectRoot?(projectRoot: string): Promise<string>
  readManifest(projectRoot: string): Promise<string | null>
  readWorkspaceTexts(request: {
    projectRoot: string
    workspacePath: string
    paths: string[]
  }): Promise<DesktopProjectManagementWorkspaceTextsResult>
}

interface EngineeringSnapshotProvider {
  getByDirectory(directory: string): Promise<EccEngineeringSnapshot>
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
}

type InvalidationListener = (
  windowId: number,
  event: BackendProjectComparisonInvalidatedEvent,
) => void

const FLOW_STEPS = projectManagementWorkspaceSummaryPaths.length
  ? ([
      'Synth',
      'Floor',
      'Fanout',
      'Place',
      'CTS',
      'Legal',
      'Route',
      'DRC',
      'LVS',
      'Filler',
      'RCX',
      'STA',
      'Harden',
    ] as const)
  : []

export class BackendProjectComparisonService {
  private readonly contextsByWindow = new Map<number, ProjectComparisonContext>()
  private readonly listeners = new Set<InvalidationListener>()

  constructor(
    private readonly reader: ProjectComparisonReader,
    private readonly snapshotProvider: EngineeringSnapshotProvider,
  ) {}

  async selectProject(
    windowId: number,
    request: { projectRootLocator: string },
  ): Promise<BackendProjectComparisonSelectResult> {
    try {
      const projectRoot = await (this.reader.resolveProjectRoot ?? realpath)(
        request.projectRootLocator,
      )
      const manifest = await this.readManifest(projectRoot)
      const context: ProjectComparisonContext = {
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
      }
      this.contextsByWindow.set(windowId, context)
      return {
        ok: true,
        projectComparisonContextId: context.id,
        generation: context.generation,
      }
    } catch (error) {
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
    context.generation += 1
    context.cache = null
    context.inFlight = null
    return this.getComparison(windowId, projectComparisonContextId)
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

  disposeWindow(windowId: number): void {
    this.contextsByWindow.delete(windowId)
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

  private async readManifest(projectRoot: string): Promise<ProjectManifest> {
    const content = await this.reader.readManifest(projectRoot)
    if (!content) throw new Error('Project manifest does not exist.')
    const manifest = parseProjectManifest(content)
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
      let readBytes = 0
      let unavailableFileCount = 0
      const readStartedAt = performance.now()
      const entries = await mapWithConcurrency(
        manifest.workspaces,
        2,
        async (workspace) => {
          try {
            const [{ texts, unavailablePaths }, engineeringSnapshot] = await Promise.all([
              this.reader.readWorkspaceTexts({
                projectRoot: context.projectRoot,
                workspacePath: workspace.workspace_path,
                paths: [...projectManagementWorkspaceSummaryPaths],
              }),
              this.snapshotProvider.getByDirectory(workspace.workspace_path),
            ])
            readBytes += Object.values(texts).reduce(
              (total, text) => total + (text ? Buffer.byteLength(text) : 0),
              0,
            )
            unavailableFileCount += unavailablePaths.length
            const input = projectQorInputForWorkspace(
              manifest,
              workspace.workspace_id,
              texts,
              engineeringSnapshot,
            )
            return input ? { input } : { issue: workspaceIssue(workspace.workspace_id) }
          } catch (error) {
            return { issue: workspaceIssue(workspace.workspace_id, error) }
          }
        },
      )
      if (!this.isCurrent(context, generation)) {
        return { ok: false, code: 'unknown-context' }
      }

      context.dependencies = new Set(
        manifest.workspaces.map((workspace) => resolve(workspace.workspace_path)),
      )
      const inputs = entries.flatMap((entry) => (entry.input ? [entry.input] : []))
      const issues = entries.flatMap((entry) => (entry.issue ? [entry.issue] : []))
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
      const trend = publicTrend(
        buildProjectQorTrendSummary(inputs, {
          baselineWorkspaceId: manifest.qor_baseline?.workspace_id ?? null,
        }),
      )
      const snapshots = inputs.map((input) =>
        publicSnapshot(buildProjectAnalysisSnapshot(input, FLOW_STEPS)),
      )
      const flowStates = Object.fromEntries(
        inputs.map((input) => [input.workspaceId, input.stepStatuses]),
      )
      const stepComparisons = buildStepComparisons(manifest, inputs, snapshots)
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
        trend: section(trend, issues),
        workspaceSnapshots: section({ items: snapshots, flowStates }, issues),
        stepComparisons: section({ steps: stepComparisons }, issues),
        recommendation: recommendation
          ? section(recommendation, issues)
          : {
              status: 'unavailable',
              issues: [...issues, { code: 'NO_ELIGIBLE_WORKSPACE' }],
            },
        risks: section({ items: trend.risks }, issues),
        timingTriage: section({ items: trend.timingClosure.triage }, issues),
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
        fileCount:
          manifest.workspaces.length * projectManagementWorkspaceSummaryPaths.length,
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

function buildStepComparisons(
  manifest: ProjectManifest,
  inputs: ReturnType<typeof projectQorInputForWorkspace>[],
  snapshots: ProjectAnalysisSnapshot[],
): ProjectStepComparison[] {
  const availableInputs = inputs.filter((input): input is NonNullable<typeof input> =>
    Boolean(input),
  )
  const stepIds = new Set<string>(FLOW_STEPS)
  for (const input of availableInputs) {
    for (const stepId of Object.keys(input.stepStatuses)) stepIds.add(stepId)
  }
  for (const workspace of manifest.workspaces) {
    stepIds.add(workspace.start_step)
    stepIds.add(workspace.end_step)
    if (workspace.branch_from?.source_step) stepIds.add(workspace.branch_from.source_step)
  }
  const knownOrder = new Map(FLOW_STEPS.map((step, order) => [step, order]))
  const unknownSteps = [...stepIds]
    .filter((step) => !knownOrder.has(step as (typeof FLOW_STEPS)[number]))
    .sort((left, right) => left.localeCompare(right))
  return [...stepIds]
    .map((stepId) => ({
      stepId,
      order:
        knownOrder.get(stepId as (typeof FLOW_STEPS)[number]) ??
        FLOW_STEPS.length + unknownSteps.indexOf(stepId),
      name: stepId,
      workspaces: manifest.workspaces.map((workspace) => {
        const input = availableInputs.find(
          (candidate) => candidate.workspaceId === workspace.workspace_id,
        )
        const snapshot = snapshots.find(
          (candidate) => candidate.workspaceId === workspace.workspace_id,
        )
        const stepSnapshot = snapshot?.steps[stepId as keyof typeof snapshot.steps]
        return {
          workspaceId: workspace.workspace_id,
          status: (input?.stepStatuses[stepId] ??
            'missing') as ProjectStepComparison['workspaces'][number]['status'],
          metrics: stepSnapshot?.metrics ?? [],
        }
      }),
    }))
    .sort((left, right) => left.order - right.order)
}

function publicMetric(
  metric: ProjectQorMetricRecord & { workspaceKey?: string },
): ProjectQorMetricRecord {
  const { workspaceKey: _workspaceKey, ...result } = metric
  return result
}

function publicSnapshot(
  snapshot: ReturnType<typeof buildProjectAnalysisSnapshot>,
): ProjectAnalysisSnapshot {
  return {
    ...snapshot,
    steps: Object.fromEntries(
      Object.entries(snapshot.steps).map(([step, value]) => [
        step,
        value ? { ...value, metrics: value.metrics.map(publicMetric) } : value,
      ]),
    ),
  }
}

function publicTrend(
  trend: ReturnType<typeof buildProjectQorTrendSummary>,
): ProjectQorTrendSummary {
  return {
    ...trend,
    workspaces: trend.workspaces.map((workspace) => {
      const { workspaceKey: _workspaceKey, ...result } = workspace
      return {
        ...result,
        records: workspace.records.map(publicMetric),
        ...(workspace.comparisonRecords
          ? { comparisonRecords: workspace.comparisonRecords.map(publicMetric) }
          : {}),
      }
    }),
    timingClosure: {
      issues: trend.timingClosure.issues,
      coverage: trend.timingClosure.coverage,
      triage: trend.timingClosure.triage,
      criticalCount: trend.timingClosure.criticalCount,
      warningCount: trend.timingClosure.warningCount,
      cleanWorkspaceCount: trend.timingClosure.cleanWorkspaceCount,
      atRiskWorkspaceCount: trend.timingClosure.atRiskWorkspaceCount,
      incompleteWorkspaceCount: trend.timingClosure.incompleteWorkspaceCount,
      unavailableWorkspaceCount: trend.timingClosure.unavailableWorkspaceCount,
    },
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

function section<T>(data: T, issues: ReadIssue[]): ReadSection<T> {
  return issues.length
    ? { status: 'partial', data, issues }
    : { status: 'ready', data, issues: [] }
}

function workspaceIssue(workspaceId: string, error?: unknown): ReadIssue {
  return {
    code: 'WORKSPACE_ANALYSIS_FAILED',
    detail: error instanceof Error ? `${workspaceId}: ${error.message}` : workspaceId,
  }
}

function selectRecommendation(
  workspaces: ProjectQorTrendWorkspaceSummary[],
): ProjectRecommendation | null {
  const best = workspaces
    .filter(
      (workspace) =>
        workspace.overallScore !== null &&
        (workspace.dataQuality.status === 'complete' ||
          workspace.dataQuality.status === 'limited'),
    )
    .sort((left, right) => (right.overallScore ?? -1) - (left.overallScore ?? -1))[0]
  return best?.overallScore === null || !best
    ? null
    : {
        workspaceId: best.workspaceId,
        score: best.overallScore,
        reasons: [`Highest eligible QoR score: ${best.overallScore}`],
      }
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

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++
        results[index] = await mapper(values[index]!)
      }
    }),
  )
  return results
}
