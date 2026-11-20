import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EccCandidateCapabilitiesResult,
  EccCandidateResumeRequest,
  EccCandidateRerunRequest,
  EccRuntimeOperation,
  EccRuntimeOperationRequest,
} from '@ecos-studio/shared'
import { EccCliCommandError, type EccCliProcess } from './cliProcess'

interface SourceWorkspace {
  directory: string
  handle: string
  projectRoot: string
  workspaceId: string
}

interface CandidateRun {
  controller: AbortController
  operation: EccRuntimeOperation
  terminal: Promise<EccRuntimeOperation>
  workspaceHandle: string
}

export class CandidateOperations {
  private readonly operations = new Map<string, CandidateRun>()
  private readonly controllers = new Set<AbortController>()
  private readonly active = new Set<Promise<EccRuntimeOperation>>()

  constructor(private readonly cli: EccCliProcess) {}

  async version(): Promise<{ eccVersion: string }> {
    const result = await this.query(['candidate', 'version'])
    if (typeof result.eccVersion !== 'string' || !result.eccVersion) {
      throw new Error('ECC did not report its candidate execution revision.')
    }
    return { eccVersion: result.eccVersion }
  }

  async capabilities(source: SourceWorkspace): Promise<EccCandidateCapabilitiesResult> {
    const result = await this.query(
      candidateArgs('capabilities', source),
      source.projectRoot,
    )
    if (
      result.record !== 'candidate_capabilities' ||
      typeof result.schema !== 'string' ||
      typeof result.schema_version !== 'number' ||
      !Array.isArray(result.targets) ||
      !result.targets.every(isRecord)
    ) {
      throw new Error('ECC did not return valid candidate capabilities.')
    }
    return {
      schema: result.schema,
      schemaVersion: result.schema_version,
      targets: result.targets,
      ...(typeof result.registry_sha256 === 'string'
        ? { registrySha256: result.registry_sha256 }
        : {}),
    }
  }

  async start(
    action: 'rerun' | 'resume',
    source: SourceWorkspace,
    request: EccCandidateRerunRequest | EccCandidateResumeRequest,
  ): Promise<EccRuntimeOperation> {
    const controller = new AbortController()
    const workspaceId = `${source.workspaceId}::candidate::${request.candidateId}`
    let accept!: (operation: EccRuntimeOperation) => void
    let rejectStart!: (error: Error) => void
    const accepted = new Promise<EccRuntimeOperation>((resolve, reject) => {
      accept = resolve
      rejectStart = reject
    })
    let run: CandidateRun | undefined
    const timer = setTimeout(() => {
      if (!run) controller.abort()
    }, 30_000)
    const terminal = this.cli
      .run(candidateArgs(action, source), {
        cwd: source.projectRoot,
        signal: controller.signal,
        stdin: JSON.stringify(candidateRequest(request)),
        onStdoutLine: (line) => {
          const record = readRecord(line)
          if (record?.record !== 'candidate_accepted' || run) return
          const operation = readOperation(record.operation, workspaceId, action)
          if (!operation) return
          clearTimeout(timer)
          run = { controller, operation, terminal, workspaceHandle: source.handle }
          this.operations.set(operation.operationId, run)
          accept(operation)
        },
      })
      .then(({ stdout }) => {
        const record = stdout
          .split('\n')
          .map(readRecord)
          .reverse()
          .find((entry) => entry?.record === 'candidate_terminal')
        const operation = readOperation(record?.operation, workspaceId, action)
        if (
          !run ||
          !operation ||
          operation.operationId !== run.operation.operationId ||
          !isTerminal(operation.state)
        ) {
          throw new Error('ECC did not return a verified terminal candidate result.')
        }
        return operation
      })
      .catch((error: unknown) => {
        const failure = commandError(error)
        if (!run) {
          rejectStart(failure)
          throw failure
        }
        return {
          ...run.operation,
          state: 'failed' as const,
          error: { code: 'candidate_process_failed', message: failure.message },
          result: null,
          shutdownBarrier: false,
          updatedAt: Date.now() / 1000,
        }
      })
      .finally(() => {
        clearTimeout(timer)
        this.active.delete(terminal)
        this.controllers.delete(controller)
      })
    this.active.add(terminal)
    this.controllers.add(controller)
    void terminal.then(
      (operation) => {
        if (run) run.operation = operation
        const completed = [...this.operations].filter(([, value]) =>
          isTerminal(value.operation.state),
        )
        for (const [id] of completed.slice(0, Math.max(0, completed.length - 64))) {
          this.operations.delete(id)
        }
      },
      () => undefined,
    )
    return await accepted
  }

  async stopCandidates(source: SourceWorkspace, episodePrefix: string): Promise<void> {
    const prefix = `${source.workspaceId}::candidate::${episodePrefix}`
    const active = [...this.operations.values()].filter(
      (run) =>
        run.workspaceHandle === source.handle &&
        run.operation.workspaceId.startsWith(prefix) &&
        !isTerminal(run.operation.state),
    )
    for (const run of active) run.controller.abort()
    await Promise.all(active.map((run) => run.terminal))

    const directory = join(source.directory, '.agent', 'operations')
    const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      if (!entry.startsWith(episodePrefix) || !entry.endsWith('.json')) continue
      const id = entry.slice(0, -5)
      const record = await this.query(
        candidateArgs('status', source, ['--candidate', id]),
        source.projectRoot,
      )
      if (
        record.record !== 'candidate_status' ||
        !Array.isArray(record.operations) ||
        !record.operations.length ||
        record.operations.some(
          (operation) =>
            !isRecord(operation) ||
            (operation.state !== 'interrupted' &&
              !isTerminal(operation.state as EccRuntimeOperation['state'])),
        )
      ) {
        throw new Error('ECC candidate terminal evidence is unavailable.')
      }
    }
  }

  has(operationId: string): boolean {
    return this.operations.has(operationId)
  }

  status(request: EccRuntimeOperationRequest): EccRuntimeOperation {
    return this.requireOperation(request).operation
  }

  wait(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    return this.requireOperation(request).terminal
  }

  cancel(request: EccRuntimeOperationRequest) {
    const run = this.requireOperation(request)
    const accepted = !isTerminal(run.operation.state)
    if (accepted) {
      run.controller.abort()
      run.operation = { ...run.operation, cancelRequested: true }
    }
    return { accepted, operationId: request.operationId, state: run.operation.state }
  }

  hasActive(): boolean {
    return this.active.size > 0
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled(this.active)
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers) controller.abort()
    await this.waitForIdle()
  }

  private requireOperation(request: EccRuntimeOperationRequest): CandidateRun {
    const run = this.operations.get(request.operationId)
    if (!run || request.workspaceHandle !== run.workspaceHandle) {
      throw new Error('ECC candidate is not owned by this Workspace Session.')
    }
    return run
  }

  private async query(args: string[], cwd?: string) {
    try {
      const { stdout } = await this.cli.run(args, { cwd, timeoutMs: 10_000 })
      const record = stdout.split('\n').map(readRecord).reverse().find(Boolean)
      if (!record) throw new Error('ECC candidate response is unavailable.')
      return record
    } catch (error) {
      throw commandError(error)
    }
  }
}

function candidateArgs(
  action: string,
  source: SourceWorkspace,
  options: string[] = [],
): string[] {
  return [
    'candidate',
    action,
    ...options,
    '--project',
    source.projectRoot,
    '--',
    source.workspaceId,
  ]
}

function candidateRequest(request: EccCandidateRerunRequest | EccCandidateResumeRequest) {
  const fields = {
    candidate_id: request.candidateId,
    idempotency_key: request.idempotencyKey,
    context_sha256: request.contextSha256,
    parameter_card_sha256: request.parameterCardSha256,
    seed: request.seed,
    expected_workspace_revision: request.expectedWorkspaceRevision,
  }
  if (!('patch' in request)) return fields
  return {
    ...fields,
    target_step: request.targetStep,
    end_step: request.endStep,
    execution_scope: request.executionScope,
    patch: request.patch,
    floorplan_mode: request.floorplanMode,
    parent_candidate_root_ref: request.parentCandidateRootRef,
  }
}

function readRecord(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : undefined
  } catch {
    return
  }
}

function readOperation(
  value: unknown,
  workspaceId: string,
  action: 'rerun' | 'resume',
): EccRuntimeOperation | undefined {
  if (
    !isRecord(value) ||
    value.workspaceId !== workspaceId ||
    value.kind !== `candidate_${action}` ||
    typeof value.operationId !== 'string' ||
    !/^operation-[0-9a-f]{32}$/.test(value.operationId) ||
    !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(
      String(value.state),
    ) ||
    (value.result !== null && !isRecord(value.result))
  )
    return
  return { ...value, origin: 'gui' } as unknown as EccRuntimeOperation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTerminal(state: EccRuntimeOperation['state']): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled'
}

function commandError(error: unknown): Error {
  if (error instanceof EccCliCommandError) {
    const record = error.stdout
      .split('\n')
      .map(readRecord)
      .find((entry) => entry?.record === 'candidate_error')
    if (typeof record?.message === 'string') {
      return Object.assign(new Error(record.message), { code: record.code })
    }
    if (error.stderr.includes("No such command 'candidate'")) {
      return new Error('Installed ECC does not support candidate execution.')
    }
  }
  return error instanceof Error ? error : new Error(String(error))
}
