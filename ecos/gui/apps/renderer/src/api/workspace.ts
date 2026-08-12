import { toDesktopBridgeData } from './desktopPayload'
import { CMDEnum, ResponseEnum } from './type'
import { getDesktopApi } from '@/platform/desktop'

// Types for API requests and responses
export interface ProjectInfo {
  name: string
  path: string
  flow?: Record<string, unknown>
}

export interface WorkspaceResponse {
  cmd: CMDEnum
  response: string
  data: {
    directory: string
    workspace_handle?: string
    workspaceHandle?: string
  }
  message: string[]
}

export interface LoadWorkspaceRequest {
  cmd: CMDEnum.load_workspace
  data: {
    directory: string
  }
}

export interface CreateWorkspaceRequest {
  cmd: CMDEnum.create_workspace
  data: {
    pdk: string
    pdk_root: string
    directory: string
    parameters: Record<string, unknown>
    origin_def: string
    origin_verilog: string
    filelist: string
    rtl_list: string[]
    design_input_mode?: string
    sdc?: string
    flow_config?: Record<string, unknown>
    pdk_config_mode?: string
    pdk_config?: Record<string, unknown>
    pdk_json?: unknown
    project_context?: Record<string, unknown>
  }
}

/**
 * Open an existing project
 * @param path - Full path to the project directory
 */
export function loadWorkspaceApi(directory: string) {
  return getDesktopApi()
    .ecc.workspace.open({ directory })
    .then((result) => ({
      cmd: CMDEnum.load_workspace,
      data: {
        directory: result.directory,
        workspace_handle: result.workspaceHandle,
        workspaceHandle: result.workspaceHandle,
      },
      message: [],
      response: ResponseEnum.success,
    })) as Promise<WorkspaceResponse>
}

export function closeWorkspaceApi(workspaceHandle: string) {
  return getDesktopApi().ecc.workspace.close({ workspaceHandle })
}

/**
 * Create a new project
 * @param path - Parent directory where the project will be created
 * @param name - Name of the new project (optional, defaults to "New_Chip_Design")
 * @param options - Additional project configuration options from wizard
 */
export function createWorkspaceApi(options: {
  directory?: string
  pdk?: string
  parameters?: Record<string, unknown>
  origin_def?: string
  origin_verilog?: string
  rtl_list?: string[]
  pdk_root?: string
  filelist?: string
  design_input_mode?: string
  sdc?: string
  flow_config?: Record<string, unknown>
  pdk_config_mode?: string
  pdk_config?: Record<string, unknown>
  pdk_json?: unknown
  project_context?: Record<string, unknown>
}) {
  const data = toDesktopBridgeData({
    directory: options?.directory || '',
    pdk: options?.pdk || '',
    parameters: options.parameters || {},
    origin_def: options.origin_def || '',
    origin_verilog: options.origin_verilog || '',
    rtl_list: options.rtl_list || [],
    pdk_root: options.pdk_root || '',
    filelist: options.filelist || '',
    design_input_mode: options.design_input_mode || '',
    sdc: options.sdc || '',
    flow_config: options.flow_config || {},
    pdk_config_mode: options.pdk_config_mode || '',
    pdk_config: options.pdk_config || {},
    pdk_json: options.pdk_json || '',
    project_context: options.project_context || {},
  })
  return getDesktopApi()
    .ecc.workspace.create({
      directory: String(data.directory ?? ''),
      filelist: String(data.filelist ?? ''),
      flowConfig: (data.flow_config as Record<string, unknown>) ?? {},
      originDef: String(data.origin_def ?? ''),
      originVerilog: String(data.origin_verilog ?? ''),
      parameters: (data.parameters as Record<string, unknown>) ?? {},
      pdk: String(data.pdk ?? ''),
      pdkJson: data.pdk_json ?? null,
      pdkRoot: String(data.pdk_root ?? ''),
      rtlList: Array.isArray(data.rtl_list) ? (data.rtl_list as string[]) : [],
      sdc: String(data.sdc ?? ''),
    })
    .then((result) => ({
      cmd: CMDEnum.create_workspace,
      data: {
        directory: result.directory,
        workspace_handle: result.workspaceHandle,
        workspaceHandle: result.workspaceHandle,
      },
      message: [],
      response: ResponseEnum.success,
    })) as Promise<WorkspaceResponse>
}
