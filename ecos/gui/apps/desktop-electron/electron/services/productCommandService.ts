import type {
  EccRuntimeOperationRequest,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceHandleRequest,
  EccWorkspaceSyncConfigRequest,
  EccWorkspaceUpdateRequest,
  ProductCommandRequest,
} from '@ecos-studio/shared'

interface ProductCommandRuntime {
  cancelOperation(request: EccRuntimeOperationRequest): Promise<unknown>
  createWorkspace(request: EccWorkspaceCreateRequest): Promise<unknown>
  exportSignoff(request: EccWorkspaceExportSignoffRequest): Promise<unknown>
  resetFlow(request: EccWorkspaceHandleRequest): Promise<unknown>
  startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<unknown>
  startStepOperation(request: EccRuntimeStartStepRequest): Promise<unknown>
  syncConfig(request: EccWorkspaceSyncConfigRequest): Promise<unknown>
  updateWorkspace(request: EccWorkspaceUpdateRequest): Promise<unknown>
}

interface ProductCommandContext {
  ownsWorkspaceHandle(workspaceHandle: string): boolean
  prepareCreate(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateRequest>
  runtime: ProductCommandRuntime
  trackCreateResult(result: unknown): void
}

export async function executeProductCommand(
  value: unknown,
  context: ProductCommandContext,
): Promise<unknown> {
  const request = readProductCommandRequest(value)
  if (request.command === 'workspace.create') {
    const result = await context.runtime.createWorkspace(
      await context.prepareCreate(request.payload),
    )
    context.trackCreateResult(result)
    return result
  }

  const workspaceHandle = request.payload.workspaceHandle
  if (!context.ownsWorkspaceHandle(workspaceHandle)) {
    throw new Error('Product Command does not own this Workspace handle')
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
    case 'workspace.cancel':
      return await context.runtime.cancelOperation(request.payload)
    case 'workspace.reset':
      return await context.runtime.resetFlow(request.payload)
    case 'workspace.syncConfig':
      return await context.runtime.syncConfig(request.payload)
    case 'workspace.exportSignoff':
      return await context.runtime.exportSignoff(request.payload)
  }
}

function readProductCommandRequest(value: unknown): ProductCommandRequest {
  if (!isRecord(value) || typeof value.command !== 'string' || !isRecord(value.payload)) {
    throw new Error('Invalid Product Command')
  }
  const payload = value.payload
  switch (value.command) {
    case 'workspace.create':
      requireString(payload, 'commandId')
      requireString(payload, 'targetDirectory')
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
    case 'workspace.cancel':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'operationId')
      break
    case 'workspace.reset':
      requireString(payload, 'workspaceHandle')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.syncConfig':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'configPath')
      validateRevision(payload.expectedWorkspaceRevision)
      break
    case 'workspace.exportSignoff':
      requireString(payload, 'workspaceHandle')
      requireString(payload, 'outputPath')
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

function validateRevision(value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error('Product Command revision must be a non-negative integer')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
