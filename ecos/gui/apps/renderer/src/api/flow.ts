import { toDesktopBridgeData } from './desktopPayload'
import {
  RequestData,
  ResponseData,
  StepEnum,
  InfoEnum,
  StateEnum,
  CMDEnum,
  ResponseEnum,
} from './type'
import { getDesktopApi } from '@/platform/desktop'
import type { EccFlowCancelResult } from '@ecos-studio/shared'

function workspaceHandleFromData(data: Record<string, unknown>): string {
  return String(data.workspaceHandle ?? data.workspace_handle ?? data.directory ?? '')
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
  step: StepEnum
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
    .ecc.workspace.info({
      id: String(data.id ?? ''),
      step: String(data.step ?? ''),
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) => success(CMDEnum.get_info, result as GetInfoResponse)) as Promise<
    ResponseData<GetInfoResponse>
  >
}

export interface RTL2GDSRequest {
  directory: string
  rerun: boolean
  workspaceHandle?: string
  workspace_handle?: string
}

export interface RTL2GDSResponse {
  rerun: boolean
}

export function rtl2gdsApi(request: RequestData<RTL2GDSRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  return getDesktopApi()
    .ecc.flow.run({
      rerun: Boolean(data.rerun),
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) => success(CMDEnum.rtl2gds, result as RTL2GDSResponse)) as Promise<
    ResponseData<RTL2GDSResponse>
  >
}

export function cancelFlowApi(workspaceHandle: string): Promise<EccFlowCancelResult> {
  return getDesktopApi().ecc.flow.cancel({ workspaceHandle })
}

export interface RunStepRequest {
  directory: string
  step: StepEnum
  rerun: boolean
  workspaceHandle?: string
  workspace_handle?: string
}

export interface RunStepResponse {
  step: StepEnum
  state: StateEnum
}

export function runStepApi(request: RequestData<RunStepRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  return getDesktopApi()
    .ecc.flow.runStep({
      rerun: Boolean(data.rerun),
      step: String(data.step ?? ''),
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) => success(CMDEnum.run_step, result as RunStepResponse)) as Promise<
    ResponseData<RunStepResponse>
  >
}

export interface RefreshConfigRequest {
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
    .ecc.workspace.refreshConfig({
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) =>
      success(CMDEnum.refresh_config, result as RefreshConfigResponse),
    ) as Promise<ResponseData<RefreshConfigResponse>>
}

export interface SyncConfigRequest {
  directory: string
  config_path: string
  workspaceHandle?: string
  workspace_handle?: string
}

export interface SyncConfigResponse {
  directory: string
  config_path: string
  parameters_changed: boolean
  refreshed: boolean
}

export function syncConfigApi(request: RequestData<SyncConfigRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  return getDesktopApi()
    .ecc.workspace.syncConfig({
      configPath: String(data.config_path ?? data.configPath ?? ''),
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then(
      (result) =>
        success(CMDEnum.sync_config, {
          config_path: result.configPath,
          directory: result.directory,
          parameters_changed: result.parametersChanged,
          refreshed: result.refreshed,
        }) as ResponseData<SyncConfigResponse>,
    )
}

export interface ResetFlowRequest {
  directory: string
  workspaceHandle?: string
  workspace_handle?: string
}

export interface ResetFlowResponse {
  directory: string
}

export function resetFlowApi(request: RequestData<ResetFlowRequest>) {
  const data = toDesktopBridgeData(request.data as unknown as Record<string, unknown>)
  return getDesktopApi()
    .ecc.workspace.resetFlow({
      workspaceHandle: workspaceHandleFromData(data),
    })
    .then((result) =>
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
export function getHomePageApi(workspaceHandle = '') {
  return getDesktopApi()
    .ecc.workspace.home({ workspaceHandle })
    .then((result) => success(CMDEnum.home_page, result as HomePageResponse)) as Promise<
    ResponseData<HomePageResponse>
  >
}
