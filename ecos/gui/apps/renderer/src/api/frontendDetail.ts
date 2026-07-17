import type { DesignTool } from '@ecos-studio/shared'
import { getInfoApi } from './flow'
import { CMDEnum, InfoEnum, ResponseEnum } from './type'
import { resolveWorkspaceStepInfoApi } from './workspaceResources'

interface FrontendDetailRequest {
  allowRpcFallback: boolean
  designTool: DesignTool
  directory: string
  step: string
  workspaceHandle: string
}

function isFrontendDetailSnapshot(info: Record<string, unknown>): boolean {
  return (
    info.summary !== null &&
    typeof info.summary === 'object' &&
    Array.isArray(info.logs) &&
    Array.isArray(info.reports) &&
    Array.isArray(info.artifacts)
  )
}

export async function loadFrontendStepDetailApi(
  request: FrontendDetailRequest,
): Promise<Record<string, unknown> | null> {
  const local = await resolveWorkspaceStepInfoApi({
    step: request.step,
    id: InfoEnum.frontend_detail,
  })
  if (local.response === 'available' && isFrontendDetailSnapshot(local.info)) {
    return local.info
  }
  if (!request.allowRpcFallback) return null

  const response = await getInfoApi({
    cmd: CMDEnum.get_info,
    data: {
      designTool: request.designTool,
      directory: request.directory,
      workspaceHandle: request.workspaceHandle,
      step: request.step,
      id: InfoEnum.frontend_detail,
    },
  })
  if (response.response !== ResponseEnum.success) {
    throw new Error(response.message?.join(', ') || 'Failed to load frontend detail')
  }
  return response.data.info as Record<string, unknown>
}
