import { randomUUID } from 'node:crypto'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  EccBackgroundOperationLogResult,
  EccBackgroundOperationProjection,
  EccEngineeringSnapshot,
  EccFlowRunRequest,
  EccFlowRunResult,
  EccFlowRunStepRequest,
  EccFlowRunStepResult,
  EccProjectManifest,
  EccRuntimeEvent,
  EccRuntimeOperation,
  EccRuntimeOperationRequest,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceCloseResult,
  EccWorkspaceConfigurationUpdateRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceHandleRequest,
  EccWorkspaceInfoRequest,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenRequest,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigRequest,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceRuntimeSnapshot,
  EccWorkspaceSpecValidationRequest,
  EccWorkspaceSpecValidationResult,
  EccWorkspaceStepConfigurationReadRequest,
  EccWorkspaceStepConfigurationReadResult,
  EccWorkspaceStepConfigurationUpdateRequest,
  EccWorkspaceStepOutputsResult,
  EccWorkspaceUpdateRequest,
  EccWorkspaceUpdateResult,
  ProjectManifest,
  ProjectManifestMutation,
  ProjectRuntimeProcessEntry,
} from '@ecos-studio/shared'
import { electronLogger } from '../logger'
import { isPathWithinRoot } from '../pathScope'
import { normalizeWorkspacePath } from '../workspacePath'
import { readPersistedEngineeringSnapshot } from './engineeringSnapshotReader'
import {
  findLegacyWorkspaceReference,
  hasLegacyRunsLayout,
  projectNeedsCliMigration,
  readLegacyProjectManifest,
} from './legacyMigration'
import {
  EccCliCommandError,
  EccCliProcess,
  type EccCliProcessOptions,
} from './cliProcess'
import { parseEccLineRecords, parseJsonLiteral } from './lineRecords'
import {
  discoverProject,
  readProjectManifest,
  readWorkspaceFlow,
  workspaceDirectoryForId,
  workspaceEntryForDirectory,
  type PersistedFlow,
} from './persistedState'
import {
  watchWorkspaceOperationFiles,
  type OperationFileWatcher,
} from './workspaceFileWatcher'

const HANDSHAKE_TIMEOUT_MS = 30_000
const WATCH_DEBOUNCE_MS = 75
const PROCESS_POLL_MS = 5_000

interface WorkspaceSession {
  directory: string
  handle: string
  projectRoot: string
  workspaceId: string
  workspaceRevision: number
}

interface TrackedOperation {
  operation: EccRuntimeOperation
  projectRoot: string
  registrationPending: boolean
  session: WorkspaceSession
  requestedCancel: boolean
  poller: ReturnType<typeof setInterval> | null
  watcher: OperationFileWatcher | null
  waiters: Array<(operation: EccRuntimeOperation) => void>
}

export interface EccCliRuntimeServiceOptions extends EccCliProcessOptions {
  runtimeId?: string | (() => string)
}

export class EccCliRuntimeService {
  private readonly cli: EccCliProcess
  private readonly sessions = new Map<string, WorkspaceSession>()
  private readonly handleByDirectory = new Map<string, string>()
  private readonly knownProjectRoots = new Set<string>()
  private readonly projectMigrations = new Map<string, Promise<void>>()
  private readonly legacyReadOnlyRoots = new Set<string>()
  private readonly operations = new Map<string, TrackedOperation>()
  private readonly outcomes: EccRuntimeOperation[] = []
  private readonly eventListeners = new Set<(event: EccRuntimeEvent) => void>()
  private readonly projectionListeners = new Set<(generation: number) => void>()
  private readonly releasedListeners = new Set<(workspaceHandle: string) => void>()
  private catalog: Record<string, unknown> | null = null
  private contractCheck: Promise<void> | null = null
  private contractRuntimeId = 'ecc-cli-contract-1'
  private generation = 0

  constructor(private readonly options: EccCliRuntimeServiceOptions) {
    this.cli = new EccCliProcess(options)
  }

  get activeWorkspaceDirectory(): string | null {
    return this.sessions.values().next().value?.directory ?? null
  }

  onEvent(listener: (event: EccRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onOperationProjectionInvalidated(listener: (generation: number) => void): () => void {
    this.projectionListeners.add(listener)
    return () => this.projectionListeners.delete(listener)
  }

  onWorkspaceReleased(listener: (workspaceHandle: string) => void): () => void {
    this.releasedListeners.add(listener)
    return () => this.releasedListeners.delete(listener)
  }

  async loadProjectManifest(projectRoot: string): Promise<ProjectManifest> {
    await this.ensureContract()
    const root = await realpath(projectRoot)
    this.knownProjectRoots.add(root)
    try {
      await this.migrateLegacyProjectIfNeeded(root)
    } catch (error) {
      const fallback = await readLegacyProjectManifest(
        root,
        error instanceof Error ? error.message : String(error),
      )
      if (fallback) {
        this.legacyReadOnlyRoots.add(root)
        return fallback
      }
      throw error
    }
    this.legacyReadOnlyRoots.delete(root)
    await this.reconcileProject(root, '--no-wait')
    return await readProjectManifest(root)
  }

  private async reconcileProject(projectRoot: string, mode: '--no-wait' | '--plain') {
    await this.cli
      .run(['project', 'reconcile', '--project', projectRoot, mode], {
        cwd: projectRoot,
      })
      .catch((error) => {
        // ECC uses exit code 20 for a non-fatal reconciliation finding. The
        // manifest remains readable and the next explicit operation can retry.
        if (!(error instanceof EccCliCommandError) || error.exitCode !== 20) throw error
      })
  }

  private async migrateLegacyProjectIfNeeded(projectRoot: string): Promise<void> {
    if (!(await projectNeedsCliMigration(projectRoot))) return
    const existing = this.projectMigrations.get(projectRoot)
    if (existing) return await existing

    const migration = this.cli
      .run(['migrate', '--project', projectRoot, '--yes', '--plain'], {
        cwd: projectRoot,
      })
      .then(() => undefined)
      .finally(() => {
        this.projectMigrations.delete(projectRoot)
      })
    this.projectMigrations.set(projectRoot, migration)
    await migration
  }

  async discoverProject(directory: string) {
    let target = resolve(directory)
    try {
      target = await realpath(directory)
    } catch {
      // A legacy workspace is moved by migration, so its requested path may
      // disappear before discovery is retried.
    }
    const discovered = await discoverProject(target, [...this.knownProjectRoots])
    if (discovered) this.knownProjectRoots.add(discovered.projectRoot)
    if (discovered) return discovered

    const legacyWorkspace = await findLegacyWorkspaceReference(target)
    const legacyRoot =
      legacyWorkspace?.projectRoot ??
      ((await hasLegacyRunsLayout(target)) ? target : null)
    if (!legacyRoot) return null
    const manifest = await this.loadProjectManifest(legacyRoot)
    this.knownProjectRoots.add(legacyRoot)
    return { projectId: manifest.project_id, projectRoot: legacyRoot }
  }

  async readWorkspaceBindingRequirement(
    directory: string,
  ): Promise<Record<string, unknown>> {
    const snapshot = await readPersistedEngineeringSnapshot(directory)
    return isRecord(snapshot.workspaceSpec?.pdk) ? snapshot.workspaceSpec.pdk : {}
  }

  async readWorkspaceConfiguration(directory: string) {
    const snapshot = await readPersistedEngineeringSnapshot(directory)
    return {
      parameters: snapshot.parameters,
      workspaceBindings: snapshot.workspaceBindings ?? {},
      workspaceSpec: snapshot.workspaceSpec ?? {},
    }
  }

  async applyProjectSettings(
    projectRoot: string,
    sets: readonly string[],
    unsets: readonly string[],
  ): Promise<void> {
    await this.ensureContract()
    const root = await realpath(projectRoot)
    this.assertProjectWritable(root)
    await this.cli.run(
      [
        'project',
        'apply',
        '--project',
        root,
        ...sets.flatMap((value) => ['--set', value]),
        ...unsets.flatMap((value) => ['--unset', value]),
      ],
      { cwd: root },
    )
  }

  async mutateProjectManifest(
    projectRoot: string,
    mutation: ProjectManifestMutation | Record<string, unknown>,
  ): Promise<EccProjectManifest> {
    await this.ensureContract()
    const root = resolve(projectRoot)
    this.assertProjectWritable(root)
    const requested = mutation as Record<string, unknown>
    const type = requireString(requested.type)
    if (type === 'create') {
      await this.cli.run(projectManifestCreateArgs(root, requested))
    } else {
      const manifest = await readProjectManifest(root)
      if (type === 'register-workspace') {
        const input = requireRecord(requested.input)
        const path = requireString(input.workspacePath)
        const existing = workspaceEntryForDirectory(manifest, path)
        if (!existing) {
          await this.cli.run([
            'workspace',
            'import',
            basename(path),
            '--path',
            await realpath(path),
            '--project',
            root,
            '--no-wait',
          ])
        }
      } else if (type === 'import-workspace') {
        const input = requireRecord(requested.input)
        const path = requireString(input.workspacePath)
        await this.cli.run([
          'workspace',
          'import',
          optionalString(input.workspaceId) ?? basename(path),
          '--path',
          await realpath(path),
          '--project',
          root,
          '--no-wait',
        ])
      } else if (type === 'archive-workspace' || type === 'delete-workspace') {
        const workspaceId = requireString(requested.workspaceId)
        const snapshot = await readPersistedEngineeringSnapshot(
          workspaceDirectoryForId(manifest, workspaceId),
          workspaceId,
        )
        const args = [
          'workspace',
          type === 'archive-workspace' ? 'archive' : 'delete',
          workspaceId,
          '--project',
          root,
          '--expected-revision',
          String(snapshot.workspaceRevision),
          '--command-id',
          randomUUID(),
          '--no-wait',
        ]
        if (type === 'delete-workspace' && requested.deleteDirectory === true) {
          args.push('--delete-directory')
        }
        await this.cli.run(args)
      } else if (type === 'select-qor-baseline') {
        await this.cli.run([
          'project',
          'baseline',
          requireString(requested.workspaceId),
          '--project',
          root,
          ...(optionalString(requested.reason)
            ? ['--reason', String(requested.reason)]
            : []),
        ])
      } else if (type !== 'record-replacement-backup') {
        throw new Error(`Unsupported Project mutation: ${type}`)
      }
    }
    this.knownProjectRoots.add(await realpath(root))
    return (await readProjectManifest(root)) as EccProjectManifest
  }

  async describeWorkspaceSpec(): Promise<Record<string, unknown>> {
    await this.ensureContract()
    if (this.catalog) return this.catalog
    const [parameters, flows] = await Promise.all([
      this.cli.run(['param', 'list', '--all', '--plain']),
      this.cli.run(['flow', 'list', '--plain']),
    ])
    this.catalog = buildCatalog(parameters.stdout, flows.stdout)
    return this.catalog
  }

  async validateWorkspaceSpec(
    _request: EccWorkspaceSpecValidationRequest,
  ): Promise<EccWorkspaceSpecValidationResult> {
    return { issues: [] }
  }

  async createWorkspace(
    request: EccWorkspaceCreateRequest,
  ): Promise<EccWorkspaceCreateResult> {
    await this.ensureContract()
    if (!request.projectRoot?.trim()) {
      throw new Error('Workspace creation requires an existing Project root.')
    }
    const requestedProjectRoot = resolve(request.projectRoot)
    const initArgs = projectInitArgs(request, requestedProjectRoot)
    if (initArgs) await this.cli.run(initArgs)
    const projectRoot = await realpath(requestedProjectRoot)
    this.assertProjectWritable(projectRoot)
    await stat(join(projectRoot, 'project.json')).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('Workspace creation requires an initialized Project.')
      }
      throw error
    })
    for (const args of workspaceCreateCommands(request, projectRoot)) {
      await this.cli.run(args, { cwd: projectRoot })
    }
    this.knownProjectRoots.add(await realpath(projectRoot))
    return await this.openWorkspace({ directory: request.targetDirectory })
  }

  async openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    await this.ensureContract()
    const requestedDirectory = normalizeWorkspacePath(resolve(request.directory))
    const legacyWorkspace = await findLegacyWorkspaceReference(requestedDirectory)
    let directory = requestedDirectory
    try {
      directory = normalizeWorkspacePath(await realpath(requestedDirectory))
    } catch (error) {
      if (!legacyWorkspace || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const existingHandle = this.handleByDirectory.get(directory)
    if (existingHandle)
      return { ...(await this.workspaceSession(existingHandle)), reused: true }
    const discovered = await this.discoverProject(directory)
    if (!discovered) throw new Error('Workspace is not declared by a Project Manifest.')
    const manifest = await this.loadProjectManifest(discovered.projectRoot)
    const declared = await declaredWorkspaceForDirectory(manifest, directory)
    const entry =
      declared?.entry ??
      (legacyWorkspace?.projectRoot === discovered.projectRoot
        ? (manifest.workspaces.find(
            (workspace) => workspace.workspace_id === legacyWorkspace.workspaceId,
          ) ?? null)
        : null)
    if (!entry) throw new Error('Project Manifest does not declare this Workspace.')
    directory =
      declared?.directory ?? normalizeWorkspacePath(await realpath(entry.workspace_path))
    const snapshot = await readPersistedEngineeringSnapshot(directory, entry.workspace_id)
    const session: WorkspaceSession = {
      directory,
      handle: randomUUID(),
      projectRoot: discovered.projectRoot,
      workspaceId: entry.workspace_id,
      workspaceRevision: snapshot.workspaceRevision,
    }
    this.sessions.set(session.handle, session)
    this.handleByDirectory.set(directory, session.handle)
    await this.restoreRegisteredOperation(session, manifest)
    this.emit({ type: 'runtime.ready', workspaceDirectory: directory })
    return sessionResult(session)
  }

  async workspaceSession(workspaceHandle: string): Promise<EccWorkspaceOpenResult> {
    const session = this.requireSession(workspaceHandle)
    await this.refreshSessionRevision(session)
    return sessionResult(session)
  }

  async closeWorkspace(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceCloseResult> {
    const session = this.sessions.get(request.workspaceHandle)
    if (!session) return { ok: true }
    const active = [...this.operations.values()].some(
      (tracked) =>
        tracked.session.handle === request.workspaceHandle &&
        tracked.operation.state === 'running',
    )
    if (active) return { ok: true, retained: true }
    this.sessions.delete(request.workspaceHandle)
    this.handleByDirectory.delete(session.directory)
    for (const listener of this.releasedListeners) listener(request.workspaceHandle)
    return { ok: true }
  }

  releaseWorkspace(request: EccWorkspaceHandleRequest) {
    return this.closeWorkspace(request)
  }

  async inspectWorkspaceIdentity(directory: string) {
    const snapshot = await readPersistedEngineeringSnapshot(directory)
    return {
      workspaceId: snapshot.workspaceId,
      workspaceRevision: snapshot.workspaceRevision,
    }
  }

  async updateWorkspace(
    request: EccWorkspaceUpdateRequest,
  ): Promise<EccWorkspaceUpdateResult> {
    const session = this.requireSession(request.workspaceHandle)
    await this.runWorkspaceMutation(
      session,
      workspaceRefreshArgs({
        commandId: request.commandId,
        expectedWorkspaceRevision: request.expectedWorkspaceRevision,
        force: true,
        projectRoot: session.projectRoot,
        workspaceId: session.workspaceId,
      }),
    )
    return updateResult(session)
  }

  async updateWorkspaceConfiguration(
    request: EccWorkspaceConfigurationUpdateRequest,
  ): Promise<EccWorkspaceUpdateResult> {
    const session = this.requireSession(request.workspaceHandle)
    const projectFields = [
      ...Object.keys(request.configuration.design).map((key) => `design.${key}`),
      ...Object.keys(request.configuration.pdk).map((key) => `pdk.${key}`),
      ...(request.pdkRoot !== undefined ? ['pdk.root'] : []),
    ]
    if (projectFields.length) {
      throw codedError(
        `Project-level configuration must be saved with ecc project apply: ${projectFields.join(', ')}`,
        'PROJECT_CONFIGURATION_SCOPE',
      )
    }
    if (!Object.keys(request.configuration.parameters).length) {
      return updateResult(session)
    }
    await this.applyWorkspaceParameters(
      session,
      request.configuration.parameters,
      request.expectedWorkspaceRevision,
      request.commandId,
    )
    return updateResult(session)
  }

  async updateWorkspaceStepConfiguration(
    request: EccWorkspaceStepConfigurationUpdateRequest,
  ): Promise<EccWorkspaceUpdateResult> {
    const session = this.requireSession(request.workspaceHandle)
    await this.applyWorkspaceParameters(
      session,
      request.parameters,
      request.expectedWorkspaceRevision,
      request.commandId,
      request.stepId,
    )
    return updateResult(session)
  }

  async importMacroPlacements(request: {
    commandId: string
    expectedWorkspaceRevision: number
    tcl: string
    workspaceHandle: string
  }): Promise<EccWorkspaceUpdateResult> {
    const session = this.requireSession(request.workspaceHandle)
    this.assertProjectWritable(session.projectRoot)
    await this.cli.run(
      [
        'macro',
        'import',
        '-',
        '--project',
        session.projectRoot,
        '--workspace',
        session.workspaceId,
        '--expected-revision',
        String(request.expectedWorkspaceRevision),
        '--command-id',
        request.commandId,
        '--no-wait',
      ],
      { cwd: session.projectRoot, stdin: request.tcl },
    )
    await this.refreshSessionRevision(session)
    return updateResult(session)
  }

  async readWorkspaceStepConfiguration(
    request: EccWorkspaceStepConfigurationReadRequest,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    return await this.readWorkspaceStepConfigurationForDirectory(
      this.requireSession(request.workspaceHandle).directory,
      request.step,
    )
  }

  async readWorkspaceStepConfigurationForDirectory(
    directory: string,
    step: string,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    const snapshot = await readPersistedEngineeringSnapshot(directory)
    const catalog = await this.describeWorkspaceSpec()
    const entries = Array.isArray(catalog.parameterCatalog)
      ? catalog.parameterCatalog
      : []
    const parameters = entries.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') return []
      const applies = typeof entry.appliesTo === 'string' ? entry.appliesTo : 'all'
      if (!parameterAppliesToStep(applies, step)) return []
      return [
        {
          applies,
          choices: Array.isArray(entry.choices) ? entry.choices : undefined,
          default: entry.default,
          description: typeof entry.description === 'string' ? entry.description : '',
          param: entry.id,
          range: Array.isArray(entry.range) ? entry.range : undefined,
          type: typeof entry.type === 'string' ? entry.type : '',
          unit: typeof entry.unit === 'string' ? entry.unit : undefined,
          value: Object.hasOwn(snapshot.parameters, entry.id)
            ? snapshot.parameters[entry.id]
            : entry.default,
        },
      ]
    })
    return {
      parameters,
      status: 'available',
      step,
      stepId: step,
      workspaceId: snapshot.workspaceId,
      workspaceRevision: snapshot.workspaceRevision,
    }
  }

  async workspaceStepOutputs(
    directory: string,
    step?: string,
  ): Promise<EccWorkspaceStepOutputsResult> {
    const snapshot = await readPersistedEngineeringSnapshot(directory)
    if (!snapshot.stepOutputs) throw new Error('Workspace step outputs are unavailable.')
    return step
      ? {
          ...snapshot.stepOutputs,
          steps: snapshot.stepOutputs.steps.filter((entry) => entry.step === step),
        }
      : snapshot.stepOutputs
  }

  async workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    const snapshot = await readPersistedEngineeringSnapshot(
      this.requireSession(request.workspaceHandle).directory,
    )
    const analysisStep = snapshot.analysis.steps.find(
      (step) => step.stepId === request.step,
    )
    const info = analysisStep
      ? (analysisStep as unknown as Record<string, unknown>)[request.id]
      : null
    return { id: request.id, info: info ?? null, step: request.step }
  }

  async refreshConfig(
    request: EccWorkspaceRefreshConfigRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    const session = this.requireSession(request.workspaceHandle)
    await this.runWorkspaceMutation(
      session,
      workspaceRefreshArgs({
        commandId: randomUUID(),
        expectedWorkspaceRevision: request.expectedWorkspaceRevision,
        force: request.force,
        projectRoot: session.projectRoot,
        workspaceId: session.workspaceId,
      }),
    )
    return {
      directory: session.directory,
      refreshed: true,
      workspaceRevision: session.workspaceRevision,
    }
  }

  async resetFlow(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceResetFlowResult> {
    const session = this.requireSession(request.workspaceHandle)
    await this.runWorkspaceMutation(session, [
      'workspace',
      'reset-flow',
      session.workspaceId,
      '--project',
      session.projectRoot,
      ...(request.expectedWorkspaceRevision
        ? ['--expected-revision', String(request.expectedWorkspaceRevision)]
        : []),
      '--command-id',
      randomUUID(),
      '--no-wait',
    ])
    return { directory: session.directory, workspaceRevision: session.workspaceRevision }
  }

  async exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    const session = this.requireSession(request.workspaceHandle)
    const additionalFiles = request.additionalFiles ?? []
    await this.cli.run(
      [
        'signoff',
        'export',
        '--project',
        session.projectRoot,
        '--workspace',
        session.workspaceId,
        '--output',
        request.outputPath,
        ...(request.expectedWorkspaceRevision
          ? ['--expected-revision', String(request.expectedWorkspaceRevision)]
          : []),
        '--no-wait',
        ...(additionalFiles.length ? ['--additional-files', '-'] : []),
      ],
      {
        cwd: session.projectRoot,
        ...(additionalFiles.length ? { stdin: createPosixTar(additionalFiles) } : {}),
      },
    )
    return { outputPath: request.outputPath }
  }

  async engineeringSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccEngineeringSnapshot> {
    return await readPersistedEngineeringSnapshot(
      this.requireSession(request.workspaceHandle).directory,
    )
  }

  async workspaceSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRuntimeSnapshot> {
    const session = this.requireSession(request.workspaceHandle)
    const [engineeringSnapshot, flow] = await Promise.all([
      readPersistedEngineeringSnapshot(session.directory, session.workspaceId),
      readWorkspaceFlow(session.directory),
    ])
    session.workspaceRevision = engineeringSnapshot.workspaceRevision
    return {
      configuration: {
        workspaceBindings: engineeringSnapshot.workspaceBindings ?? {},
        workspaceSpec: engineeringSnapshot.workspaceSpec ?? {},
      },
      directory: session.directory,
      engineeringSnapshot,
      flow,
      lastEventId: '',
      operations: this.operationsForSession(session.handle),
      parameters: engineeringSnapshot.parameters,
      workspaceHandle: session.handle,
    }
  }

  async startFlowOperation(request: EccRuntimeStartFlowRequest) {
    return await this.startOperation(request, 'flow')
  }

  async startStepOperation(request: EccRuntimeStartStepRequest) {
    return await this.startOperation(request, 'step')
  }

  async runFlow(request: EccFlowRunRequest): Promise<EccFlowRunResult> {
    const session = this.requireSession(request.workspaceHandle)
    const operation = await this.startOperation(
      {
        expectedWorkspaceRevision:
          request.expectedWorkspaceRevision ?? session.workspaceRevision,
        idempotencyKey: randomUUID(),
        rerun: request.rerun,
        workspaceHandle: request.workspaceHandle,
      },
      'flow',
    )
    await this.waitForOperation({ ...request, operationId: operation.operationId })
    return { rerun: Boolean(request.rerun) }
  }

  async runStep(request: EccFlowRunStepRequest): Promise<EccFlowRunStepResult> {
    const session = this.requireSession(request.workspaceHandle)
    const operation = await this.startOperation(
      {
        expectedWorkspaceRevision:
          request.expectedWorkspaceRevision ?? session.workspaceRevision,
        idempotencyKey: randomUUID(),
        rerun: request.rerun,
        step: request.step,
        workspaceHandle: request.workspaceHandle,
      },
      'step',
    )
    const terminal = await this.waitForOperation({
      ...request,
      operationId: operation.operationId,
    })
    return { state: terminal.state, step: request.step }
  }

  operationStatus(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    const tracked = this.requireOperation(request)
    return Promise.resolve({ ...tracked.operation })
  }

  waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    const tracked = this.requireOperation(request)
    if (isTerminal(tracked.operation.state))
      return Promise.resolve({ ...tracked.operation })
    return new Promise((resolveWait) => tracked.waiters.push(resolveWait))
  }

  async cancelOperation(request: EccRuntimeOperationRequest) {
    const tracked = this.requireOperation(request)
    this.assertProjectWritable(tracked.projectRoot)
    tracked.requestedCancel = true
    await this.cli.run([
      'process',
      'cancel',
      '--project',
      tracked.projectRoot,
      '--workspace',
      tracked.session.workspaceId,
      '--run-id',
      tracked.operation.operationId,
    ])
    tracked.operation = { ...tracked.operation, cancelRequested: true, updatedAt: now() }
    this.invalidate()
    return {
      accepted: true,
      operationId: tracked.operation.operationId,
      state: 'running',
    }
  }

  async cancelOperationLegacy(operationId?: string) {
    const tracked = operationId
      ? this.operations.get(operationId)
      : [...this.operations.values()].find(
          (candidate) => candidate.operation.state === 'running',
        )
    if (!tracked) return { cancelled: false, ...(operationId ? { operationId } : {}) }
    await this.cancelOperation({
      operationId: tracked.operation.operationId,
      workspaceHandle: tracked.session.handle,
    })
    return { cancelled: true, operationId: tracked.operation.operationId }
  }

  operationProjection(): EccBackgroundOperationProjection {
    return {
      creations: [],
      finalizations: [],
      generation: this.generation,
      operations: [...this.operations.values()]
        .filter((tracked) => !isTerminal(tracked.operation.state))
        .map((tracked) => ({
          ...tracked.operation,
          workspaceDirectory: tracked.session.directory,
          workspaceHandle: tracked.session.handle,
        })),
      outcomes: this.outcomes.map((operation) => {
        const tracked = this.operations.get(operation.operationId)
        return {
          ...operation,
          workspaceDirectory: tracked?.session.directory ?? '',
          workspaceHandle: tracked?.session.handle ?? '',
        }
      }),
      recoveries: [],
    }
  }

  async reconcileOperationProjection() {
    await Promise.allSettled(
      [...this.operations.values()]
        .filter((tracked) => !isTerminal(tracked.operation.state))
        .map((tracked) => this.refreshOperation(tracked)),
    )
    return this.operationProjection()
  }

  async operationLog(
    request: EccRuntimeOperationRequest,
  ): Promise<EccBackgroundOperationLogResult> {
    const tracked = this.requireOperation(request)
    const manifest = await readProjectManifest(tracked.projectRoot)
    const path = await resolveOperationLogPath({
      workspaceDirectory: tracked.session.directory,
      operationId: tracked.operation.operationId,
      entry: manifest.runtime_processes?.[tracked.session.workspaceId],
    })
    const info = await stat(path)
    const maxBytes = 64 * 1024
    const offset = Math.max(0, info.size - maxBytes)
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(info.size, maxBytes))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return {
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: offset > 0,
      }
    } finally {
      await handle.close()
    }
  }

  isWorkspaceRuntimeActive(directory: string): boolean {
    const normalized = normalizeWorkspacePath(directory)
    return [...this.operations.values()].some(
      (tracked) =>
        normalizeWorkspacePath(tracked.session.directory) === normalized &&
        !isTerminal(tracked.operation.state),
    )
  }

  hasActiveOperations(): boolean {
    return [...this.operations.values()].some(
      (tracked) => !isTerminal(tracked.operation.state),
    )
  }

  activeOperations() {
    return [...this.operations.values()]
      .filter((tracked) => !isTerminal(tracked.operation.state))
      .map((tracked) => tracked.operation)
  }

  async isRuntimeResourceInUse(resourceId: string): Promise<boolean> {
    if (!resourceId.startsWith('tool:')) return false
    if (
      this.hasActiveOperations() &&
      runtimeResourceId(this.runtimeId()) === resourceId
    ) {
      return true
    }
    for (const projectRoot of this.knownProjectRoots) {
      const manifest = await this.loadProjectManifest(projectRoot)
      if (
        Object.values(manifest.runtime_processes ?? {}).some(
          (entry) => runtimeResourceId(entry.runtime_id) === resourceId,
        )
      ) {
        return true
      }
    }
    return false
  }

  hasPendingRuntimeWork(): boolean {
    return false
  }

  waitForIdle(): Promise<void> {
    return Promise.resolve()
  }

  async flushPendingState(): Promise<void> {
    await this.reconcileOperationProjection()
  }

  async shutdown() {
    for (const tracked of this.operations.values()) {
      if (tracked.poller) clearInterval(tracked.poller)
      tracked.poller = null
      await tracked.watcher?.close()
      tracked.watcher = null
    }
    return { ok: true }
  }

  async forceShutdown(): Promise<void> {
    await this.shutdown()
  }

  retryFinalSnapshot(request: EccWorkspaceHandleRequest): Promise<boolean> {
    return this.engineeringSnapshot(request).then(() => true)
  }

  private async startOperation(
    request: EccRuntimeStartFlowRequest | EccRuntimeStartStepRequest,
    kind: 'flow' | 'step',
  ): Promise<EccRuntimeOperation> {
    await this.ensureContract()
    const session = this.requireSession(request.workspaceHandle)
    this.assertProjectWritable(session.projectRoot)
    if (this.isWorkspaceRuntimeActive(session.directory)) {
      throw codedError('Workspace already has an active ECC run.', 'WORKSPACE_BUSY')
    }
    const runId = randomUUID()
    const step = kind === 'step' ? (request as EccRuntimeStartStepRequest).step : ''
    const rerunArgs = request.rerun
      ? kind === 'step'
        ? ['--force']
        : ['--from', await firstFlowStep(session)]
      : []
    const args = [
      'run',
      '--project',
      session.projectRoot,
      '--workspace',
      session.workspaceId,
      '--expected-revision',
      String(request.expectedWorkspaceRevision),
      '--no-wait',
      '--run-id',
      runId,
      '--runtime-id',
      this.runtimeId(),
      '--log-file',
      operationLogPath(runId),
      '--command-id',
      request.idempotencyKey,
      ...(kind === 'step' ? ['--only', step] : []),
      ...rerunArgs,
    ]
    const operation = operationSnapshot(
      session,
      runId,
      kind,
      step,
      Boolean(request.rerun),
    )
    const tracked: TrackedOperation = {
      operation,
      projectRoot: session.projectRoot,
      registrationPending: true,
      requestedCancel: false,
      poller: null,
      session,
      waiters: [],
      watcher: null,
    }
    this.operations.set(runId, tracked)
    let childExited: { code: number | null; signal: NodeJS.Signals | null } | null = null
    const child = await this.cli.spawnDetached(args, {
      cwd: session.projectRoot,
      logFile: join(session.directory, operationLogPath(runId)),
    })
    child.once('exit', (code, signal) => {
      childExited = { code, signal }
      tracked.registrationPending = false
      void this.refreshOperation(tracked)
    })
    try {
      await waitFor(
        async () => {
          const manifest = await readProjectManifest(session.projectRoot)
          const entry = manifest.runtime_processes?.[session.workspaceId]
          return (
            entry?.run_id === runId &&
            entry.pid === child.pid &&
            entry.runtime_id === this.runtimeId()
          )
        },
        HANDSHAKE_TIMEOUT_MS,
        () => childExited !== null,
      )
      tracked.registrationPending = false
    } catch (error) {
      if (childExited) {
        this.operations.delete(runId)
        throw codedError(
          `ECC CLI exited before registering the run (status ${childExitStatus(childExited)}).`,
          'ECC_RUN_START_FAILED',
        )
      }
      electronLogger.warn(
        '[runtime] ECC CLI registration is still pending after the startup deadline: %s',
        error instanceof Error ? error.message : String(error),
      )
    }
    tracked.watcher = this.watchOperation(tracked)
    tracked.poller = this.pollOperation(tracked)
    this.invalidate()
    this.emitOperationEvent(tracked, 'operation.progress')
    return { ...tracked.operation }
  }

  private async restoreRegisteredOperation(
    session: WorkspaceSession,
    manifest: ProjectManifest,
  ): Promise<void> {
    const entry = manifest.runtime_processes?.[session.workspaceId]
    if (!entry || this.operations.has(entry.run_id)) return
    const alive = await this.processIsAlive(session, entry)
    if (!alive) {
      await this.cli
        .run([
          'process',
          'reconcile',
          '--project',
          session.projectRoot,
          '--workspace',
          session.workspaceId,
          '--run-id',
          entry.run_id,
          '--no-wait',
        ])
        .catch(() => undefined)
      return
    }
    const tracked: TrackedOperation = {
      operation: operationSnapshot(session, entry.run_id, 'flow', '', false),
      projectRoot: session.projectRoot,
      registrationPending: false,
      requestedCancel: false,
      poller: null,
      session,
      waiters: [],
      watcher: null,
    }
    this.operations.set(entry.run_id, tracked)
    tracked.watcher = this.watchOperation(tracked)
    tracked.poller = this.pollOperation(tracked)
    await this.refreshOperation(tracked)
  }

  private watchOperation(tracked: TrackedOperation): OperationFileWatcher {
    return watchWorkspaceOperationFiles({
      projectRoot: tracked.projectRoot,
      workspaceDirectory: tracked.session.directory,
      debounceMs: WATCH_DEBOUNCE_MS,
      onTrigger: () => void this.refreshOperation(tracked),
      onError: (error) =>
        electronLogger.error('[runtime] ECC CLI state watcher failed: %s', error),
    })
  }

  private pollOperation(tracked: TrackedOperation): ReturnType<typeof setInterval> {
    const poller = setInterval(() => {
      void this.inspectTrackedProcess(tracked)
    }, PROCESS_POLL_MS)
    poller.unref?.()
    return poller
  }

  private async inspectTrackedProcess(tracked: TrackedOperation): Promise<void> {
    if (isTerminal(tracked.operation.state)) return
    try {
      const manifest = await readProjectManifest(tracked.projectRoot)
      const entry = manifest.runtime_processes?.[tracked.session.workspaceId]
      if (tracked.registrationPending) {
        if (entry?.run_id !== tracked.operation.operationId) return
        tracked.registrationPending = false
        this.invalidate()
      }
      if (!entry || entry.run_id !== tracked.operation.operationId) {
        await this.refreshOperation(tracked)
        return
      }
      if (await this.processIsAlive(tracked.session, entry)) return
      await this.cli
        .run([
          'process',
          'reconcile',
          '--project',
          tracked.projectRoot,
          '--workspace',
          tracked.session.workspaceId,
          '--run-id',
          entry.run_id,
          '--no-wait',
        ])
        .catch((error) => {
          if (!(error instanceof EccCliCommandError) || error.exitCode !== 20) throw error
        })
      await this.refreshOperation(tracked)
    } catch (error) {
      electronLogger.warn('[runtime] ECC CLI process inspection failed', error)
    }
  }

  private async refreshOperation(tracked: TrackedOperation): Promise<void> {
    if (isTerminal(tracked.operation.state)) return
    let manifest: ProjectManifest
    let flow: PersistedFlow
    try {
      ;[manifest, flow] = await Promise.all([
        readProjectManifest(tracked.projectRoot),
        readWorkspaceFlow(tracked.session.directory),
      ])
    } catch {
      return
    }
    const current = manifest.runtime_processes?.[tracked.session.workspaceId]
    const ongoing = flow.steps.find((step) => step.state === 'Ongoing')
    tracked.operation = {
      ...tracked.operation,
      currentStep: ongoing?.name ?? tracked.operation.currentStep,
      currentTool: ongoing?.tool ?? tracked.operation.currentTool,
      updatedAt: now(),
    }
    if (current?.run_id === tracked.operation.operationId) {
      tracked.registrationPending = false
      this.invalidate()
      this.emitOperationEvent(tracked, 'operation.progress')
      return
    }
    if (tracked.registrationPending) return
    const terminal = terminalState(flow, tracked.requestedCancel)
    tracked.operation = {
      ...tracked.operation,
      error:
        terminal === 'failed'
          ? { code: 'flow_failed', message: 'ECC flow failed.' }
          : null,
      state: terminal,
      updatedAt: now(),
    }
    await tracked.watcher?.close()
    tracked.watcher = null
    if (tracked.poller) clearInterval(tracked.poller)
    tracked.poller = null
    this.outcomes.unshift({ ...tracked.operation })
    this.outcomes.splice(64)
    for (const resolveWait of tracked.waiters.splice(0))
      resolveWait({ ...tracked.operation })
    await this.refreshSessionRevision(tracked.session).catch(() => undefined)
    this.invalidate()
    this.emitOperationEvent(
      tracked,
      terminal === 'succeeded'
        ? 'operation.completed'
        : terminal === 'cancelled'
          ? 'operation.cancelled'
          : 'operation.failed',
    )
  }

  private async processIsAlive(
    session: WorkspaceSession,
    entry: ProjectRuntimeProcessEntry,
  ): Promise<boolean> {
    try {
      await this.cli.run([
        'process',
        'inspect',
        '--project',
        session.projectRoot,
        '--workspace',
        session.workspaceId,
        '--run-id',
        entry.run_id,
      ])
      return true
    } catch (error) {
      if (error instanceof EccCliCommandError && error.exitCode === 22) return false
      throw error
    }
  }

  private async applyWorkspaceParameters(
    session: WorkspaceSession,
    parameters: Record<string, unknown>,
    expectedRevision: number,
    commandId: string,
    step?: string,
  ): Promise<void> {
    const args = [
      'param',
      'apply',
      '--project',
      session.projectRoot,
      '--workspace',
      session.workspaceId,
      '--expected-revision',
      String(expectedRevision),
      '--command-id',
      commandId,
      '--no-wait',
      ...(step ? ['--step', step] : []),
      ...Object.entries(parameters).flatMap(([key, value]) => [
        '--set',
        `${key}=${encodeCliValue(value)}`,
      ]),
    ]
    await this.runWorkspaceMutation(session, args)
  }

  private async runWorkspaceMutation(session: WorkspaceSession, args: string[]) {
    this.assertProjectWritable(session.projectRoot)
    await this.cli.run(args, { cwd: session.projectRoot })
    await this.refreshSessionRevision(session)
  }

  private async refreshSessionRevision(session: WorkspaceSession) {
    const snapshot = await readPersistedEngineeringSnapshot(
      session.directory,
      session.workspaceId,
    )
    session.workspaceRevision = snapshot.workspaceRevision
  }

  private assertProjectWritable(projectRoot: string): void {
    if (this.legacyReadOnlyRoots.has(resolve(projectRoot))) {
      throw new Error(
        'This legacy project is read-only until ECC migration succeeds. Retry migration after fixing the reported issue.',
      )
    }
  }

  private operationsForSession(workspaceHandle: string) {
    return [...this.operations.values()]
      .filter((tracked) => tracked.session.handle === workspaceHandle)
      .map((tracked) => ({ ...tracked.operation }))
  }

  private requireSession(workspaceHandle: string): WorkspaceSession {
    const session = this.sessions.get(workspaceHandle)
    if (!session) throw new Error('Workspace Session is not open.')
    return session
  }

  private requireOperation(request: EccRuntimeOperationRequest): TrackedOperation {
    const tracked = this.operations.get(request.operationId)
    if (!tracked || tracked.session.handle !== request.workspaceHandle) {
      throw new Error('ECC Operation is not owned by this Workspace Session.')
    }
    return tracked
  }

  private runtimeId(): string {
    return typeof this.options.runtimeId === 'function'
      ? this.options.runtimeId()
      : (this.options.runtimeId ?? this.contractRuntimeId)
  }

  private ensureContract(): Promise<void> {
    this.contractCheck ??= Promise.resolve()
      .then(() => assertEccCliPlatformSupported())
      .then(() => this.cli.run(['version', '--json']))
      .then(({ stdout }) => {
        const value = JSON.parse(stdout)
        if (
          !isRecord(value) ||
          value.schema_version !== 2 ||
          value.runtime !== 'ECC CLI' ||
          value.cli_contract !== 1
        ) {
          throw codedError(
            'Installed ECC does not support CLI contract 1.',
            'ECC_CLI_INCOMPATIBLE',
          )
        }
        const version = typeof value.ecc === 'string' ? value.ecc : 'unknown'
        this.contractRuntimeId = `tool:ecc@${version}`
          .replace(/[^A-Za-z0-9._:@+-]/g, '-')
          .slice(0, 128)
      })
      .catch((error) => {
        this.contractCheck = null
        throw error
      })
    return this.contractCheck
  }

  private invalidate(): void {
    this.generation += 1
    for (const listener of this.projectionListeners) listener(this.generation)
  }

  private emit(event: EccRuntimeEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  private emitOperationEvent(
    tracked: TrackedOperation,
    type:
      | 'operation.progress'
      | 'operation.completed'
      | 'operation.cancelled'
      | 'operation.failed',
  ): void {
    const base = {
      method: tracked.operation.kind === 'step' ? 'flow.run_step' : 'flow.run',
      operationId: tracked.operation.operationId,
      workspaceDirectory: tracked.session.directory,
      workspaceHandle: tracked.session.handle,
    }
    if (type === 'operation.progress') {
      this.emit({
        ...base,
        data: { state: tracked.operation.state },
        phase: 'running',
        step: tracked.operation.currentStep,
        type,
      })
    } else if (type === 'operation.completed') {
      this.emit({
        ...base,
        type,
        workspaceRevision: tracked.session.workspaceRevision,
      })
    } else if (type === 'operation.cancelled') {
      this.emit({
        ...base,
        type,
        workspaceRevision: tracked.session.workspaceRevision,
      })
    } else {
      this.emit({
        ...base,
        code: tracked.operation.error?.code,
        message: tracked.operation.error?.message ?? 'ECC flow was interrupted.',
        type,
        workspaceRevision: tracked.session.workspaceRevision,
      })
    }
  }
}

function sessionResult(session: WorkspaceSession): EccWorkspaceOpenResult {
  return {
    directory: session.directory,
    workspaceHandle: session.handle,
    workspaceId: session.workspaceId,
    workspaceRevision: session.workspaceRevision,
  }
}

function updateResult(session: WorkspaceSession): EccWorkspaceUpdateResult {
  return {
    directory: session.directory,
    workspaceId: session.workspaceId,
    workspaceRevision: session.workspaceRevision,
  }
}

export async function declaredWorkspaceForDirectory(
  manifest: ProjectManifest,
  directory: string,
): Promise<{
  directory: string
  entry: ProjectManifest['workspaces'][number]
} | null> {
  const target = normalizeWorkspacePath(await realpath(directory))
  for (const entry of manifest.workspaces) {
    let declared: string
    try {
      declared = normalizeWorkspacePath(await realpath(entry.workspace_path))
    } catch {
      continue
    }
    if (declared === target) return { directory: declared, entry }
  }
  return null
}

function operationSnapshot(
  session: WorkspaceSession,
  operationId: string,
  kind: 'flow' | 'step',
  step: string,
  rerun: boolean,
): EccRuntimeOperation {
  const timestamp = now()
  return {
    createdAt: timestamp,
    currentStep: step,
    currentTool: '',
    error: null,
    interruptibility: 'safe',
    kind,
    operationId,
    origin: 'gui',
    rerun,
    result: null,
    safeToStop: true,
    state: 'running',
    step,
    updatedAt: timestamp,
    workspaceId: session.workspaceId,
    workspaceRevision: session.workspaceRevision,
  }
}

function terminalState(
  flow: PersistedFlow,
  cancelled: boolean,
): EccRuntimeOperation['state'] {
  if (cancelled) return 'cancelled'
  if (flow.steps.some((step) => ['Failed', 'Error'].includes(step.state))) return 'failed'
  if (
    flow.steps.some((step) =>
      ['Interrupted', 'Incomplete', 'Imcomplete'].includes(step.state),
    )
  ) {
    return 'interrupted'
  }
  if (
    flow.steps.length > 0 &&
    flow.steps.every((step) => ['Success', 'Skipped', 'Unstart'].includes(step.state))
  ) {
    return 'succeeded'
  }
  return 'interrupted'
}

function isTerminal(state: EccRuntimeOperation['state']): boolean {
  return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state)
}

function buildCatalog(
  parameterOutput: string,
  flowOutput: string,
): Record<string, unknown> {
  const parameterCatalog = parseEccLineRecords(parameterOutput).map((record) => {
    requireRecordKind(record, 'parameter')
    for (const key of [
      'id',
      'type',
      'default_literal',
      'applies_to',
      'maps_to_literal',
    ]) {
      requireString(record[key])
    }
    return {
      id: record.id,
      type: record.type,
      default: parseJsonLiteral(record.default_literal),
      appliesTo: record.applies_to,
      backendMapping: parseJsonLiteral(record.maps_to_literal),
      ...(record.display_key ? { display_key: record.display_key } : {}),
      ...(record.knob_id ? { knob_id: record.knob_id } : {}),
      ...(record.range_literal ? { range: parseJsonLiteral(record.range_literal) } : {}),
      ...(record.choices_literal
        ? { choices: parseJsonLiteral(record.choices_literal) }
        : {}),
      ...(record.unit ? { unit: record.unit } : {}),
      ...(record.description ? { description: record.description } : {}),
    }
  })
  const grouped = new Map<
    string,
    Array<{
      defaultSkipped: boolean
      ordinal: number
      skippable: boolean
      stepId: string
    }>
  >()
  for (const record of parseEccLineRecords(flowOutput)) {
    requireRecordKind(record, 'flow_step')
    const ordinal = parseInteger(record.ordinal)
    const entry = {
      defaultSkipped: parseBoolean(record.default_skipped),
      ordinal,
      skippable: parseBoolean(record.skippable),
      stepId: requireString(record.step_id),
    }
    const flowId = requireString(record.flow_id)
    grouped.set(flowId, [...(grouped.get(flowId) ?? []), entry])
  }
  const flowDefinitions = [...grouped].map(([flowId, entries]) => {
    entries.sort((left, right) => left.ordinal - right.ordinal)
    if (!entries.length || entries.some((entry, index) => entry.ordinal !== index)) {
      throw new Error(`ECC flow catalog ordinals are invalid: ${flowId}`)
    }
    return {
      flowId,
      stepIds: entries.map((entry) => entry.stepId),
      skippableStepIds: entries
        .filter((entry) => entry.skippable)
        .map((entry) => entry.stepId),
      defaultSkippedStepIds: entries
        .filter((entry) => entry.defaultSkipped)
        .map((entry) => entry.stepId),
    }
  })
  return { schemaVersion: 1, parameterCatalog, flowDefinitions }
}

function workspaceFlowArgs(spec: Record<string, unknown>): string[] {
  const flow = isRecord(spec.flow) ? spec.flow : {}
  return [
    ...(typeof flow.fromStepId === 'string' ? ['--from', flow.fromStepId] : []),
    ...(typeof flow.throughStepId === 'string' ? ['--to', flow.throughStepId] : []),
  ]
}

export function projectSettingsArgs(request: EccWorkspaceCreateRequest): string[] {
  const spec = request.workspaceSpec
  const bindings = request.workspaceBindings
  const design = requireRecord(spec.design)
  const pdk = requireRecord(spec.pdk)
  const flow = requireRecord(spec.flow)
  const inputBindings = requireRecord(bindings.inputs)
  const pdkBindings = requireRecord(bindings.pdk)
  const inputs = Array.isArray(spec.inputs) ? spec.inputs : []
  const byRole = new Map<string, string[]>()
  for (const value of inputs) {
    if (!isRecord(value)) continue
    const inputId = optionalString(value.inputId)
    const role = optionalString(value.role)
    const path = inputId ? optionalString(inputBindings[inputId]) : null
    if (!role || !path) continue
    byRole.set(role, [...(byRole.get(role) ?? []), path])
  }
  const rtl = [...(byRole.get('rtl') ?? []), ...(byRole.get('filelist') ?? [])]
  const parameters = isRecord(spec.parameters) ? spec.parameters : {}
  const set = (key: string, value: unknown): string[] => {
    if (typeof value === 'string' && value.trim()) return ['--set', `${key}=${value}`]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return ['--set', `${key}=${String(value)}`]
    }
    if (Array.isArray(value) && value.length) {
      return ['--set', `${key}=${JSON.stringify(value)}`]
    }
    return []
  }
  const pdkConfig = request.eccPdkConfig
  return [
    ...set('design.name', design.name),
    ...set('design.top', design.topModule),
    ...set('design.clock_port', design.clockPort),
    ...set('design.frequency_mhz', parameters['design.frequency_mhz']),
    ...set('design.rtl', rtl),
    ...set('design.netlist', byRole.get('netlist')?.[0]),
    ...set('design.def', byRole.get('def')?.[0]),
    ...set('design.sdc', byRole.get('sdc')?.[0]),
    ...set('pdk.name', pdk.familyId),
    ...set('pdk.root', pdkBindings.root),
    ...set('pdk.external_paths', pdkConfig?.externalPaths),
    ...set('pdk.overrides.tech', pdkConfig?.overrides?.tech),
    ...set('pdk.overrides.lefs', pdkConfig?.overrides?.lefs),
    ...set('pdk.overrides.libs', pdkConfig?.overrides?.libs),
    ...set('flow.preset', flow.flowId),
  ]
}

export function projectInitArgs(
  request: EccWorkspaceCreateRequest,
  requestedProjectRoot: string,
): string[] | null {
  if (request.projectMode !== 'create') return null
  if (request.deriveFrom) {
    throw new Error('A derived Workspace requires an existing Project.')
  }
  const design = requireRecord(requireRecord(request.workspaceSpec).design)
  const args = [
    'init',
    requestedProjectRoot,
    '--project-name',
    request.projectName?.trim() || basename(requestedProjectRoot),
    '--design-name',
    requireString(design.name),
  ]
  if (request.projectMpc) {
    args.push(
      '--mpc-resource-id',
      request.projectMpc.resourceId,
      '--mpc-display-name',
      request.projectMpc.displayName,
      '--mpc-version',
      request.projectMpc.version,
      '--mpc-root',
      request.projectMpc.root,
      '--mpc-design-index',
      String(request.projectMpc.designIndex),
    )
  }
  return args
}

export function projectManifestCreateArgs(
  projectRoot: string,
  mutation: Record<string, unknown>,
): string[] {
  const args = [
    'init',
    projectRoot,
    '--project-name',
    requireString(mutation.name),
    '--design-name',
    requireString(mutation.designName),
  ]
  if (mutation.mpc === undefined || mutation.mpc === null) return args
  const mpc = requireRecord(mutation.mpc)
  const design = requireRecord(mpc.design)
  args.push(
    '--mpc-resource-id',
    requireString(mpc.resource_id),
    '--mpc-display-name',
    requireString(mpc.display_name),
    '--mpc-version',
    requireString(mpc.installed_version),
    '--mpc-root',
    requireString(mpc.path),
    '--mpc-design-index',
    String(requireNonNegativeInteger(design.index)),
  )
  return args
}

export function workspaceCreateCommands(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
): string[][] {
  const workspaceId = basename(resolve(request.targetDirectory))
  if (request.deriveFrom) {
    return [
      [
        'workspace',
        'derive',
        request.deriveFrom.workspaceId,
        workspaceId,
        '--project',
        projectRoot,
        ...(request.deriveFrom.sourceStep
          ? ['--from', request.deriveFrom.sourceStep]
          : []),
        '--command-id',
        request.commandId,
        '--no-wait',
      ],
    ]
  }
  return [
    [
      'project',
      'apply',
      '--project',
      projectRoot,
      ...projectSettingsArgs(request),
      '--no-wait',
    ],
    [
      'workspace',
      'create',
      workspaceId,
      '--project',
      projectRoot,
      '--path',
      resolve(request.targetDirectory),
      '--command-id',
      request.commandId,
      '--no-wait',
      ...workspaceFlowArgs(request.workspaceSpec),
      ...parameterArgs(request.workspaceSpec.parameters),
    ],
  ]
}

export function workspaceRefreshArgs(options: {
  commandId: string
  expectedWorkspaceRevision?: number
  force?: boolean
  projectRoot: string
  workspaceId: string
}): string[] {
  return [
    'workspace',
    'refresh',
    options.workspaceId,
    '--project',
    options.projectRoot,
    ...(options.expectedWorkspaceRevision !== undefined
      ? ['--expected-revision', String(options.expectedWorkspaceRevision)]
      : []),
    '--command-id',
    options.commandId,
    '--no-wait',
    ...(options.force ? ['--force'] : []),
  ]
}

function parameterArgs(value: unknown): string[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, parameter]) => [
    '--set',
    `${key}=${encodeCliValue(parameter)}`,
  ])
}

function encodeCliValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

async function firstFlowStep(session: WorkspaceSession): Promise<string> {
  const first = (await readWorkspaceFlow(session.directory)).steps[0]?.name
  if (!first) throw new Error('Workspace flow does not contain a first step.')
  return first
}

function parameterAppliesToStep(applies: string, step: string): boolean {
  if (applies === 'all') return true
  const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]/g, '')
  return normalize(applies) === normalize(step)
}

function operationLogPath(runId: string): string {
  return `home/run-logs/${runId}.log`
}

/**
 * Resolve the log file for one operation. The registry log_path is advisory:
 * only trust it while it belongs to this exact run and resolves inside the
 * workspace without crossing symlinks; anything else falls back to the
 * run-id-derived default path (extend_cli.md §13.2).
 */
export async function resolveOperationLogPath(options: {
  workspaceDirectory: string
  operationId: string
  entry: { log_path?: string; run_id: string } | null | undefined
}): Promise<string> {
  const fallback = resolve(
    options.workspaceDirectory,
    operationLogPath(options.operationId),
  )
  if (
    options.entry &&
    options.entry.run_id === options.operationId &&
    typeof options.entry.log_path === 'string'
  ) {
    const authorized = await resolveContainedLogPath(
      options.workspaceDirectory,
      options.entry.log_path,
    )
    if (authorized) return authorized
  }
  return fallback
}

/**
 * Resolve a workspace-relative manifest path to a real file path that stays
 * inside the workspace directory. Returns null when the path is absolute,
 * traverses outside the workspace, or crosses a symlink (either itself or an
 * ancestor), so callers can fall back to an authorized default.
 */
async function resolveContainedLogPath(
  workspaceDirectory: string,
  relativePath: string,
): Promise<string | null> {
  if (isAbsolute(relativePath)) return null
  const root = resolve(workspaceDirectory)
  const target = resolve(root, relativePath)
  if (!isPathWithinRoot(target, root)) return null
  let probe = target
  // Reject symlinked targets or symlinked ancestors; the file may not exist
  // yet while the nearest existing ancestor still must stay inside the root.
  while (true) {
    try {
      const stats = await lstat(probe)
      if (stats.isSymbolicLink()) return null
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
    }
    const parent = dirname(probe)
    if (parent === probe) return null
    probe = parent
  }
  const [resolvedProbe, resolvedRoot] = await Promise.all([
    realpath(probe),
    realpath(root),
  ])
  return isPathWithinRoot(resolvedProbe, resolvedRoot) ? target : null
}

function runtimeResourceId(runtimeId: string): string | null {
  if (!runtimeId.startsWith('tool:')) return null
  return runtimeId.split('@', 1)[0] ?? null
}

function createPosixTar(
  files: readonly { archivePath: string; content: string }[],
): Uint8Array {
  if (files.length > 256) throw new Error('Signoff additional file count exceeds 256.')
  const seen = new Set<string>()
  const chunks: Buffer[] = []
  let total = 0
  for (const file of files) {
    const path = file.archivePath
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.includes('\0') ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error(`Invalid signoff additional file path: ${path}`)
    }
    if (seen.has(path)) throw new Error(`Duplicate signoff additional file path: ${path}`)
    seen.add(path)
    const content = Buffer.from(file.content, 'utf8')
    if (content.length > 16 * 1024 * 1024) {
      throw new Error(`Signoff additional file exceeds 16 MiB: ${path}`)
    }
    total += content.length
    if (total > 64 * 1024 * 1024) {
      throw new Error('Signoff additional files exceed 64 MiB.')
    }
    chunks.push(createTarHeader(path, content.length), content)
    const padding = (512 - (content.length % 512)) % 512
    if (padding) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

function createTarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  const encoded = Buffer.from(path, 'utf8')
  let name = encoded
  let prefix = Buffer.alloc(0)
  if (encoded.length > 100) {
    const split = path.lastIndexOf('/')
    if (split <= 0) throw new Error(`Signoff additional file path is too long: ${path}`)
    prefix = Buffer.from(path.slice(0, split), 'utf8')
    name = Buffer.from(path.slice(split + 1), 'utf8')
  }
  if (name.length > 100 || prefix.length > 155) {
    throw new Error(`Signoff additional file path is too long: ${path}`)
  }
  name.copy(header, 0)
  writeTarOctal(header, 100, 8, 0o600)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, size)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = 0x30
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  prefix.copy(header, 345)
  const checksum = header.reduce((sum, value) => sum + value, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

function writeTarOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const encoded = value.toString(8)
  if (encoded.length > length - 1) throw new Error('Signoff tar numeric field overflow.')
  target.write(`${encoded.padStart(length - 1, '0')}\0`, offset, length, 'ascii')
}

function requireRecordKind(record: Record<string, string>, expected: string): void {
  if (record.record !== expected)
    throw new Error(`Unexpected ECC catalog record: ${record.record}`)
}

function parseInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('ECC catalog integer is invalid.')
  }
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('ECC catalog integer is too large.')
  return result
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('Expected a non-negative integer.')
  }
  return Number(value)
}

function parseBoolean(value: unknown): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('ECC catalog boolean is invalid.')
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Required value is missing.')
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Required object is missing.')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * The CLI contract 1 process identity (pidfd, signals, detached lifecycle)
 * is Linux-only; every other platform must fail closed before any backend
 * ECC operation (gui_in_cli.md §12.4, extend_cli.md §16/§21.4).
 */
export function assertEccCliPlatformSupported(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'linux') return
  throw codedError(
    `ECC CLI backend is only supported on Linux, not on ${platform}.`,
    'ECC_CLI_PLATFORM_UNSUPPORTED',
  )
}

function now(): number {
  return Date.now() / 1000
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  aborted: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    if (aborted()) throw new Error('ECC CLI exited before its process registration.')
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('Timed out waiting for ECC CLI process registration.')
}

function childExitStatus(value: {
  code: number | null
  signal: NodeJS.Signals | null
}): string | number {
  return value.code ?? value.signal ?? 'unknown'
}
