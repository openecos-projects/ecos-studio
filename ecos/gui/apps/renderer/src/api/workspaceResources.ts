import type {
  EccWorkspaceRuntimeSnapshot,
  WorkspaceResourceIndex,
  WorkspaceStepInfoRequest,
  WorkspaceStepInfoResult,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export function getWorkspaceResourceIndexApi(): Promise<WorkspaceResourceIndex> {
  return getDesktopApi().workspaceResources.getIndex()
}

export function readWorkspaceHomeResourceApi(): Promise<Record<string, unknown> | null> {
  return getDesktopApi().workspaceResources.readHome()
}

export function readWorkspaceFlowResourceApi(): Promise<Record<string, unknown> | null> {
  return getDesktopApi().workspaceResources.readFlow()
}

export function readWorkspaceParametersResourceApi(): Promise<Record<
  string,
  unknown
> | null> {
  return getDesktopApi().workspaceResources.readParameters()
}

export function writeWorkspaceParametersResourceApi(
  parameters: Record<string, unknown>,
  workspace?: string,
): Promise<{ format: 'toml' | 'json'; path: string }> {
  return getDesktopApi().workspaceResources.writeParameters({ parameters, workspace })
}

export function getWorkspaceRuntimeSnapshotApi(
  workspaceHandle: string,
): Promise<EccWorkspaceRuntimeSnapshot> {
  const runtime = getDesktopApi().ecc.runtime
  if (!runtime) throw new Error('ECC runtime snapshot API is unavailable.')
  return runtime.snapshot({ workspaceHandle })
}

export function resolveWorkspaceStepInfoApi(
  request: WorkspaceStepInfoRequest,
): Promise<WorkspaceStepInfoResult> {
  return getDesktopApi().workspaceResources.resolveStepInfo(request)
}
