/**
 * Project API module for ChipCompiler
 */

import { alovaInstance } from './client'
import { CMDEnum } from './type'

// Types for API requests and responses
export interface ProjectInfo {
  name: string
  path: string
  flow?: Record<string, unknown>
}

export interface WorkspaceResponse {
  cmd: CMDEnum;
  response: string;
  data: {
    directory: string;
    workspace_id?: string;  // 前端用于订阅 SSE
  };
  message: string[];
}

export interface LoadWorkspaceRequest {
  cmd: CMDEnum.load_workspace;
  data: {
    directory: string;
  }
}

export interface CreateWorkspaceRequest {
  cmd: CMDEnum.create_workspace;
  data: {
    pdk: string,
    pdk_root: string,
    directory: string,
    parameters: Record<string, unknown>,
    origin_def: string,
    origin_verilog: string,
    filelist: string,
    rtl_list: string[]
  }
}

/**
 * Open an existing project
 * @param path - Full path to the project directory
 */
export function loadWorkspaceApi(directory: string) {
  return alovaInstance.Post<WorkspaceResponse>('/api/workspace/load_workspace', {
    cmd: CMDEnum.load_workspace,
    data: {
      directory: directory
    }
  } as LoadWorkspaceRequest)
}

/**
 * Create a new project
 * @param path - Parent directory where the project will be created
 * @param name - Name of the new project (optional, defaults to "New_Chip_Design")
 * @param options - Additional project configuration options from wizard
 */
export function createWorkspaceApi(
  options: {
    directory?: string,
    pdk?: string,
    parameters?: Record<string, unknown>,
    origin_def?: string,
    origin_verilog?: string,
    rtl_list?: string[]
    pdk_root?: string
    filelist?: string
  }
) {
  return alovaInstance.Post<WorkspaceResponse>('/api/workspace/create_workspace', {
    cmd: CMDEnum.create_workspace,
    data: {
      directory: options?.directory || '',
      pdk: options?.pdk || '',
      parameters: options.parameters || {},
      origin_def: options.origin_def || '',
      origin_verilog: options.origin_verilog || '',
      rtl_list: options.rtl_list || [],
      pdk_root: options.pdk_root || ''  ,
      filelist: options.filelist || ''
    }
  } as CreateWorkspaceRequest)
}

/**
 * Check project API health
 */
export function checkProjectApiHealth() {
  return alovaInstance.Get<{ status: string }>('/api/project/health')
}
