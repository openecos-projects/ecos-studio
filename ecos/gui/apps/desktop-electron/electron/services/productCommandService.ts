import type {
  EccCandidateCapabilitiesRequest,
  EccCandidateResumeRequest,
  EccCandidateRerunRequest,
  EccRuntimeOperationRequest,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceConfigurationUpdateRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceDeriveRequest,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceHandleRequest,
  EccWorkspaceOpenRequest,
  EccWorkspaceStepConfigurationUpdateRequest,
  EccWorkspaceUpdateRequest,
  ProductCommandRequest,
} from '@ecos-studio/shared'

interface ProductCommandRuntime {
  cancelOperation(request: EccRuntimeOperationRequest): Promise<unknown>
  candidateCapabilities(request: EccCandidateCapabilitiesRequest): Promise<unknown>
  candidateRerun(request: EccCandidateRerunRequest): Promise<unknown>
  candidateResume(request: EccCandidateResumeRequest): Promise<unknown>
  deriveWorkspace(
    request: EccWorkspaceDeriveRequest & { workspaceHandle: string },
  ): Promise<unknown>
  retryFinalSnapshot(request: EccWorkspaceHandleRequest): Promise<boolean>
  createWorkspace(request: EccWorkspaceCreateRequest): Promise<unknown>
  exportSignoff(request: EccWorkspaceExportSignoffRequest): Promise<unknown>
  openWorkspace(request: EccWorkspaceOpenRequest): Promise<unknown>
  releaseWorkspace(request: EccWorkspaceHandleRequest): Promise<unknown>
  resetFlow(request: EccWorkspaceHandleRequest): Promise<unknown>
  startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<unknown>
  startStepOperation(request: EccRuntimeStartStepRequest): Promise<unknown>
  updateWorkspaceStepConfiguration(
    request: EccWorkspaceStepConfigurationUpdateRequest,
  ): Promise<unknown>
  updateWorkspaceConfiguration(
    request: EccWorkspaceConfigurationUpdateRequest,
  ): Promise<unknown>
  updateWorkspace(request: EccWorkspaceUpdateRequest): Promise<unknown>
}

interface ProductCommandContext {
  adoptOptimizationCandidate?(
    request: Extract<
      ProductCommandRequest,
      { command: 'optimization.adoptCandidate' }
    >['payload'],
  ): Promise<unknown>
  authorizeWorkspaceMutation?(
    command: ProductCommandRequest['command'],
    workspaceHandle: string,
    workspaceDirectory?: string,
  ): void
  workspaceDirectoryForHandle?(workspaceHandle: string): string | undefined
  beginCreate?(
    request: EccWorkspaceCreateRequest,
  ): Promise<{ creationId: string; targetDirectory: string }>
  completeCreate?(creationId: string): Promise<void>
  continueCreate?(creationId: string): Promise<{ recovered: boolean; issue?: string }>
  abandonCreate?(creationId: string): Promise<{ abandoned: boolean }>
  failCreate?(creationId: string, error: unknown): Promise<void>
  markCreateWorkspaceCreated?(
    creationId: string,
    result: { workspaceId?: string; workspaceRevision?: number },
  ): Promise<void>
  registerCreateWorkspace?(creationId: string): Promise<void>
  ownsWorkspaceHandle(workspaceHandle: string): boolean
  prepareCreate(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateRequest>
  runtime: ProductCommandRuntime
  trackCreateResult(result: unknown): void
  cleanupOptimizationEpisode?(
    request: Extract<
      ProductCommandRequest,
      { command: 'optimization.cleanup' }
    >['payload'],
  ): Promise<unknown>
}

export async function executeProductCommand(
  value: unknown,
  context: ProductCommandContext,
): Promise<unknown> {
  const request = readProductCommandRequest(value)
  if (request.command === 'workspace.continueCreation') {
    if (!context.continueCreate)
      throw new Error('Workspace creation recovery is unavailable.')
    return await context.continueCreate(request.payload.creationId)
  }
  if (request.command === 'workspace.abandonCreation') {
    if (!context.abandonCreate)
      throw new Error('Workspace creation recovery is unavailable.')
    return await context.abandonCreate(request.payload.creationId)
  }
  if (request.command === 'workspace.completeCreation') {
    if (!context.completeCreate)
      throw new Error('Workspace creation journal is unavailable.')
    await context.completeCreate(request.payload.creationId)
    return { completed: true }
  }
  if (request.command === 'workspace.failCreation') {
    if (!context.failCreate) throw new Error('Workspace creation journal is unavailable.')
    await context.failCreate(request.payload.creationId, request.payload.issue)
    return { completed: false }
  }
  if (request.command === 'workspace.create') {
    const prepared = await context.prepareCreate(request.payload)
    const creation = await context.beginCreate?.({
      ...prepared,
      ...(request.payload.projectId ? { projectId: request.payload.projectId } : {}),
      ...(request.payload.projectRoot
        ? { projectRoot: request.payload.projectRoot }
        : {}),
    })
    const creationId = creation?.creationId
    let result: unknown
    try {
      result = await context.runtime.createWorkspace({
        ...prepared,
        targetDirectory: creation?.targetDirectory ?? prepared.targetDirectory,
      })
      if (creationId) {
        await context.markCreateWorkspaceCreated?.(
          creationId,
          isRecord(result) ? result : {},
        )
        await context.registerCreateWorkspace?.(creationId)
      }
      context.trackCreateResult(result)
      return creationId && isRecord(result) ? { ...result, creationId } : result
    } catch (error) {
      let journalError: unknown
      if (creationId) {
        try {
          await context.failCreate?.(creationId, error)
        } catch (failure) {
          journalError = failure
        }
      }
      if (isRecord(result) && typeof result.workspaceHandle === 'string') {
        await context.runtime
          .releaseWorkspace({ workspaceHandle: result.workspaceHandle })
          .catch(() => undefined)
      }
      if (journalError) throw journalError
      throw error
    }
  }
  if (request.command === 'workspace.open') {
    return await context.runtime.openWorkspace(request.payload)
  }
  const workspaceHandle = request.payload.workspaceHandle
  if (!context.ownsWorkspaceHandle(workspaceHandle)) {
    throw new Error('Product Command does not own this Workspace handle')
  }
  if (GUARDED_PARENT_COMMANDS.has(request.command)) {
    context.authorizeWorkspaceMutation?.(
      request.command,
      workspaceHandle,
      context.workspaceDirectoryForHandle?.(workspaceHandle),
    )
  }

  switch (request.command) {
    case 'workspace.run':
      return await context.runtime.startFlowOperation(request.payload)
    case 'workspace.runStep':
      return await context.runtime.startStepOperation(request.payload)
    case 'workspace.update': {
      const draft = await context.prepareCreate({
        ...request.payload.draft,
        commandId: request.payload.commandId,
      })
      return await context.runtime.updateWorkspace({
        commandId: request.payload.commandId,
        expectedWorkspaceRevision: request.payload.expectedWorkspaceRevision,
        workspaceBindings: draft.workspaceBindings,
        workspaceHandle,
        workspaceSpec: draft.workspaceSpec,
      })
    }
    case 'workspace.updateConfiguration':
      return await context.runtime.updateWorkspaceConfiguration(request.payload)
    case 'workspace.updateStepConfiguration':
      return await context.runtime.updateWorkspaceStepConfiguration(request.payload)
    case 'workspace.cancel':
      return await context.runtime.cancelOperation(request.payload)
    case 'workspace.retrySnapshot':
      return {
        recovered: await context.runtime.retryFinalSnapshot(request.payload),
      }
    case 'workspace.reset':
      return await context.runtime.resetFlow(request.payload)
    case 'workspace.derive':
      return await context.runtime.deriveWorkspace(request.payload)
    case 'workspace.exportSignoff':
      return await context.runtime.exportSignoff(request.payload)
    case 'candidate.capabilities':
      return await context.runtime.candidateCapabilities(request.payload)
    case 'candidate.rerun':
      return await context.runtime.candidateRerun(request.payload)
    case 'candidate.resume':
      return await context.runtime.candidateResume(request.payload)
    case 'optimization.adoptCandidate':
      if (!context.adoptOptimizationCandidate) {
        throw new Error('Optimization Parent Adoption is unavailable.')
      }
      return await context.adoptOptimizationCandidate(request.payload)
    case 'optimization.cleanup':
      if (!context.cleanupOptimizationEpisode) {
        throw new Error('Optimization Episode cleanup is unavailable.')
      }
      return await context.cleanupOptimizationEpisode(request.payload)
  }
}

const GUARDED_PARENT_COMMANDS = new Set<ProductCommandRequest['command']>([
  'workspace.run',
  'workspace.runStep',
  'workspace.update',
  'workspace.updateConfiguration',
  'workspace.updateStepConfiguration',
  'workspace.reset',
])

function readProductCommandRequest(value: unknown): ProductCommandRequest {
  if (!isRecord(value) || typeof value.command !== 'string' || !isRecord(value.payload)) {
    throw new Error('Invalid Product Command')
  }
  const payload = value.payload
  switch (value.command) {
    case 'workspace.create':
      requireString(payload, 'commandId')
      requireString(payload, 'targetDirectory')
      requireOptionalString(payload, 'projectId')
      requireOptionalString(payload, 'projectRoot')
      requireRecord(payload, 'workspaceBindings')
      requireRecord(payload, 'workspaceSpec')
      break
    case 'workspace.run':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'idempotencyKey')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.runStep':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'idempotencyKey')
      requireString(payload, 'step')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.update':
      requireString(payload, 'commandId')
      requireString(payload, 'workspaceHandle')
      if (!isRecord(payload.draft)) throw new Error('Workspace update requires a draft')
      requireRecord(payload.draft, 'workspaceBindings')
      requireRecord(payload.draft, 'workspaceSpec')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.updateConfiguration':
      requireString(payload, 'commandId')
      requireString(payload, 'workspaceHandle')
      requireRecord(payload, 'configuration')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.updateStepConfiguration':
      requireString(payload, 'commandId')
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'stepId')
      requireRecord(payload, 'parameters')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.cancel':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'operationId')
      break
    case 'workspace.retrySnapshot':
      requireString(payload, 'workspaceHandle')
      break
    case 'workspace.continueCreation':
    case 'workspace.abandonCreation':
    case 'workspace.completeCreation':
      requireString(payload, 'creationId')
      break
    case 'workspace.failCreation':
      requireString(payload, 'creationId')
      requireString(payload, 'issue')
      break
    case 'workspace.reset':
      requireString(payload, 'workspaceHandle')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.exportSignoff':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'outputPath')
      break
    case 'workspace.open':
      requireString(payload, 'directory')
      break
    case 'workspace.derive':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'directory')
      requireString(payload, 'targetDirectory')
      if (payload.directory === payload.targetDirectory) {
        throw new Error(
          'Product Command requires targetDirectory different from directory',
        )
      }
      if (typeof payload.resetFromStep !== 'string') {
        throw new Error('Product Command requires resetFromStep')
      }
      requireOptionalString(payload, 'commandId')
      requireOptionalString(payload, 'cause')
      break
    case 'candidate.capabilities':
      requireString(payload, 'workspaceHandle')
      break
    case 'candidate.rerun':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'candidateId')
      requireString(payload, 'contextSha256')
      requireString(payload, 'executionScope')
      requireString(payload, 'endStep')
      requireString(payload, 'idempotencyKey')
      requireString(payload, 'parameterCardSha256')
      requireString(payload, 'targetStep')
      requireOptionalString(payload, 'floorplanMode')
      requireOptionalString(payload, 'parentCandidateRootRef')
      requirePatch(payload)
      requireSeed(payload.seed)
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'candidate.resume':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'candidateId')
      requireString(payload, 'contextSha256')
      requireString(payload, 'idempotencyKey')
      requireString(payload, 'parameterCardSha256')
      requireSeed(payload.seed)
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'optimization.adoptCandidate':
      requireString(payload, 'candidateId')
      requireString(payload, 'candidateRootRef')
      requireString(payload, 'episodeId')
      requireString(payload, 'idempotencyKey')
      requireString(payload, 'workspaceHandle')
      requireRecord(payload, 'evidence')
      validateRevision(payload.expectedWorkspaceRevision)
      if (
        !Array.isArray(payload.affectedFlowSteps) ||
        payload.affectedFlowSteps.length === 0
      ) {
        throw new Error('Product Command requires affectedFlowSteps')
      }
      if (!Array.isArray(payload.parameterPatch) || payload.parameterPatch.length === 0) {
        throw new Error('Product Command requires parameterPatch')
      }
      if (
        payload.affectedFlowSteps.some((step) => typeof step !== 'string' || !step.trim())
      ) {
        throw new Error('Product Command affectedFlowSteps are invalid')
      }
      if (
        payload.parameterPatch.some(
          (item) =>
            !isRecord(item) || typeof item.knob_id !== 'string' || !item.knob_id.trim(),
        )
      ) {
        throw new Error('Product Command parameterPatch is invalid')
      }
      break
    case 'optimization.cleanup':
      requireString(payload, 'episodeId')
      requireString(payload, 'parentWorkspaceDirectory')
      requireString(payload, 'workspaceHandle')
      if (payload.confirmation !== true) {
        throw new Error('Product Command cleanup requires confirmation')
      }
      if (!Array.isArray(payload.executionWorkspaceDirectories)) {
        throw new Error('Product Command requires executionWorkspaceDirectories')
      }
      if (
        payload.executionWorkspaceDirectories.some(
          (directory) => typeof directory !== 'string' || !directory.trim(),
        )
      ) {
        throw new Error('Product Command executionWorkspaceDirectories are invalid')
      }
      break
    default:
      throw new Error('Unsupported Product Command')
  }
  return value as unknown as ProductCommandRequest
}

function requireString(payload: Record<string, unknown>, key: string): void {
  if (typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`Product Command requires ${key}`)
  }
}

function requireRecord(payload: Record<string, unknown>, key: string): void {
  if (!isRecord(payload[key])) throw new Error(`Product Command requires ${key}`)
}

function requireOptionalString(payload: Record<string, unknown>, key: string): void {
  if (payload[key] !== undefined) requireString(payload, key)
}

function validateRevision(value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error('Product Command revision must be a non-negative integer')
  }
}

function requireSeed(value: unknown): void {
  if (!Number.isInteger(value)) {
    throw new Error('Product Command requires seed')
  }
}

function requirePatch(payload: Record<string, unknown>): void {
  if (!Array.isArray(payload.patch) || payload.patch.length !== 1) {
    throw new Error('Product Command requires exactly one patch item')
  }
  const item = payload.patch[0]
  if (!isRecord(item) || typeof item.knob_id !== 'string' || !item.knob_id.trim()) {
    throw new Error('Product Command requires patch knob_id')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
