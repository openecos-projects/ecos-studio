import { alovaInstance } from './client'
import { CMDEnum, RequestData, ResponseData, StepEnum, InfoEnum, StateEnum } from './type';

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
  return alovaInstance.Post<ResponseData<GetInfoResponse>>('/api/workspace/get_info', request as unknown as RequestData<GetInfoRequest>)
}



export interface RTL2GDSRequest {
  rerun: boolean;
}

export interface RTL2GDSResponse {
  rerun: boolean;
}

export function rtl2gdsApi(request: RequestData<RTL2GDSRequest>) {
  return alovaInstance.Post<ResponseData<RTL2GDSResponse>>('/api/workspace/rtl2gds', request as unknown as RequestData<RTL2GDSRequest>)
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
  return alovaInstance.Post<ResponseData<RunStepResponse>>('/api/workspace/run_step', request as unknown as RequestData<RunStepRequest>)
}

// ============ Home Page API ============

export interface HomePageResponse {
  path: string
}

/**
 * 调用 get_home_page API 获取 home.json 的路径
 */
export function getHomePageApi() {
  return alovaInstance.Post<ResponseData<HomePageResponse>>('/api/workspace/get_home_page', {
    cmd: CMDEnum.home_page,
    data: {}
  })
}

