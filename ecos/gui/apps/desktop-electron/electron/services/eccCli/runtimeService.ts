import { workspaceForkProbe, workspaceForkRequired } from '../cliSelfCheck'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { watch, type FSWatcher } from 'chokidar'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { stringify as stringifyToml } from 'smol-toml'
import type {
  EccBackgroundOperationLogResult,
  EccBackgroundOperationProjection,
  EccEngineeringSnapshot,
  EccFlowRunRequest,
  EccFlowRunResult,
  EccFlowRunStepRequest,
  EccFlowRunStepResult,
  EccCandidateCapabilitiesRequest,
  EccCandidateRerunRequest,
  EccCandidateResumeRequest,
  EccProjectManifest,
  EccRuntimeEvent,
  EccRuntimeOperation,
  EccRuntimeOperationRequest,
  EccRunHistoryRequest,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceCloseResult,
  EccWorkspaceConfigurationUpdateRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreationPreview,
  EccWorkspaceCreateResult,
  EccWorkspaceDeriveRequest,
  EccWorkspaceDeriveResult,
  EccWorkspaceDefViewRequest,
  EccWorkspaceDefViewResult,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceHandleRequest,
  EccWorkspaceInfoRequest,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenRequest,
  EccWorkspaceParameterRecord,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigRequest,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceRuntimeSnapshot,
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
import { normalizeWorkspacePath } from '../workspacePath'
import { calibrationReplayId, verifyCalibrationReplay } from './calibrationReplay'
import { readPersistedEngineeringSnapshot } from './engineeringSnapshotReader'
import {
  EccCliCommandError,
  EccCliProcess,
  type EccCliProcessOptions,
} from './cliProcess'
import { parseEccLineRecords, parseJsonLiteral } from './lineRecords'
import { blockedFlowStep, failedRunSteps, terminalState } from './operationOutcome'
import { CandidateOperations, isCandidateOperationId } from './candidateOperations'
import { buildOperationDiagnostics } from './operationDiagnostics'
import {
  operationLogPath,
  readOperationLog,
  readRunFailure,
  readRunHistory,
  readRunResult,
  readRunSelection,
  recentRunResults,
  RECENT_RUN_LIMIT,
  type RunSelection,
} from './operationLog'
import {
  discoverProject,
  readProjectManifest,
  readWorkspaceFlow,
  workspaceDirectoryForId,
  workspaceEntryForDirectory,
  type PersistedFlow,
  readStepWorkerFailure,
} from './persistedState'
import {
  watchWorkspaceOperationFiles,
  type WorkspaceOperationFileWatcher,
} from './workspaceFileWatcher'

const HANDSHAKE_TIMEOUT_MS = 30_000
const WATCH_DEBOUNCE_MS = 75
const PROCESS_POLL_MS = 5_000
const UNKNOWN_RUN_RESULT_MESSAGE =
  'ECC did not provide a result for this run. See the run log.'

interface WorkspaceSession {
  directory: string
  handle: string
  projectId: string
  projectRoot: string
  workspaceId: string
  workspaceRevision: number
  projectWatcher?: FSWatcher
}

type WorkspaceIdentity = Pick<
  WorkspaceSession,
  'directory' | 'projectId' | 'projectRoot' | 'workspaceId'
>

interface TrackedOperation {
  child?: { exit?: { code: number | null; signal: NodeJS.Signals | null } }
  operation: EccRuntimeOperation
  projectRoot: string
  registrationPending: boolean
  session: WorkspaceSession
  requestedCancel: boolean
  poller: ReturnType<typeof setInterval> | null
  refreshSequence: number
  watcher: WorkspaceOperationFileWatcher | null
  waiters: Array<(operation: EccRuntimeOperation) => void>
}

export interface EccCliRuntimeServiceOptions extends EccCliProcessOptions {
  mainLogFile?: string
  runtimeId?: string | (() => string)
}

export class EccCliRuntimeService {
  private readonly cli: EccCliProcess
  private readonly candidates: CandidateOperations
  private readonly sessions = new Map<string, WorkspaceSession>()
  private readonly agentWorkspaceIdentities = new Map<string, WorkspaceIdentity>()
  private readonly handleByDirectory = new Map<string, string>()
  private readonly knownProjectRoots = new Set<string>()
  private readonly operations = new Map<string, TrackedOperation>()
  private readonly defViewsInFlight = new Set<string>()
  private readonly outcomes: EccRuntimeOperation[] = []
  private readonly diagnostics = new Map<string, EccBackgroundOperationLogResult>()
  private readonly eventListeners = new Set<(event: EccRuntimeEvent) => void>()
  private readonly projectionListeners = new Set<(generation: number) => void>()
  private readonly releasedListeners = new Set<(workspaceHandle: string) => void>()
  private catalog: Record<string, unknown> | null = null
  private contractCheck: Promise<void> | null = null
  private contractRuntimeId = 'ecc-cli-contract-1'
  private generation = 0

  constructor(private readonly options: EccCliRuntimeServiceOptions) {
    this.cli = new EccCliProcess(options)
    this.candidates = new CandidateOperations(this.cli)
  }

  /** Compatibility bridge for the project doctor IPC surface. The operation
   * itself is still executed by the ECC CLI; no runtime RPC is involved. */
  async callRuntime<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (method !== 'project.doctor.check' && method !== 'project.doctor.repair') {
      throw new Error(`Unsupported ECC CLI runtime method: ${method}`)
    }
    await this.ensureContract()
    const projectDir =
      isRecord(params) && typeof params.projectDir === 'string' ? params.projectDir : ''
    if (!projectDir) throw new Error('Project doctor requires a project directory.')
    const args = ['project', 'doctor', '--project', resolve(projectDir), '--plain']
    if (method === 'project.doctor.repair') args.push('--fix')
    let output = ''
    try {
      output = (await this.cli.run(args, { cwd: resolve(projectDir) })).stdout
    } catch (error) {
      if (!(error instanceof EccCliCommandError)) throw error
      output = error.stdout || error.stderr
    }
    return projectDoctorResult(output) as T
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

  async readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
    const root = await realpath(projectRoot)
    const manifest = await readProjectManifest(root)
    this.knownProjectRoots.add(root)
    return manifest
  }

  async loadProjectManifest(projectRoot: string): Promise<ProjectManifest> {
    await this.ensureContract()
    const root = await realpath(projectRoot)
    this.knownProjectRoots.add(root)
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

  async discoverProject(directory: string) {
    const discovered = await discoverProject(directory, [...this.knownProjectRoots])
    if (discovered) this.knownProjectRoots.add(discovered.projectRoot)
    return discovered
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
    const requested = mutation as Record<string, unknown>
    const type = requireString(requested.type)
    if (type === 'create') {
      await this.cli.run(projectManifestCreateArgs(root, requested))
      const rtlImport = rtlImportArgs(root, rtlImportSelection(requested.rtlImport))
      if (rtlImport) await this.cli.run(rtlImport, { cwd: root })
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

  async readWorkspaceFlowPlan(
    projectRoot: string,
    workspaceId: string,
  ): Promise<unknown> {
    try {
      const { stdout } = await this.cli.run(
        ['flow', 'workspace', workspaceId, '--project', projectRoot, '--json'],
        { cwd: projectRoot, timeoutMs: 5_000 },
      )
      return JSON.parse(stdout)
    } catch (error) {
      // Until the pinned runtime includes "flow workspace", use a verified matching project plan.
      if (
        !(error instanceof EccCliCommandError) ||
        !error.stderr.includes("No such command 'workspace'")
      )
        throw error
    }
    const args = ['flow', 'status', '--project', projectRoot, '--json']
    try {
      const { stdout } = await this.cli.run(args, { cwd: projectRoot, timeoutMs: 5_000 })
      return JSON.parse(stdout) as unknown
    } catch (error) {
      // ECC also emits the plan when it flags missing project inputs.
      if (error instanceof EccCliCommandError && error.exitCode === 1) {
        return JSON.parse(error.stdout) as unknown
      }
      throw error
    }
  }

  async verifyPdkDefaults(familyId: string, root: string): Promise<void> {
    await this.ensureContract()
    const directory = await mkdtemp(join(tmpdir(), 'ecos-pdk-verify-'))
    try {
      await writeFile(
        join(directory, 'ecc.toml'),
        stringifyToml({ pdk: { name: familyId, root } }),
      )
      await this.cli.run(['pdk', 'verify', '--project', directory, '--plain'], {
        cwd: directory,
        timeoutMs: 15_000,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async previewWorkspaceCreation(
    request: EccWorkspaceCreateRequest,
  ): Promise<EccWorkspaceCreationPreview> {
    await this.ensureContract()
    if (!request.projectRoot?.trim() || request.deriveFrom) {
      throw new Error('Preview requires a Project and a new Workspace.')
    }
    const requestedRoot = resolve(request.projectRoot)
    if (dirname(resolve(request.targetDirectory)) !== requestedRoot) {
      throw new Error('New Workspaces must be direct children of the Project root.')
    }
    let staging: string | undefined
    try {
      if (request.projectMode === 'create') {
        staging = await mkdtemp(join(tmpdir(), 'ecos-workspace-preview-'))
        const init = projectInitArgs(request, staging)
        if (init) await this.cli.run(init)
      }
      const projectRoot = staging ?? (await realpath(requestedRoot))
      const { stdout } = await this.cli.run(
        [...workspaceDraftArgs(request, projectRoot), '--preview', '--json'],
        { cwd: projectRoot },
      )
      const records: unknown = JSON.parse(stdout)
      const preview = Array.isArray(records) ? records[0] : undefined
      if (
        preview?.record !== 'workspace_preview' ||
        !Array.isArray(preview.steps) ||
        !preview.steps.every((step: unknown) => typeof step === 'string') ||
        !Number.isSafeInteger(preview.max_parallel_steps) ||
        preview.max_parallel_steps < 1
      ) {
        throw new Error('ECC did not return a Workspace preview.')
      }
      return { steps: preview.steps, maxParallelSteps: preview.max_parallel_steps }
    } catch (error) {
      if (workspaceDraftUnsupported(error)) {
        throw new Error(
          'Flow preview requires an ECC runtime with Workspace draft support.',
        )
      }
      throw error
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true })
    }
  }

  async createWorkspace(
    request: EccWorkspaceCreateRequest,
  ): Promise<EccWorkspaceCreateResult> {
    await this.ensureContract()
    if (!request.projectRoot?.trim()) {
      throw new Error('Workspace creation requires an existing Project root.')
    }
    const requestedProjectRoot = resolve(request.projectRoot)
    if (
      !request.deriveFrom &&
      dirname(resolve(request.targetDirectory)) !== requestedProjectRoot
    ) {
      throw new Error('New Workspaces must be direct children of the Project root.')
    }
    const initArgs = projectInitArgs(request, requestedProjectRoot)
    if (initArgs) await this.cli.run(initArgs)
    const projectRoot = await realpath(requestedProjectRoot)
    await stat(join(projectRoot, 'project.json')).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('Workspace creation requires an initialized Project.')
      }
      throw error
    })
    let drafted = false
    if (!request.deriveFrom) {
      const flow = requireRecord(request.workspaceSpec.flow)
      try {
        await this.cli.run(workspaceDraftArgs(request, projectRoot), { cwd: projectRoot })
        drafted = true
      } catch (error) {
        if (!workspaceDraftUnsupported(error)) throw error
        if (flow.removeSteps !== undefined || flow.maxParallelSteps !== undefined) {
          throw new Error(
            'Removing LEC checks or setting flow concurrency requires an ECC runtime with Workspace draft support.',
          )
        }
      }
    }
    if (!drafted) {
      const rtlImport = workspaceCreateRtlImport(request, projectRoot)
      if (rtlImport) await this.cli.run(rtlImport, { cwd: projectRoot })
      for (const args of workspaceCreateCommands(request, projectRoot)) {
        await this.cli.run(args, { cwd: projectRoot })
      }
    }
    this.knownProjectRoots.add(await realpath(projectRoot))
    return await this.openWorkspace({ directory: request.targetDirectory })
  }

  async openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    await this.ensureContract()
    const directory = normalizeWorkspacePath(await realpath(request.directory))
    const existingHandle = this.handleByDirectory.get(directory)
    if (existingHandle)
      return { ...(await this.workspaceSession(existingHandle)), reused: true }
    const discovered = await this.discoverProject(directory)
    if (!discovered) throw new Error('Workspace is not declared by a Project Manifest.')
    const manifest = await this.loadProjectManifest(discovered.projectRoot)
    const declared = await declaredWorkspaceForDirectory(manifest, directory)
    if (!declared) throw new Error('Project Manifest does not declare this Workspace.')
    const entry = declared.entry
    const snapshot = await readPersistedEngineeringSnapshot(directory, entry.workspace_id)
    const session: WorkspaceSession = {
      directory,
      handle: randomUUID(),
      projectId: manifest.project_id,
      projectRoot: discovered.projectRoot,
      workspaceId: entry.workspace_id,
      workspaceRevision: snapshot.workspaceRevision,
    }
    this.sessions.set(session.handle, session)
    this.handleByDirectory.set(directory, session.handle)
    const watcher = watch(session.projectRoot, {
      depth: 0,
      followSymlinks: false,
      ignoreInitial: true,
      persistent: false,
    })
    session.projectWatcher = watcher
    watcher.on('all', (_event, path) => {
      if (basename(path) === 'project.json') this.invalidate()
    })
    watcher.on('error', (error) =>
      electronLogger.warn('[runtime] ECC Project watcher failed', error),
    )
    await new Promise<void>((ready) => watcher.once('ready', ready))
    await this.restoreWorkspaceRuns(
      session,
      await readProjectManifest(session.projectRoot),
    )
    this.emit({ type: 'runtime.ready', workspaceDirectory: directory })
    return sessionResult(session)
  }

  async workspaceSession(workspaceHandle: string): Promise<EccWorkspaceOpenResult> {
    const session = this.requireSession(workspaceHandle)
    await this.refreshSessionRevision(session)
    return sessionResult(session)
  }

  async agentWorkspaceSession(workspaceHandle: string): Promise<EccWorkspaceOpenResult> {
    const live = this.sessions.get(workspaceHandle)
    if (live) {
      const { directory, projectId, projectRoot, workspaceId } = live
      this.agentWorkspaceIdentities.set(workspaceHandle, {
        directory,
        projectId,
        projectRoot,
        workspaceId,
      })
      return await this.workspaceSession(workspaceHandle)
    }

    const previous = this.agentWorkspaceIdentities.get(workspaceHandle)
    if (!previous) throw new Error('Workspace Session is not open.')
    const project = await this.discoverProject(previous.directory)
    if (
      project?.projectId !== previous.projectId ||
      project.projectRoot !== previous.projectRoot
    ) {
      throw new Error('Agent source Project identity changed.')
    }
    const opened = await this.openWorkspace({ directory: previous.directory })
    if (
      opened.directory !== previous.directory ||
      opened.workspaceId !== previous.workspaceId
    ) {
      throw new Error('Agent source Workspace identity changed.')
    }
    return opened
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
    await session.projectWatcher?.close()
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
    const currentConfiguration = await this.readWorkspaceConfiguration(session.directory)
    const rtlImport = workspaceRtlImport(
      request,
      session.projectRoot,
      currentConfiguration,
    )
    if (rtlImport) await this.runWorkspaceMutation(session, rtlImport)

    const projectSettings = projectSettingsArgs(request)
    if (projectSettings.length) {
      await this.cli.run(
        [
          'project',
          'apply',
          '--project',
          session.projectRoot,
          ...projectSettings,
          '--no-wait',
        ],
        { cwd: session.projectRoot },
      )
    }

    await this.runWorkspaceMutation(
      session,
      workspaceRefreshArgs({
        commandId: request.commandId,
        expectedWorkspaceRevision: request.expectedWorkspaceRevision,
        force: true,
        keepBackup: request.retainBackup === true,
        projectRoot: session.projectRoot,
        workspaceId: session.workspaceId,
      }),
    )

    const parameters = isRecord(request.workspaceSpec.parameters)
      ? request.workspaceSpec.parameters
      : {}
    if (Object.keys(parameters).length) {
      await this.applyWorkspaceParameters(
        session,
        parameters,
        session.workspaceRevision,
        `${request.commandId}:parameters`,
      )
    }
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
      request.commitStepOutput === true,
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
        '--commit-step-output',
      ],
      { cwd: session.projectRoot, stdin: request.tcl },
    )
    await this.refreshSessionRevision(session)
    return updateResult(session)
  }

  async readWorkspaceStepConfiguration(
    request: EccWorkspaceStepConfigurationReadRequest,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    const session = this.requireSession(request.workspaceHandle)
    const snapshot = await readPersistedEngineeringSnapshot(
      session.directory,
      session.workspaceId,
    )
    return await this.readWorkspaceStepConfigurationFromCli(
      session.projectRoot,
      session.workspaceId,
      request.step,
      snapshot,
    )
  }

  async readWorkspaceStepConfigurationForDirectory(
    directory: string,
    step: string,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    const snapshot = await readPersistedEngineeringSnapshot(directory)
    const project = await discoverProject(directory)
    if (!project) throw new Error('Workspace project could not be discovered.')
    return await this.readWorkspaceStepConfigurationFromCli(
      project.projectRoot,
      snapshot.workspaceId,
      step,
      snapshot,
    )
  }

  private async readWorkspaceStepConfigurationFromCli(
    projectRoot: string,
    workspaceId: string,
    step: string,
    snapshot: EccEngineeringSnapshot,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    const result = await this.cli.run(
      [
        'param',
        'list',
        '--project',
        projectRoot,
        '--workspace',
        workspaceId,
        '--step',
        step,
        '--all',
        '--plain',
      ],
      { cwd: projectRoot },
    )
    const projection = parseWorkspaceParameterRecords(result.stdout)
    const parameters = projection.parameters
    const stepId = projection.stepId
    if (!stepId) throw new Error('ECC workspace parameter records have no flow step.')
    if (parameters.length === 0) {
      return {
        parameters: [],
        reason: 'step_configuration_unavailable',
        status: 'unavailable',
        step: stepId,
        stepId,
        workspaceId: snapshot.workspaceId,
        workspaceRevision: snapshot.workspaceRevision,
      }
    }
    return {
      parameters,
      status: 'available',
      step: stepId,
      stepId,
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
    const analysisStep = snapshot.analysis?.steps.find(
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

  async defView(request: EccWorkspaceDefViewRequest): Promise<EccWorkspaceDefViewResult> {
    const session = this.requireSession(request.workspaceHandle)
    const workspaceKey = normalizeWorkspacePath(session.directory)
    if (this.defViewsInFlight.has(workspaceKey)) {
      throw codedError(
        'DEF View is already running for this Workspace.',
        'WORKSPACE_BUSY',
      )
    }
    if (this.isWorkspaceRuntimeActive(session.directory)) {
      throw codedError('Workspace already has an active ECC run.', 'WORKSPACE_BUSY')
    }
    const defPath = resolve(request.defPath)
    if (!/\.def(?:\.gz)?$/i.test(defPath)) {
      throw new Error('DEF View requires a .def or .def.gz input.')
    }
    this.defViewsInFlight.add(workspaceKey)
    try {
      const input = await stat(defPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`DEF input does not exist: ${defPath}`)
        }
        throw error
      })
      if (!input.isFile()) throw new Error(`DEF input is not a file: ${defPath}`)

      await this.cli.run(
        workspaceDefViewArgs({
          defPath,
          projectRoot: session.projectRoot,
          workspaceId: session.workspaceId,
        }),
        { cwd: session.projectRoot },
      )
      const directory = join(session.directory, 'defview')
      const geometryManifestPath = join(
        directory,
        'output',
        'geometry',
        'geometry.manifest',
      )
      const manifest = await stat(geometryManifestPath).catch(() => null)
      if (!manifest?.isFile()) {
        throw new Error(
          `DEF View did not generate a geometry manifest: ${geometryManifestPath}`,
        )
      }
      return {
        defPath,
        directory,
        geometryManifestPath,
        workspaceHandle: request.workspaceHandle,
      }
    } finally {
      this.defViewsInFlight.delete(workspaceKey)
    }
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
    if (isCandidateOperationId(request.operationId)) {
      return this.candidates.status(
        this.requireSession(request.workspaceHandle),
        request.operationId,
      )
    }
    const tracked = this.requireOperation(request)
    return Promise.resolve({ ...tracked.operation })
  }

  waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    if (isCandidateOperationId(request.operationId)) {
      return this.candidates.wait(
        this.requireSession(request.workspaceHandle),
        request.operationId,
      )
    }
    const tracked = this.requireOperation(request)
    if (isTerminal(tracked.operation.state))
      return Promise.resolve({ ...tracked.operation })
    return new Promise((resolveWait) => tracked.waiters.push(resolveWait))
  }

  async cancelOperation(request: EccRuntimeOperationRequest) {
    if (isCandidateOperationId(request.operationId)) {
      return await this.candidates.cancel(
        this.requireSession(request.workspaceHandle),
        request.operationId,
      )
    }
    const tracked = this.requireOperation(request)
    tracked.requestedCancel = true
    try {
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
    } catch (error) {
      tracked.requestedCancel = false
      throw error
    }
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

  async candidateRuntimeVersion() {
    await this.ensureContract()
    return this.candidates.version()
  }

  async candidateCapabilities(request: EccCandidateCapabilitiesRequest) {
    await this.ensureContract()
    return this.candidates.capabilities(this.requireSession(request.workspaceHandle))
  }

  async candidateRerun(request: EccCandidateRerunRequest) {
    await this.ensureContract()
    return this.candidates.start(
      'rerun',
      this.requireSession(request.workspaceHandle),
      request,
    )
  }

  async stopOptimizationCandidates(workspaceHandle: string, episodePrefix: string) {
    return await this.candidates.stopCandidates(
      this.requireSession(workspaceHandle),
      episodePrefix,
    )
  }

  async candidateResume(request: EccCandidateResumeRequest) {
    await this.ensureContract()
    return this.candidates.start(
      'resume',
      this.requireSession(request.workspaceHandle),
      request,
    )
  }

  async retainOptimizationCandidate(
    workspaceHandle: string,
    candidateId: string,
    manifestSha256: string,
    target: string,
  ) {
    await this.ensureContract()
    return await this.candidates.retainCandidate(
      this.requireSession(workspaceHandle),
      candidateId,
      manifestSha256,
      target,
    )
  }

  async cleanupOptimizationCandidates(workspaceHandle: string, episodePrefix: string) {
    await this.ensureContract()
    return await this.candidates.cleanupCandidates(
      this.requireSession(workspaceHandle),
      episodePrefix,
    )
  }

  async deriveCalibrationReplay(workspaceHandle: string, replayKey: string) {
    const session = this.requireSession(workspaceHandle)
    const name = calibrationReplayId(replayKey)
    return await this.deriveWorkspace({
      commandId: name,
      directory: session.directory,
      resetFromStep: '',
      targetDirectory: join(session.projectRoot, name),
      workspaceHandle,
    })
  }

  async releaseCalibrationReplay(workspaceHandle: string, replayKey: string) {
    const source = this.requireSession(workspaceHandle)
    const workspaceId = calibrationReplayId(replayKey)
    const directory = join(source.projectRoot, workspaceId)
    const deadline = Date.now() + 25_000
    await this.loadProjectManifest(source.projectRoot)
    for (;;) {
      const manifest = await readProjectManifest(source.projectRoot)
      if (manifest.project_id !== source.projectId) {
        throw new Error('Calibration source Project identity changed.')
      }
      const entry = manifest.workspaces.find((row) => row.workspace_id === workspaceId)
      const handle = this.handleByDirectory.get(directory)
      if (!entry) {
        if (handle) await this.closeCalibrationSession(handle)
        return { ok: true }
      }
      if (entry.workspace_path !== directory || directory === source.directory) {
        throw new Error('Calibration Workspace registration changed.')
      }
      await verifyCalibrationReplay(source, directory, workspaceId)
      try {
        if (this.isWorkspaceRuntimeActive(directory)) {
          throw codedError('Calibration replay is still running.', 'workspace_busy')
        }
        // ECC checks the Workspace lock and registered process before deleting.
        await this.mutateProjectManifest(source.projectRoot, {
          type: 'delete-workspace',
          workspaceId,
          deleteDirectory: true,
        })
        if (handle) await this.closeCalibrationSession(handle)
        this.invalidate()
        return { ok: true }
      } catch (error) {
        if (
          !['workspace_busy', 'revision_conflict'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          ) ||
          Date.now() >= deadline
        )
          throw error
        await delay(500)
      }
    }
  }

  private async closeCalibrationSession(handle: string): Promise<void> {
    await this.closeWorkspace({ workspaceHandle: handle })
    this.agentWorkspaceIdentities.delete(handle)
  }

  async deriveWorkspace(
    request: EccWorkspaceDeriveRequest & { workspaceHandle: string },
  ): Promise<EccWorkspaceDeriveResult> {
    const session = this.requireSession(request.workspaceHandle)
    const target = resolve(request.targetDirectory)
    const id = basename(target)
    if (
      resolve(request.directory) !== session.directory ||
      dirname(target) !== session.projectRoot ||
      target === session.directory ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)
    ) {
      throw new Error('Invalid fork source or target directory.')
    }
    await this.cli.run(
      [
        'workspace',
        'fork',
        session.workspaceId,
        id,
        '--project',
        session.projectRoot,
        ...(request.resetFromStep ? ['--from', request.resetFromStep] : []),
        '--command-id',
        request.commandId || randomUUID(),
        '--no-wait',
      ],
      { cwd: session.projectRoot },
    )
    const opened = await this.openWorkspace({ directory: target })
    return {
      ...opened,
      workspaceRevision: this.requireSession(opened.workspaceHandle).workspaceRevision,
    }
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
          projectRoot: tracked.projectRoot,
          workspaceDirectory: tracked.session.directory,
          workspaceHandle: tracked.session.handle,
        })),
      outcomes: this.outcomes.map((operation) => {
        const tracked = this.operations.get(operation.operationId)
        return {
          ...operation,
          ...(tracked ? { projectRoot: tracked.projectRoot } : {}),
          workspaceDirectory: tracked?.session.directory ?? '',
          workspaceHandle: tracked?.session.handle ?? '',
        }
      }),
      recoveries: [],
    }
  }

  async reconcileOperationProjection() {
    await Promise.allSettled(
      [...this.sessions.values()].map(async (session) => {
        const manifest = await readProjectManifest(session.projectRoot)
        await this.restoreWorkspaceRuns(session, manifest)
      }),
    )
    await Promise.allSettled(
      [...this.operations.values()]
        .filter((tracked) => !isTerminal(tracked.operation.state))
        .map((tracked) => this.refreshOperation(tracked)),
    )
    return this.operationProjection()
  }

  async runHistory({ workspaceHandle, before }: EccRunHistoryRequest) {
    const session = this.requireSession(workspaceHandle)
    return await readRunHistory(session.directory, session.workspaceId, before)
  }

  async operationLog(
    request: EccRuntimeOperationRequest,
  ): Promise<EccBackgroundOperationLogResult> {
    const tracked = this.operations.get(request.operationId)
    const session =
      tracked?.session.handle === request.workspaceHandle
        ? tracked.session
        : this.requireSession(request.workspaceHandle)
    const result = await readRunResult(
      session.directory,
      session.workspaceId,
      request.operationId,
    )
    const operation =
      tracked?.session.handle === request.workspaceHandle
        ? tracked.operation
        : result
          ? persistedRunSnapshot(session, result)
          : undefined
    if (!operation)
      throw new Error('ECC Operation is not owned by this Workspace Session.')
    if (request.includeDiagnostics) {
      const diagnostics = this.diagnostics.get(operation.operationId)
      if (diagnostics) return diagnostics
      if (
        result ||
        operation.state === 'failed' ||
        operation.state === 'interrupted' ||
        operation.state === 'unknown'
      ) {
        const log = await readOperationLog(
          session.directory,
          operation.operationId,
        ).catch(() => null)
        return await buildOperationDiagnostics(
          operation,
          log,
          [],
          this.options.mainLogFile,
          Boolean(result && !tracked?.operation.flow),
        )
      }
      throw new Error('Run diagnostics are unavailable for this operation.')
    }
    return await readOperationLog(session.directory, operation.operationId)
  }

  isWorkspaceRuntimeActive(directory: string): boolean {
    const normalized = normalizeWorkspacePath(directory)
    return (
      this.defViewsInFlight.has(normalized) ||
      [...this.operations.values()].some(
        (tracked) =>
          normalizeWorkspacePath(tracked.session.directory) === normalized &&
          !isTerminal(tracked.operation.state),
      )
    )
  }

  hasActiveOperations(): boolean {
    return (
      this.candidates.hasActive() ||
      [...this.operations.values()].some(
        (tracked) => !isTerminal(tracked.operation.state),
      )
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
    return this.candidates.hasActive()
  }

  waitForIdle(): Promise<void> {
    return this.candidates.waitForIdle()
  }

  async flushPendingState(): Promise<void> {
    await this.reconcileOperationProjection()
  }

  async shutdown() {
    await this.candidates.shutdown()
    this.agentWorkspaceIdentities.clear()
    await Promise.all(
      [...this.sessions.values()].map(({ projectWatcher }) => projectWatcher?.close()),
    )
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
    if (this.isWorkspaceRuntimeActive(session.directory)) {
      throw codedError('Workspace already has an active ECC run.', 'WORKSPACE_BUSY')
    }
    const runId = randomUUID()
    const step = kind === 'step' ? (request as EccRuntimeStartStepRequest).step : ''
    const fromStep = kind === 'flow' ? request.fromStep : undefined
    if (fromStep !== undefined) {
      const flow = await readWorkspaceFlow(session.directory)
      if (!flow.steps.some((entry) => entry.name === fromStep)) {
        throw codedError(
          'The starting step is absent from this Workspace.',
          'STEP_NOT_FOUND',
        )
      }
    }
    const rerunArgs = fromStep
      ? ['--from', fromStep]
      : request.rerun
        ? kind === 'step'
          ? ['--force']
          : ['--from', await firstFlowStep(session)]
        : []
    if (this.isWorkspaceRuntimeActive(session.directory)) {
      throw codedError('Workspace already has an active ECC run.', 'WORKSPACE_BUSY')
    }
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
      '--plain',
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
      Boolean(request.rerun || fromStep),
    )
    if (kind === 'flow') operation.flowScope = fromStep ? { fromStep } : {}
    const childState: NonNullable<TrackedOperation['child']> = {}
    const tracked: TrackedOperation = {
      child: childState,
      operation,
      projectRoot: session.projectRoot,
      registrationPending: true,
      requestedCancel: false,
      poller: null,
      refreshSequence: 0,
      session,
      waiters: [],
      watcher: null,
    }
    this.operations.set(runId, tracked)
    try {
      const child = await this.cli.spawnDetached(args, {
        cwd: session.projectRoot,
        workspaceDirectory: session.directory,
        runId,
      })
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        childState.exit = { code, signal }
        tracked.registrationPending = false
        if (tracked.poller) void this.refreshOperation(tracked)
      }
      child.once('exit', onExit)
      if (child.exitCode !== null || child.signalCode !== null) {
        child.off('exit', onExit)
        onExit(child.exitCode, child.signalCode)
      }
    } catch (error) {
      this.operations.delete(runId)
      this.invalidate()
      throw error
    }
    try {
      await waitFor(
        async () => {
          const manifest = await readProjectManifest(session.projectRoot)
          const entry = manifest.runtime_processes?.[session.workspaceId]
          return registeredRunMatches(entry, runId, this.runtimeId())
        },
        HANDSHAKE_TIMEOUT_MS,
        () => childState.exit !== undefined,
      )
      tracked.registrationPending = false
    } catch (error) {
      if (!childState.exit) {
        electronLogger.warn(
          '[runtime] ECC CLI registration is still pending: %s',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    if (childState.exit) {
      await this.refreshOperation(tracked)
      if (isTerminal(tracked.operation.state)) return { ...tracked.operation }
    }
    const watcher = this.watchOperation(tracked)
    tracked.watcher = watcher
    tracked.poller = this.pollOperation(tracked)
    void watcher.ready.then(() => {
      if (tracked.watcher === watcher) return this.refreshOperation(tracked)
    })
    await this.refreshOperation(tracked)
    if (!tracked.operation.flow && !isTerminal(tracked.operation.state)) {
      this.invalidate()
      this.emitOperationEvent(tracked, 'operation.progress')
    }
    return { ...tracked.operation }
  }

  private async restoreWorkspaceRuns(
    session: WorkspaceSession,
    manifest: ProjectManifest,
  ) {
    await this.restoreRegisteredOperation(session, manifest)
    const results = await recentRunResults(session.directory, session.workspaceId)
    if (!this.sessions.has(session.handle)) return
    let changed = false
    for (const result of results) {
      const existing = this.operations.get(result.runId)
      if (existing) {
        if (
          isTerminal(existing.operation.state) &&
          existing.session.directory === session.directory &&
          !this.sessions.has(existing.session.handle)
        ) {
          existing.session = session
          changed = true
        }
        continue
      }
      const operation = persistedRunSnapshot(session, result)
      this.operations.set(result.runId, {
        operation,
        projectRoot: session.projectRoot,
        registrationPending: false,
        requestedCancel: false,
        poller: null,
        refreshSequence: 0,
        session,
        waiters: [],
        watcher: null,
      })
      this.outcomes.push(operation)
      changed = true
    }
    if (changed) {
      this.trimOutcomes()
      this.invalidate()
    }
  }

  private async restoreRegisteredOperation(
    session: WorkspaceSession,
    manifest: ProjectManifest,
  ): Promise<void> {
    const entry = manifest.runtime_processes?.[session.workspaceId]
    if (!entry || this.operations.has(entry.run_id)) return
    const alive = await this.processIsAlive(session, entry)
    if (this.operations.has(entry.run_id)) return
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
      operation: cliRunSnapshot(
        session,
        entry.run_id,
        entry.started_at,
        readRunSelection(entry.selection),
      ),
      projectRoot: session.projectRoot,
      registrationPending: false,
      requestedCancel: false,
      poller: null,
      refreshSequence: 0,
      session,
      waiters: [],
      watcher: null,
    }
    this.operations.set(entry.run_id, tracked)
    const watcher = this.watchOperation(tracked)
    tracked.watcher = watcher
    tracked.poller = this.pollOperation(tracked)
    await watcher.ready
    if (tracked.watcher === watcher) await this.refreshOperation(tracked)
  }

  private watchOperation(tracked: TrackedOperation): WorkspaceOperationFileWatcher {
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
        if (!registeredRunMatches(entry, tracked.operation.operationId, this.runtimeId()))
          return
        tracked.registrationPending = false
        this.invalidate()
      }
      if (!entry || entry.run_id !== tracked.operation.operationId) {
        await this.refreshOperation(tracked)
        return
      }
      if (await this.processIsAlive(tracked.session, entry)) {
        await this.refreshOperation(tracked)
        return
      }
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
    const refreshSequence = ++tracked.refreshSequence
    const [manifest, flow] = await Promise.all([
      readProjectManifest(tracked.projectRoot).catch(() => null),
      readWorkspaceFlow(tracked.session.directory).catch(() => null),
    ])
    if (
      refreshSequence !== tracked.refreshSequence ||
      isTerminal(tracked.operation.state)
    ) {
      return
    }
    const current = manifest?.runtime_processes?.[tracked.session.workspaceId]
    const ongoing = flow?.steps.find((step) => step.state === 'Ongoing')
    const currentStep = ongoing?.name ?? tracked.operation.currentStep
    const currentTool = ongoing?.tool ?? tracked.operation.currentTool
    const projectionChanged =
      currentStep !== tracked.operation.currentStep ||
      currentTool !== tracked.operation.currentTool ||
      Boolean(flow && !operationFlowMatches(tracked.operation.flow, flow))
    if (projectionChanged && flow) {
      tracked.operation = {
        ...tracked.operation,
        currentStep,
        currentTool,
        flow,
        updatedAt: now(),
      }
    }
    if (current?.run_id === tracked.operation.operationId) {
      const registrationChanged = tracked.registrationPending
      tracked.registrationPending = false
      if (!projectionChanged && !registrationChanged) return
      this.invalidate()
      this.emitOperationEvent(tracked, 'operation.progress')
      return
    }
    if (tracked.registrationPending || (tracked.child && !tracked.child.exit)) return
    if (!tracked.child && !manifest) return
    const selectedStep =
      tracked.operation.kind === 'step' ? tracked.operation.step : undefined
    const exit = tracked.child?.exit
    const result = tracked.child
      ? undefined
      : await readRunResult(
          tracked.session.directory,
          tracked.session.workspaceId,
          tracked.operation.operationId,
        )
    const terminal = result?.state ?? terminalState(tracked.requestedCancel, exit)
    const captureDiagnostics =
      terminal === 'failed' || terminal === 'interrupted' || terminal === 'unknown'
    const log = captureDiagnostics
      ? await readOperationLog(
          tracked.session.directory,
          tracked.operation.operationId,
        ).catch(() => null)
      : null
    if (
      refreshSequence !== tracked.refreshSequence ||
      isTerminal(tracked.operation.state)
    )
      return
    const failure = result?.error ?? (log ? readRunFailure(log.content) : undefined)
    const candidates =
      (terminal === 'failed' || terminal === 'interrupted') && flow
        ? failedRunSteps(
            flow,
            selectedStep,
            tracked.operation.flowScope?.fromStep,
            tracked.operation.flowScope?.throughStep,
          )
        : []
    let workerFailure: string | undefined
    const workers: string[] = []
    for (const step of candidates) {
      const message = await readStepWorkerFailure(
        tracked.session.directory,
        step,
        tracked.operation.createdAt,
      )
      if (!message) continue
      workerFailure ??= message
      workers.push(`${step.name} (${step.attemptId})
${message}`)
      if (workers.length === 64) break
    }
    if (
      refreshSequence !== tracked.refreshSequence ||
      isTerminal(tracked.operation.state)
    )
      return
    const blocked =
      terminal === 'failed' && !failure && !workerFailure && flow
        ? blockedFlowStep(
            flow,
            selectedStep,
            tracked.operation.flowScope?.fromStep,
            tracked.operation.flowScope?.throughStep,
          )
        : null
    tracked.operation = {
      ...tracked.operation,
      error:
        terminal === 'failed'
          ? (failure ??
            (workerFailure
              ? { code: 'step_worker_failed', message: workerFailure }
              : undefined) ??
            (blocked
              ? {
                  code: 'step_blocked',
                  message: `ECC blocked ${blocked.step}: ${blocked.failedItems.join(', ') || 'checklist gate'}.`,
                }
              : {
                  code: 'flow_failed',
                  message: `ECC ${candidates[0]?.name ?? (selectedStep || 'flow')} failed. See the run log.`,
                }))
          : terminal === 'interrupted'
            ? {
                code: 'run_interrupted',
                message: exit?.signal
                  ? `ECC was interrupted by ${exit.signal}. See the run log.`
                  : 'ECC execution was interrupted. See the run log.',
              }
            : terminal === 'unknown'
              ? {
                  code: 'run_outcome_unknown',
                  message: UNKNOWN_RUN_RESULT_MESSAGE,
                }
              : null,
      ...(flow ? { flow } : {}),
      ...(blocked && !selectedStep ? { flowBlock: blocked } : {}),
      state: terminal,
      updatedAt: result?.finishedAt ?? now(),
    }
    if (tracked.operation.error) {
      electronLogger.warn(
        '[runtime] ECC run %s ended in %s (%s): %s',
        tracked.operation.operationId,
        terminal,
        tracked.operation.error.code,
        tracked.operation.error.message,
      )
    }
    await tracked.watcher?.close()
    tracked.watcher = null
    if (tracked.poller) clearInterval(tracked.poller)
    tracked.poller = null
    if (captureDiagnostics) {
      this.diagnostics.set(
        tracked.operation.operationId,
        await buildOperationDiagnostics(
          tracked.operation,
          log,
          workers,
          this.options.mainLogFile,
        ),
      )
    }
    this.outcomes.push({ ...tracked.operation })
    this.trimOutcomes()
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
          : terminal === 'unknown'
            ? 'operation.unknown'
            : 'operation.failed',
    )
  }

  private trimOutcomes() {
    this.outcomes.sort((left, right) => right.updatedAt - left.updatedAt)
    for (const outcome of this.outcomes.splice(RECENT_RUN_LIMIT)) {
      this.diagnostics.delete(outcome.operationId)
    }
  }

  private async processIsAlive(
    session: WorkspaceSession,
    entry: ProjectRuntimeProcessEntry,
  ): Promise<boolean> {
    return this.isProjectProcessAlive(
      session.projectRoot,
      session.workspaceId,
      entry.run_id,
    )
  }

  async isProjectProcessAlive(
    projectRoot: string,
    workspaceId: string,
    runId: string,
  ): Promise<boolean> {
    try {
      await this.cli.run([
        'process',
        'inspect',
        '--project',
        projectRoot,
        '--workspace',
        workspaceId,
        '--run-id',
        runId,
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
    commitStepOutput = false,
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
      ...(commitStepOutput ? ['--commit-step-output'] : []),
      ...Object.entries(parameters).flatMap(([key, value]) => {
        const name = step && key.startsWith('place.') ? `${step}:${key}` : key
        return ['--set', `${name}=${encodeCliValue(value)}`]
      }),
    ]
    await this.runWorkspaceMutation(session, args)
  }

  private async runWorkspaceMutation(session: WorkspaceSession, args: string[]) {
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
      .then(async ({ stdout }) => {
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
        try {
          await this.cli.run([...workspaceForkProbe])
        } catch (error) {
          if (!(error instanceof EccCliCommandError)) throw error
          throw codedError(workspaceForkRequired, 'ECC_CLI_INCOMPATIBLE')
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
      | 'operation.unknown'
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
    } else if (type === 'operation.completed' || type === 'operation.cancelled') {
      this.emit({
        ...base,
        type,
        workspaceRevision: tracked.session.workspaceRevision,
      })
    } else if (type === 'operation.unknown') {
      this.emit({
        ...base,
        type,
        message: UNKNOWN_RUN_RESULT_MESSAGE,
        workspaceRevision: tracked.session.workspaceRevision,
      })
    } else {
      this.emit({
        ...base,
        code: tracked.operation.error?.code,
        logFile: tracked.operation.logFile,
        step: tracked.operation.step || tracked.operation.currentStep || undefined,
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
  let target: string
  try {
    target = normalizeWorkspacePath(await realpath(directory))
  } catch {
    return null
  }
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
    logFile: join(session.directory, operationLogPath(operationId)),
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

function persistedRunSnapshot(
  session: WorkspaceSession,
  result: NonNullable<Awaited<ReturnType<typeof readRunResult>>>,
): EccRuntimeOperation {
  return {
    ...cliRunSnapshot(session, result.runId, result.startedAt, result.selection),
    state: result.state,
    updatedAt: result.finishedAt,
    error:
      result.error ??
      (result.state === 'failed'
        ? { code: 'flow_failed', message: 'ECC run failed. See the run log.' }
        : result.state === 'interrupted'
          ? {
              code: 'run_interrupted',
              message: 'ECC execution was interrupted. See the run log.',
            }
          : null),
  }
}

function cliRunSnapshot(
  session: WorkspaceSession,
  runId: string,
  startedAt: number,
  { only, fromStep, throughStep }: RunSelection,
): EccRuntimeOperation {
  return {
    ...operationSnapshot(
      session,
      runId,
      only ? 'step' : 'flow',
      only ?? '',
      Boolean(fromStep),
    ),
    createdAt: startedAt,
    updatedAt: startedAt,
    origin: 'cli',
    ...(fromStep ? { flowScope: { fromStep, throughStep } } : {}),
  }
}

export function operationFlowMatches(
  current: EccRuntimeOperation['flow'],
  next: PersistedFlow,
): boolean {
  if (!current || current.steps.length !== next.steps.length) return false
  return current.steps.every((step, index) => {
    const candidate = next.steps[index]
    return (
      candidate !== undefined &&
      step.name === candidate.name &&
      step.directory === candidate.directory &&
      step.category === candidate.category &&
      step.inputStep === candidate.inputStep &&
      step.tool === candidate.tool &&
      step.state === candidate.state &&
      step.runtime === candidate.runtime &&
      step.peakMemory === candidate.peakMemory
    )
  })
}

export function registeredRunMatches(
  entry: ProjectRuntimeProcessEntry | undefined,
  runId: string,
  runtimeId: string,
): boolean {
  // The launch command may be a process supervisor such as `uv run`, so its
  // PID can differ from the ECC process that owns and registers the run.
  return entry?.run_id === runId && entry.runtime_id === runtimeId
}

function isTerminal(state: EccRuntimeOperation['state']): boolean {
  return ['succeeded', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(state)
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

function parseWorkspaceParameterRecords(output: string): {
  parameters: EccWorkspaceParameterRecord[]
  stepId: string
} {
  let stepId: string | undefined
  const parameters = parseEccLineRecords(output).flatMap((record) => {
    const recordStepId = record.step_id
    if (recordStepId) {
      if (stepId && stepId !== recordStepId) {
        throw new Error('ECC workspace parameter records disagree on the flow step.')
      }
      stepId = recordStepId
    }
    if (record.record === 'parameter_list') return []
    requireRecordKind(record, 'parameter')
    for (const key of ['id', 'type', 'value_literal', 'default_literal', 'applies_to']) {
      requireString(record[key])
    }
    const range = record.range_literal
      ? parseJsonLiteral(record.range_literal)
      : undefined
    const choices = record.choices_literal
      ? parseJsonLiteral(record.choices_literal)
      : undefined
    return [
      {
        applies: record.applies_to!,
        ...(Array.isArray(choices) ? { choices } : {}),
        default: parseJsonLiteral(record.default_literal!),
        description: record.description ?? '',
        param: record.id!,
        ...(Array.isArray(range) ? { range } : {}),
        ...(record.source ? { source: record.source } : {}),
        type: record.type!,
        ...(record.unit ? { unit: record.unit } : {}),
        value: parseJsonLiteral(record.value_literal!),
      },
    ]
  })
  return { parameters, stepId: stepId ?? '' }
}

function workspaceFlowArgs(spec: Record<string, unknown>): string[] {
  const flow = isRecord(spec.flow) ? spec.flow : {}
  return [
    ...(typeof flow.fromStepId === 'string' ? ['--from', flow.fromStepId] : []),
    ...(typeof flow.throughStepId === 'string' ? ['--to', flow.throughStepId] : []),
  ]
}

/**
 * Absolute source paths of the request's design inputs, keyed by input role.
 */
export function inputRolePaths(
  request: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
): Map<string, string[]> {
  const spec = request.workspaceSpec
  const bindings = request.workspaceBindings
  const inputBindings = requireRecord(bindings.inputs)
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
  return byRole
}

/**
 * Build the `ecc rtl import` argv that copies the request's pending RTL
 * selection into the project rtl/ directory. RTL/filelist inputs on a
 * non-derived create mean "import into the project"; reuse sends none.
 */
export function rtlImportArgs(
  projectRoot: string,
  selection: { filelist?: string | null; verilog?: string[] | null },
): string[] | null {
  const filelist =
    typeof selection.filelist === 'string' && selection.filelist.trim()
      ? selection.filelist
      : null
  const verilog = (selection.verilog ?? []).filter(
    (path) => typeof path === 'string' && path.trim(),
  )
  if (filelist && verilog.length) {
    throw new Error('RTL import accepts either a filelist or Verilog files, not both.')
  }
  if (filelist) {
    return ['rtl', 'import', '--project', projectRoot, '--filelist', filelist, '--plain']
  }
  if (!verilog.length) return null
  return [
    'rtl',
    'import',
    '--project',
    projectRoot,
    ...verilog.flatMap((path) => ['--verilog', path]),
    '--plain',
  ]
}

function workspaceCreateRtlImport(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
): string[] | null {
  if (request.deriveFrom) return null
  const byRole = inputRolePaths(request)
  return rtlImportArgs(projectRoot, {
    filelist: byRole.get('filelist')?.[0],
    verilog: byRole.get('rtl') ?? [],
  })
}

function workspaceRtlImport(
  request: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
  projectRoot: string,
  current: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
): string[] | null {
  const requested = inputRolePaths(request)
  if (sameInputRolePaths(requested, inputRolePaths(current))) return null
  return rtlImportArgs(projectRoot, {
    filelist: requested.get('filelist')?.[0],
    verilog: requested.get('rtl') ?? [],
  })
}

function sameInputRolePaths(
  left: Map<string, string[]>,
  right: Map<string, string[]>,
): boolean {
  if (left.size !== right.size) return false
  for (const [role, paths] of left) {
    const other = right.get(role)
    if (!other || other.length !== paths.length) return false
    if (paths.some((path, index) => path !== other[index])) return false
  }
  return true
}

export function projectSettingsArgs(
  request: Pick<
    EccWorkspaceCreateRequest,
    'workspaceSpec' | 'workspaceBindings' | 'eccPdkConfig'
  >,
): string[] {
  const spec = request.workspaceSpec
  const bindings = request.workspaceBindings
  const design = requireRecord(spec.design)
  const pdk = requireRecord(spec.pdk)
  const flow = requireRecord(spec.flow)
  const pdkBindings = requireRecord(bindings.pdk)
  const byRole = inputRolePaths(request)
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
  // design.rtl is intentionally absent: RTL sources are imported into the
  // project rtl/ directory by `ecc rtl import` (see workspaceCreateRtlImport)
  // and ECC materializes workspaces from the project's ecc.toml.
  return [
    ...set('design.name', design.name),
    ...set('design.top', design.topModule),
    ...set('design.clock_port', design.clockPort),
    ...set('design.frequency_mhz', parameters['design.frequency_mhz']),
    ...set('design.netlist', byRole.get('netlist')?.[0]),
    ...set('design.def', byRole.get('def')?.[0]),
    ...set('design.sdc', byRole.get('sdc')?.[0]),
    ...set('design.golden_netlist', byRole.get('golden_netlist')?.[0]),
    ...set('design.spef', byRole.get('spef')?.[0]),
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

function workspaceDraftUnsupported(error: unknown): boolean {
  return (
    error instanceof EccCliCommandError &&
    /No such option:\s*--draft\b/.test(error.stderr)
  )
}

export function workspaceDraftArgs(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
): string[] {
  const flow = requireRecord(request.workspaceSpec.flow)
  const selection = inputRolePaths(request)
  const filelist = selection.get('filelist')?.[0]
  const rtl = selection.get('rtl')
  const values = (value: unknown) =>
    flowEditFlags('--step', value).filter((_, i) => i % 2)
  const draft = {
    settings: projectSettingsArgs(request).filter((_, i) => i % 2),
    enable: values(flow.enableSteps),
    disable: values(flow.disableSteps),
    insert: values(flow.insertSteps),
    remove: values(flow.removeSteps),
    maxParallelSteps: flow.maxParallelSteps,
    filelist,
    rtl,
  }
  const target = resolve(request.targetDirectory)
  return [
    'workspace',
    'create',
    basename(target),
    '--project',
    projectRoot,
    '--path',
    join(projectRoot, basename(target)),
    '--command-id',
    request.commandId,
    '--no-wait',
    ...workspaceFlowArgs(request.workspaceSpec),
    ...parameterArgs(request.workspaceSpec.parameters),
    '--draft',
    JSON.stringify(draft),
  ]
}

export function workspaceCreateCommands(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
): string[][] {
  const workspaceId = basename(resolve(request.targetDirectory))
  if (request.deriveFrom) {
    const flow = requireRecord(request.workspaceSpec.flow)
    if (
      typeof flow.fromStepId !== 'string' ||
      !flow.fromStepId.trim() ||
      typeof flow.throughStepId !== 'string' ||
      !flow.throughStepId.trim()
    ) {
      throw new Error('Creating from output requires a continuation step and endpoint.')
    }
    const parameters = parameterArgs(request.workspaceSpec.parameters)
    return [
      [
        'workspace',
        'fork',
        request.deriveFrom.workspaceId,
        workspaceId,
        '--project',
        projectRoot,
        '--from',
        flow.fromStepId,
        '--to',
        flow.throughStepId,
        '--command-id',
        request.commandId,
        '--no-wait',
      ],
      ...(parameters.length
        ? [
            [
              'param',
              'apply',
              '--project',
              projectRoot,
              '--workspace',
              workspaceId,
              '--no-wait',
              ...parameters,
            ],
          ]
        : []),
    ]
  }
  const flow = requireRecord(request.workspaceSpec.flow)
  const edits = [
    ...flowEditFlags('--enable', flow.enableSteps),
    ...flowEditFlags('--disable', flow.disableSteps),
    ...flowEditFlags('--insert', flow.insertSteps),
  ]
  return [
    [
      'project',
      'apply',
      '--project',
      projectRoot,
      ...projectSettingsArgs(request),
      '--no-wait',
    ],
    ...(edits.length
      ? [['flow', 'edit', '--project', projectRoot, '--yes', '--plain', ...edits]]
      : []),
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

function flowEditFlags(flag: string, value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some(
      (step) =>
        typeof step !== 'string' || !/^[a-z][a-z0-9_]*(?:@[a-z][a-z0-9_]*)?$/.test(step),
    )
  ) {
    throw new Error('Flow selection contains an invalid ECC step.')
  }
  return value.flatMap((step: string) => [flag, step])
}

export function workspaceRefreshArgs(options: {
  commandId: string
  expectedWorkspaceRevision?: number
  force?: boolean
  keepBackup?: boolean
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
    ...(options.keepBackup ? ['--keep-backup'] : []),
  ]
}

export function workspaceDefViewArgs(options: {
  defPath: string
  projectRoot: string
  workspaceId: string
}): string[] {
  return [
    'defview',
    '--project',
    options.projectRoot,
    '--workspace',
    options.workspaceId,
    '--def',
    resolve(options.defPath),
    '--plain',
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

export function workspaceParameterValue(
  parameters: Record<string, unknown>,
  entry: Record<string, unknown>,
): unknown {
  const directKeys = [entry.id, entry.backendMapping, entry.display_key]
  for (const key of directKeys) {
    if (typeof key === 'string' && Object.hasOwn(parameters, key)) {
      return parameters[key]
    }
  }
  if (isRecord(entry.backendMapping)) {
    for (const [section, key] of Object.entries(entry.backendMapping)) {
      const values = parameters[section]
      if (typeof key === 'string' && isRecord(values) && Object.hasOwn(values, key)) {
        return values[key]
      }
    }
  }
  return entry.default
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

function projectDoctorResult(output: string): Record<string, unknown> {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return { doctor: 'project', status: 'not_applicable' }
  const records = parseEccLineRecords(
    lines.map((line) => `record=project_doctor ${line}`).join('\n'),
  )
  const primary = records.find((record) => record.doctor === 'project')
  if (!primary) return { doctor: 'project', status: 'not_applicable' }
  const findings = records.filter((record) => record.check)
  return {
    doctor: 'project',
    status: primary.status,
    checked: primary.checked ? parseInteger(primary.checked) : 0,
    inconsistent: primary.inconsistent ? parseInteger(primary.inconsistent) : 0,
    ...(primary.fixed ? { fixed: parseInteger(primary.fixed) } : {}),
    findings,
  }
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

/**
 * Normalize an untyped create-mutation `rtlImport` record into the selection
 * shape consumed by rtlImportArgs. Shape validity is enforced upstream by
 * validateProjectManifestMutation.
 */
function rtlImportSelection(value: unknown): {
  filelist?: string | null
  verilog?: string[] | null
} {
  if (!isRecord(value)) return {}
  const filelist = optionalString(value.filelist)
  const verilog = Array.isArray(value.verilog)
    ? value.verilog.filter((item): item is string => typeof item === 'string')
    : []
  return { filelist, verilog }
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
