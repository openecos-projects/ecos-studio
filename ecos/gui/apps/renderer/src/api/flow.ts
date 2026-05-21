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

// ============ Home Page API ============

export interface HomePageResponse {
  path: string
}

/**
 * 调用 get_home_page API 获取 home.json 的路径
 */
export function getHomePageApi() {
  return getDesktopApi().cli.execute({
    cmd: 'home_page',
    data: toDesktopCliData({}),
    source: 'button',
  }) as unknown as Promise<ResponseData<HomePageResponse>>
}
