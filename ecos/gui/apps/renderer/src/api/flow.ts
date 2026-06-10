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
  sim_test_suite?: string;
  sim_cpu_test_mode?: 'all' | 'selected';
  sim_cpu_test_cases?: string[];
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
