import { toDesktopCliData } from './desktopPayload'
import { RequestData, ResponseData, StepEnum, InfoEnum, StateEnum } from './type';
import { getDesktopApi } from '@/platform/desktop'

export interface GetInfoRequest {
  step: StepEnum;
  id: InfoEnum;
}

export interface GetInfoResponse {
  step: string;
  id: InfoEnum;
  info: any;
}

export function getInfoApi(request: RequestData<GetInfoRequest>) {
  return getDesktopApi().cli.execute({
    cmd: 'get_info',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<GetInfoResponse>>
}



export interface RTL2GDSRequest {
  directory: string;
  rerun: boolean;
}

export interface RTL2GDSResponse {
  rerun: boolean;
}

export function rtl2gdsApi(request: RequestData<RTL2GDSRequest>) {
  return getDesktopApi().cli.execute({
    cmd: 'rtl2gds',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<RTL2GDSResponse>>
}

export interface RunStepRequest {
  directory: string;
  step: StepEnum;
  rerun: boolean;
}

export interface RunStepResponse {
  step: StepEnum;
  state: StateEnum;
}

export function runStepApi(request: RequestData<RunStepRequest>) {
  return getDesktopApi().cli.execute({
    cmd: 'run_step',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<RunStepResponse>>
}

export interface RefreshConfigRequest {
  directory: string
}

export interface RefreshConfigResponse {
  directory: string
  refreshed: boolean
}

export function refreshConfigApi(request: RequestData<RefreshConfigRequest>) {
  return getDesktopApi().cli.execute({
    cmd: 'refresh_config',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<RefreshConfigResponse>>
}

export interface SyncConfigRequest {
  directory: string
  config_path: string
}

export interface SyncConfigResponse {
  directory: string
  config_path: string
  parameters_changed: boolean
  refreshed: boolean
}

export function syncConfigApi(request: RequestData<SyncConfigRequest>) {
  return getDesktopApi().cli.execute({
    cmd: 'sync_config',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<SyncConfigResponse>>
}

export interface ResetFlowRequest {
  directory: string
}

export interface ResetFlowResponse {
  directory: string
}

export function resetFlowApi(request: RequestData<ResetFlowRequest>) {
  return getDesktopApi().cli.execute({
    cmd: 'reset_flow',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<ResetFlowResponse>>
}

// ============ Home Page API ============

export interface HomePageResponse {
  path: string
}

/**
 * 调用 home_page runtime command 获取 home.json 的路径
 */
export function getHomePageApi() {
  return getDesktopApi().cli.execute({
    cmd: 'home_page',
    data: toDesktopCliData({}),
    source: 'button',
  }) as unknown as Promise<ResponseData<HomePageResponse>>
}
