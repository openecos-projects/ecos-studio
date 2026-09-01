import { toDesktopBridgeData } from './desktopPayload'
import {
  RequestData,
  ResponseData,
  InfoEnum,
  StateEnum,
  CMDEnum,
  ResponseEnum,
} from './type'
import { getDesktopApi } from '@/platform/desktop'
import type {
  EccRuntimeOperation,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceSyncConfigResult,
  DesignTool,
} from '@ecos-studio/shared'

function workspaceHandleFromData(data: Record<string, unknown>): string {
  const workspaceHandle = data.workspaceHandle ?? data.workspace_handle
  if (typeof workspaceHandle !== 'string' || !workspaceHandle.trim()) {
    throw new Error('Workspace session handle is required for runtime operations.')
  }
  return workspaceHandle
}

function designToolFromData(data: Record<string, unknown>): DesignTool {
  return data.designTool === 'frontend' ? 'frontend' : 'backend'
}

function workspaceRevisionFromData(data: Record<string, unknown>): number {
  const revision = data.expectedWorkspaceRevision ?? data.workspaceRevision
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new Error('Workspace revision is required for runtime mutations.')
  }
  return Number(revision)
}

function success<T>(cmd: CMDEnum, data: T, message: string[] = []): ResponseData<T> {
  return {
    cmd,
    data,
    message,
    response: ResponseEnum.success,
  }
}

export interface GetInfoRequest {
  workspaceHandle?: string
  workspace_handle?: string
  directory?: string
  designTool?: DesignTool
  step: string
  id: InfoEnum
}

export interface GetInfoResponse {
  step: string
  id: InfoEnum
  info: any
}

export function getInfoApi(request: RequestData<GetInfoRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  return getDesktopApi()
    .runtime.workspace.info({
      designTool: designToolFromData(data),
      id: String(data.id ?? ''),
      step: String(data.step ?? ''),
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) => success(CMDEnum.get_info, result as GetInfoResponse)) as Promise<
    ResponseData<GetInfoResponse>
  >
}

export interface RTL2GDSRequest {
  designTool?: DesignTool
  directory: string
  rerun: boolean
  workspaceHandle?: string
  workspace_handle?: string
  workspaceRevision?: number
}

export interface RTL2GDSResponse {
  rerun: boolean
}

export function rtl2gdsApi(request: RequestData<RTL2GDSRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  const runtimeRequest = {
    rerun: Boolean(data.rerun),
    workspaceHandle: workspaceHandleFromData(data),
  }
  const result =
    designToolFromData(data) === 'backend'
      ? getDesktopApi().productCommands.execute({
          command: 'workspace.run',
          payload: {
            ...runtimeRequest,
            expectedWorkspaceRevision: workspaceRevisionFromData(data),
            idempotencyKey: crypto.randomUUID(),
          },
        })
      : getDesktopApi().runtime.flow.run({
          ...runtimeRequest,
          designTool: 'frontend',
        })
  return result.then((result) =>
    success(CMDEnum.rtl2gds, result as RTL2GDSResponse),
  ) as Promise<ResponseData<RTL2GDSResponse>>
}

export interface RunStepRequest {
  designTool?: DesignTool
  directory: string
  step: string
  rerun: boolean
  workspaceHandle?: string
  workspace_handle?: string
  workspaceRevision?: number
  sim_test_suite?: string
  sim_cpu_test_mode?: 'all' | 'selected'
  sim_cpu_test_cases?: string[]
  sim_compile_preset?: string
  sim_compile_opt_level?: string
  sim_compile_march?: string
  sim_compile_mabi?: string
  sim_compile_extra_cflags?: string[]
  sim_coremark_iterations?: string
  sim_coremark_total_data_size?: string
  sim_coremark_has_float?: string
}

export interface RunStepResponse {
  step: string
  state: StateEnum
}

export function runStepApi(request: RequestData<RunStepRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  const options = Object.fromEntries(
    [
      'sim_test_suite',
      'sim_cpu_test_mode',
      'sim_cpu_test_cases',
      'sim_compile_preset',
      'sim_compile_opt_level',
      'sim_compile_march',
      'sim_compile_mabi',
      'sim_compile_extra_cflags',
      'sim_coremark_iterations',
      'sim_coremark_total_data_size',
      'sim_coremark_has_float',
    ]
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  )
  const runtimeRequest = {
    rerun: Boolean(data.rerun),
    step: String(data.step ?? ''),
    workspaceHandle: workspaceHandleFromData(data),
  }
  const result =
    designToolFromData(data) === 'backend'
      ? getDesktopApi().productCommands.execute({
          command: 'workspace.runStep',
          payload: {
            ...runtimeRequest,
            expectedWorkspaceRevision: workspaceRevisionFromData(data),
            idempotencyKey: crypto.randomUUID(),
          },
        })
      : getDesktopApi().runtime.flow.runStep({
          ...runtimeRequest,
          designTool: 'frontend',
          options,
        })
  return result.then((result) =>
    success(CMDEnum.run_step, result as RunStepResponse),
  ) as Promise<ResponseData<RunStepResponse>>
}

export function startFlowOperationApi(request: EccRuntimeStartFlowRequest) {
  return getDesktopApi().productCommands.execute({
    command: 'workspace.run',
    payload: request,
  }) as Promise<import('@ecos-studio/shared').EccRuntimeOperation>
}

export function startStepOperationApi(request: EccRuntimeStartStepRequest) {
  return getDesktopApi().productCommands.execute({
    command: 'workspace.runStep',
    payload: request,
  }) as Promise<import('@ecos-studio/shared').EccRuntimeOperation>
}

export type { EccRuntimeOperation }

export interface RefreshConfigRequest {
  designTool?: DesignTool
  directory: string
  workspaceHandle?: string
  workspace_handle?: string
}

export interface RefreshConfigResponse {
  directory: string
  refreshed: boolean
}

export function refreshConfigApi(request: RequestData<RefreshConfigRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  return getDesktopApi()
    .runtime.workspace.refreshConfig({
      designTool: designToolFromData(data),
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) =>
      success(CMDEnum.refresh_config, result as RefreshConfigResponse),
    ) as Promise<ResponseData<RefreshConfigResponse>>
}

export interface SyncConfigRequest {
  designTool?: DesignTool
  directory: string
  config_path: string
  workspaceHandle?: string
  workspace_handle?: string
  workspaceRevision?: number
}

export interface SyncConfigResponse {
  directory: string
  config_path: string
  parameters_changed: boolean
  refreshed: boolean
  workspaceRevision: number
}

export function syncConfigApi(request: RequestData<SyncConfigRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  const runtimeRequest = {
    configPath: String(data.config_path ?? data.configPath ?? ''),
    workspaceHandle: workspaceHandleFromData(data),
  }
  const result = (
    designToolFromData(data) === 'backend'
      ? getDesktopApi().productCommands.execute({
          command: 'workspace.syncConfig',
          payload: {
            ...runtimeRequest,
            expectedWorkspaceRevision: workspaceRevisionFromData(data),
          },
        })
      : getDesktopApi().runtime.workspace.syncConfig({
          ...runtimeRequest,
          designTool: 'frontend',
        })
  ) as Promise<EccWorkspaceSyncConfigResult>
  return result.then(
    (result) =>
      success(CMDEnum.sync_config, {
        config_path: result.configPath,
        directory: result.directory,
        parameters_changed: result.parametersChanged,
        refreshed: result.refreshed,
        workspaceRevision: result.workspaceRevision,
      }) as ResponseData<SyncConfigResponse>,
  )
}

export interface ResetFlowRequest {
  designTool?: DesignTool
  directory: string
  workspaceHandle?: string
  workspace_handle?: string
  workspaceRevision?: number
}

export interface ResetFlowResponse {
  directory: string
  workspaceRevision?: number
}

export function resetFlowApi(request: RequestData<ResetFlowRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  const runtimeRequest = { workspaceHandle: workspaceHandleFromData(data) }
  const result =
    designToolFromData(data) === 'backend'
      ? getDesktopApi().productCommands.execute({
          command: 'workspace.reset',
          payload: {
            ...runtimeRequest,
            expectedWorkspaceRevision: workspaceRevisionFromData(data),
          },
        })
      : getDesktopApi().runtime.workspace.resetFlow({
          ...runtimeRequest,
          designTool: 'frontend',
        })
  return result.then((result) =>
    success(CMDEnum.reset_flow, result as ResetFlowResponse),
  ) as Promise<ResponseData<ResetFlowResponse>>
}

// ============ Home Page API ============

export interface HomePageResponse {
  path: string
}

/**
 * 调用 home_page runtime command 获取 home.json 的路径
 */
export function getHomePageApi(
  workspaceHandle = '',
  designTool: DesignTool = 'backend',
  directory = '',
) {
  void directory
  return getDesktopApi()
    .runtime.workspace.home({ designTool, workspaceHandle })
    .then((result) => success(CMDEnum.home_page, result as HomePageResponse)) as Promise<
    ResponseData<HomePageResponse>
  >
}
