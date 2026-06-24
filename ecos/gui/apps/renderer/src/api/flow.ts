import { toDesktopCliData } from './desktopPayload'
import { CMDEnum, RequestData, ResponseData, InfoEnum, StateEnum } from './type';
import { getDesktopApi } from '@/platform/desktop'
import type { DesignTool } from '@ecos-studio/shared'

export interface GetInfoRequest {
  directory?: string;
  step: string;
  id: InfoEnum;
  designTool?: DesignTool;
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
  designTool?: DesignTool;
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
  designTool?: DesignTool;
  directory: string;
  step: string;
  rerun: boolean;
  sim_test_suite?: 'cpu_tests' | 'rtthread' | 'coremark' | string;
  sim_cpu_test_mode?: 'all' | 'selected';
  sim_cpu_test_cases?: string[];
  sim_compile_preset?: 'balanced' | 'speed' | 'size' | 'debug' | 'custom' | string;
  sim_compile_opt_level?: '-O0' | '-O1' | '-O2' | '-O3' | '-Os' | '-Og' | string;
  sim_compile_march?: string;
  sim_compile_mabi?: string;
  sim_compile_extra_cflags?: string[];
  sim_coremark_iterations?: string;
  sim_coremark_total_data_size?: string;
  sim_coremark_has_float?: string;
}

export interface RunStepResponse {
  step: string;
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

// ============ Home Page API ============

export interface HomePageResponse {
  path: string
}

/**
 * 调用 home_page runtime command 获取 home.json 的路径
 */
export function getHomePageApi(request: RequestData<{ directory?: string; designTool?: DesignTool }> = {
  cmd: CMDEnum.home_page,
  data: {},
}) {
  return getDesktopApi().cli.execute({
    cmd: 'home_page',
    data: toDesktopCliData(request.data as unknown as Record<string, unknown>),
    source: 'button',
  }) as unknown as Promise<ResponseData<HomePageResponse>>
}
