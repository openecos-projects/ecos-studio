import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  EccCandidateCapabilitiesResult,
  EccCandidateResumeRequest,
  EccCandidateRerunRequest,
  EccRuntimeOperation,
} from '@ecos-studio/shared'
import { EccCliCommandError, type EccCliProcess } from './cliProcess'

interface SourceWorkspace {
  directory: string
  projectId: string
  projectRoot: string
  workspaceId: string
}

interface CandidateRun {
  controller: AbortController
  operation: EccRuntimeOperation
  terminal: Promise<EccRuntimeOperation>
  source: SourceWorkspace
}

export function isCandidateOperationId(value: string): boolean {
  return /^operation-[0-9a-f]{32}$/.test(value)
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
          run = { controller, operation, terminal, source }
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
        sameSource(run.source, source) &&
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
    const pending: string[] = []
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
        record.workspaceId !== `${source.workspaceId}::candidate::${id}`
      ) {
        throw new Error('ECC candidate terminal evidence is unavailable.')
      }
      for (const value of record.operations) {
        const action =
          isRecord(value) && value.kind === 'candidate_resume' ? 'resume' : 'rerun'
        const operation = readOperation(value, record.workspaceId, action)
        if (!operation) throw new Error('ECC candidate terminal evidence is unavailable.')
        if (!isTerminal(operation.state)) pending.push(operation.operationId)
      }
    }
    await Promise.all(pending.map((id) => this.cancel(source, id)))
    const deadline = Date.now() + 60_000
    await Promise.all(pending.map((id) => this.wait(source, id, deadline)))
  }

  async cleanupCandidates(source: SourceWorkspace, episodePrefix: string): Promise<void> {
    const record = await this.query(
      candidateArgs('cleanup', source, ['--prefix', episodePrefix]),
      source.projectRoot,
      120_000,
    )
    if (record.record !== 'candidate_cleanup' || !Number.isSafeInteger(record.removed)) {
      throw new Error('ECC did not confirm candidate cleanup.')
    }
  }

  async status(
    source: SourceWorkspace,
    operationId: string,
  ): Promise<EccRuntimeOperation> {
    const run = this.localOperation(source, operationId)
    return run?.operation ?? (await this.readOperation(source, operationId)).operation
  }

  async wait(
    source: SourceWorkspace,
    operationId: string,
    deadline = Infinity,
  ): Promise<EccRuntimeOperation> {
    const run = this.localOperation(source, operationId)
    if (run) return await run.terminal
    while (Date.now() < deadline) {
      const operation = await this.status(source, operationId)
      if (isTerminal(operation.state)) return operation
      await delay(1000)
    }
    throw new Error('ECC candidate did not reach a terminal state before the deadline.')
  }

  async cancel(source: SourceWorkspace, operationId: string) {
    const run = this.localOperation(source, operationId)
    if (!run) {
      const result = await this.readOperation(source, operationId, true)
      return { accepted: result.accepted, operationId, state: result.operation.state }
    }
    const accepted = !isTerminal(run.operation.state)
    if (accepted) {
      run.controller.abort()
      run.operation = { ...run.operation, cancelRequested: true }
    }
    return { accepted, operationId, state: run.operation.state }
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

  private localOperation(
    source: SourceWorkspace,
    operationId: string,
  ): CandidateRun | undefined {
    const run = this.operations.get(operationId)
    if (run && !sameSource(run.source, source)) {
      throw new Error('ECC candidate is not owned by this Workspace.')
    }
    return run
  }

  private async readOperation(
    source: SourceWorkspace,
    operationId: string,
    cancel = false,
  ) {
    const record = await this.query(
      candidateArgs('operation', source, [
        '--id',
        operationId,
        ...(cancel ? ['--cancel'] : []),
      ]),
      source.projectRoot,
    )
    const value = record.operation
    if (
      record.record === 'candidate_operation' &&
      typeof record.accepted === 'boolean' &&
      isRecord(value) &&
      typeof value.workspaceId === 'string' &&
      value.workspaceId.startsWith(`${source.workspaceId}::candidate::`) &&
      value.operationId === operationId
    ) {
      const action = value.kind === 'candidate_resume' ? 'resume' : 'rerun'
      const operation = readOperation(value, value.workspaceId, action)
      if (operation) return { operation, accepted: record.accepted }
    }
    throw new Error('ECC candidate operation is unavailable.')
  }

  private async query(args: string[], cwd?: string, timeoutMs = 10_000) {
    try {
      const { stdout } = await this.cli.run(args, { cwd, timeoutMs })
      const record = stdout.split('\n').map(readRecord).reverse().find(Boolean)
      if (!record) throw new Error('ECC candidate response is unavailable.')
      return record
    } catch (error) {
      throw commandError(error)
    }
  }
}

function sameSource(left: SourceWorkspace, right: SourceWorkspace): boolean {
  return (
    left.projectRoot === right.projectRoot &&
    left.projectId === right.projectId &&
    left.workspaceId === right.workspaceId &&
    left.directory === right.directory
  )
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
    !isCandidateOperationId(value.operationId) ||
    !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(
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
  return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state)
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
