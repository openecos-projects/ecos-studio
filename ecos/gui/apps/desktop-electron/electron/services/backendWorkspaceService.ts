import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  parseProjectManifest,
  parseRuntimeSeconds,
  type BackendWorkspaceOverviewResult,
  type ChecklistFinding,
  type FlowStepState,
  type EccEngineeringSnapshot,
  type ProjectManifest,
  type ReadIssue,
  type ReadSection,
  type WorkspaceConfigurationSummary,
  type WorkspaceDashboardMetric,
  type WorkspaceChecklistSummary,
  type WorkspaceFlowSummary,
  type WorkspaceOverviewCore,
  type WorkspaceOverviewIdentity,
  type WorkspaceBaselineComparison,
  type WorkspaceQorSummary,
  type WorkspaceResourceIndex,
} from '@ecos-studio/shared'
import { requireWindowScopeId } from './windowScopeContext'
import { analyzeWorkspaceQor } from './workspaceQorAnalysis'
import { electronLogger } from './logger'
import { workspaceDashboardMetrics } from './workspaceDashboardAnalysis'

interface BackendWorkspaceServiceOptions {
  engineeringSnapshotProvider?: {
    getByDirectory(directory: string): Promise<EccEngineeringSnapshot>
  }
  workspaceResourceService: {
    getIndex(): Promise<WorkspaceResourceIndex>
  }
  projectManagementReadService?: {
    readManifest(projectRoot: string): Promise<string | null>
  }
  readWorkspaceTextFile?: (path: string) => Promise<string | null>
}

interface WorkspaceContext {
  id: string
  generation: number
  cache?: BackendWorkspaceOverviewResult
  inFlight?: Promise<BackendWorkspaceOverviewResult>
  coalescedRequests: number
}

export interface BackendWorkspaceInvalidation {
  windowId: number
  workspaceContextId: string
  generation: number
}

const NOT_MIGRATED_ISSUE: ReadIssue = { code: 'BACKEND_SECTION_NOT_MIGRATED' }
const WORKSPACE_TEXT_MAX_BYTES = 512 * 1024

function unavailable<T>(): ReadSection<T> {
  return { status: 'unavailable', issues: [NOT_MIGRATED_ISSUE] }
}

function stringValue(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

async function readBoundedText(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(WORKSPACE_TEXT_MAX_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > WORKSPACE_TEXT_MAX_BYTES) {
      throw new Error(`Workspace file exceeds ${WORKSPACE_TEXT_MAX_BYTES} bytes`)
    }
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  } finally {
    await handle?.close()
  }
}

function pathsEqual(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === ''
}

function configurationSection(
  snapshot: EccEngineeringSnapshot | null,
): ReadSection<WorkspaceConfigurationSummary> {
  if (!snapshot) {
    return {
      status: 'unavailable',
      issues: [{ code: 'WORKSPACE_CONFIGURATION_UNAVAILABLE' }],
    }
  }

  const parameters = snapshot.parameters
  const die = recordValue(parameters.Die)
  const mpc = recordValue(parameters.MPC)
  const template = recordValue(mpc?.core_template)
  const ports = Array.isArray(template?.ports)
    ? template.ports.flatMap((value) => {
        const port = recordValue(value)
        const name = stringValue(port, 'name').trim()
        return name
          ? [
              {
                name,
                direction: stringValue(port, 'direction').trim() || '--',
                dataType: stringValue(port, 'data_type').trim() || '--',
                width: finiteNumber(port?.width),
                info: stringValue(port, 'info').trim(),
              },
            ]
          : []
      })
    : []
  return {
    status: 'ready',
    data: {
      pdk: stringValue(parameters, 'PDK'),
      design: stringValue(parameters, 'Design'),
      topModule: stringValue(parameters, 'Top module'),
      dieArea: finiteNumber(die?.Area),
      maxFanout: finiteNumber(parameters['Max fanout']),
      clock: stringValue(parameters, 'Clock'),
      frequencyMaxMhz: finiteNumber(parameters['Frequency max [MHz]']),
      mpcDisplayName: stringValue(mpc, 'display_name').trim() || null,
      mpcConstraints: template
        ? {
            minimumArea: finiteNumber(template.minimum_area),
            maximumArea: finiteNumber(template.maximum_area),
            maximumCellCount: finiteNumber(template.maximum_cell_num),
            ports,
          }
        : null,
    },
    issues: [],
  }
}

function normalizeFlowState(value: string): FlowStepState {
  switch (value.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'complete':
      return 'succeeded'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'incomplete':
      return 'failed'
    case 'invalid':
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed'
    case 'pending':
    case 'unstart':
    case 'unstarted':
    case 'not_started':
    case 'not-started':
    case 'not started':
      return 'not-started'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return value.trim() ? 'unknown' : 'not-started'
  }
}

function flowSection(
  snapshot: EccEngineeringSnapshot | null,
): ReadSection<WorkspaceFlowSummary> {
  if (!snapshot) {
    return {
      status: 'unavailable',
      issues: [{ code: 'WORKSPACE_FLOW_UNAVAILABLE' }],
    }
  }
  const steps = recordValue(snapshot.flow)?.steps
  if (!Array.isArray(steps)) {
    return {
      status: 'error',
      issues: [{ code: 'WORKSPACE_FLOW_INVALID' }],
    }
  }
  return {
    status: 'ready',
    data: {
      steps: steps.flatMap((value, order) => {
        const step = recordValue(value)
        if (!step || typeof step.name !== 'string') return []
        const runtimeSeconds = parseRuntimeSeconds(String(step.runtime ?? ''))
        const peakMemoryMb = finiteNumber(
          step['peak memory (mb)'] ?? recordValue(step.info)?.['peak memory (mb)'],
        )
        return [
          {
            stepId: step.name,
            order,
            name: step.name,
            state: normalizeFlowState(String(step.state ?? '')),
            ...(typeof step.tool === 'string' && step.tool ? { toolId: step.tool } : {}),
            ...(runtimeSeconds === null ? {} : { runtimeSeconds }),
            ...(peakMemoryMb === null ? {} : { peakMemoryMb }),
          },
        ]
      }),
    },
    issues: [],
  }
}

function checklistFinding(value: unknown): ChecklistFinding | null {
  const item = recordValue(value)
  if (!item) return null
  const requiredStrings = [
    'id',
    'step',
    'category',
    'owner',
    'policy',
    'state',
    'title',
    'summary',
  ] as const
  if (requiredStrings.some((key) => typeof item[key] !== 'string')) return null
  if (typeof item.blocked !== 'boolean') return null
  const source = recordValue(item.source)
  if (!source || !Array.isArray(item.evidence)) return null
  const evidence = item.evidence.filter(
    (entry): entry is Record<string, unknown> => recordValue(entry) !== null,
  )
  return {
    id: item.id as string,
    step: item.step as string,
    category: item.category as string,
    owner: item.owner as string,
    policy: item.policy as string,
    state: item.state as string,
    blocked: item.blocked,
    title: item.title as string,
    summary: item.summary as string,
    source,
    evidence,
  }
}

function reconcileChecklistFinding(
  finding: ChecklistFinding,
  successfulSteps: ReadonlySet<string>,
): ChecklistFinding {
  if (
    finding.category !== 'flow' ||
    finding.state !== 'failed' ||
    !successfulSteps.has(finding.step.trim().toLowerCase())
  ) {
    return finding
  }
  return {
    ...finding,
    blocked: false,
    state: 'pass',
    evidence: [
      ...finding.evidence,
      {
        kind: 'flow-checklist-reconciliation',
        previousState: 'failed',
        committedFlowState: 'Success',
      },
    ],
  }
}

function identityFromManifest(
  index: WorkspaceResourceIndex,
  manifest: ProjectManifest | null,
): WorkspaceOverviewIdentity {
  const workspace = manifest?.workspaces.find((candidate) =>
    pathsEqual(candidate.workspace_path, index.root),
  )
  return {
    ...(manifest ? { projectId: manifest.project_id, projectName: manifest.name } : {}),
    ...(workspace
      ? { workspaceId: workspace.workspace_id, workspaceName: workspace.name }
      : {
          workspaceName: index.root.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace',
        }),
    ...(manifest?.qor_baseline?.workspace_id
      ? { baselineWorkspaceId: manifest.qor_baseline.workspace_id }
      : {}),
  }
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
      .then((result) => {
        const current = this.contexts.get(windowId)
        if (current === context && current.generation === generation) {
          current.cache = result
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
    this.contexts.delete(windowId)
  }

  private contextForWindow(windowId: number): WorkspaceContext {
    const existing = this.contexts.get(windowId)
    if (existing) return existing
    const context = { id: randomUUID(), generation: 0, coalescedRequests: 0 }
    this.contexts.set(windowId, context)
    return context
  }

  private async buildOverview(
    context: WorkspaceContext,
    generation: number,
  ): Promise<BackendWorkspaceOverviewResult> {
    const startedAt = performance.now()
    const eventLoopDelay = eventLoopDelayMs()
    const readStartedAt = performance.now()
    const index = await this.options.workspaceResourceService.getIndex()
    const [manifest, snapshot] = await Promise.all([
      this.readManifest(index.root),
      this.readEngineeringSnapshot(index.root),
    ])
    const flow = flowSection(snapshot)
    const checklist = this.readChecklist(snapshot, flow)
    const qor = await this.readQor(index, manifest, snapshot)
    const keyMetrics = await this.readKeyMetrics(index, qor.qor)
    const readMs = performance.now() - readStartedAt
    const normalizeStartedAt = performance.now()
    const overview: WorkspaceOverviewCore = {
      identity: identityFromManifest(index, manifest),
      configuration: configurationSection(snapshot),
      flow,
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
    const files = workspaceIndexFiles(index)
    electronLogger.debug('[backend-workspace] query metrics', {
      coalescedRequests: context.coalescedRequests,
      eventLoopDelayMs: roundMs(await eventLoopDelay),
      fileCount: files.length,
      indexedBytes: files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0),
      ipcPayloadBytes: Buffer.byteLength(JSON.stringify(result)),
      normalizeMs: roundMs(performance.now() - normalizeStartedAt),
      readMs: roundMs(readMs),
      totalMs: roundMs(performance.now() - startedAt),
    })
    context.coalescedRequests = 0
    return result
  }

  private async readManifest(workspaceRoot: string): Promise<ProjectManifest | null> {
    if (!this.options.projectManagementReadService) return null
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
  ): Promise<EccEngineeringSnapshot | null> {
    try {
      return (
        (await this.options.engineeringSnapshotProvider?.getByDirectory(workspaceRoot)) ??
        null
      )
    } catch {
      return null
    }
  }

  private readChecklist(
    snapshot: EccEngineeringSnapshot | null,
    flow: ReadSection<WorkspaceFlowSummary>,
  ): ReadSection<WorkspaceChecklistSummary> {
    if (!snapshot) {
      return {
        status: 'unavailable',
        issues: [{ code: 'WORKSPACE_CHECKLIST_UNAVAILABLE' }],
      }
    }
    try {
      const root = recordValue(snapshot.checklist)
      if (!root || !Array.isArray(root.checklist)) {
        return {
          status: 'error',
          issues: [{ code: 'WORKSPACE_CHECKLIST_INVALID' }],
        }
      }
      const findings = root.checklist.map(checklistFinding)
      const invalidCount = findings.filter((finding) => finding === null).length
      const successfulSteps = new Set(
        (flow.status === 'ready' || flow.status === 'partial' ? flow.data.steps : [])
          .filter((step) => normalizeFlowState(step.state) === 'succeeded')
          .map((step) => step.name.trim().toLowerCase()),
      )
      const data = {
        findings: findings
          .filter((finding): finding is ChecklistFinding => finding !== null)
          .map((finding) => reconcileChecklistFinding(finding, successfulSteps)),
      }
      return invalidCount
        ? {
            status: 'partial',
            data,
            issues: [
              {
                code: 'WORKSPACE_CHECKLIST_ITEM_INVALID',
                detail: `${invalidCount} invalid checklist item(s)`,
              },
            ],
          }
        : { status: 'ready', data, issues: [] }
    } catch (error) {
      return {
        status: 'error',
        issues: [
          {
            code: 'WORKSPACE_CHECKLIST_READ_FAILED',
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      }
    }
  }

  private async readQor(
    index: WorkspaceResourceIndex,
    manifest: ProjectManifest | null,
    snapshot: EccEngineeringSnapshot | null,
  ): Promise<{
    qor: ReadSection<WorkspaceQorSummary>
    baselineComparison: ReadSection<WorkspaceBaselineComparison>
  }> {
    const currentWorkspace = manifest?.workspaces.find((workspace) =>
      pathsEqual(workspace.workspace_path, index.root),
    )
    const snapshotProvider = this.options.engineeringSnapshotProvider
    if (!manifest || !currentWorkspace || !snapshotProvider) {
      return { qor: unavailable(), baselineComparison: unavailable() }
    }

    const baselineWorkspaceId = manifest.qor_baseline?.workspace_id
    const requestedIds = [
      currentWorkspace.workspace_id,
      ...(baselineWorkspaceId && baselineWorkspaceId !== currentWorkspace.workspace_id
        ? [baselineWorkspaceId]
        : []),
    ]
    const snapshotsByWorkspaceId: Record<string, EccEngineeringSnapshot | null> = {}
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
        if (workspaceId === currentWorkspace.workspace_id && snapshot) {
          snapshotsByWorkspaceId[workspaceId] = snapshot
          return
        }
        try {
          snapshotsByWorkspaceId[workspaceId] = await snapshotProvider.getByDirectory(
            workspace.workspace_path,
          )
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

  private async readKeyMetrics(
    index: WorkspaceResourceIndex,
    qor: ReadSection<WorkspaceQorSummary>,
  ): Promise<ReadSection<{ items: WorkspaceDashboardMetric[] }>> {
    const metrics =
      qor.status === 'ready' || qor.status === 'partial' ? qor.data.metrics : []
    try {
      return {
        status: 'ready',
        data: {
          items: await workspaceDashboardMetrics(
            index,
            metrics,
            this.options.readWorkspaceTextFile ?? readBoundedText,
          ),
        },
        issues: [],
      }
    } catch (error) {
      return {
        status: 'error',
        issues: [
          {
            code: 'WORKSPACE_KEY_METRICS_READ_FAILED',
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      }
    }
  }
}

function workspaceIndexFiles(index: WorkspaceResourceIndex) {
  const files = new Map<string, { path: string; sizeBytes?: number }>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if ('path' in value && typeof value.path === 'string' && 'exists' in value) {
      files.set(value.path, value as { path: string; sizeBytes?: number })
      return
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  visit(index.home)
  visit(index.flow.steps)
  if (index.tech) visit(index.tech)
  return [...files.values()]
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
