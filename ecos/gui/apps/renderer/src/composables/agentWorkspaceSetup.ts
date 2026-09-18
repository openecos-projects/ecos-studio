import type { InjectionKey } from 'vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { readProjectManagementManifest } from '@/utils/projectManagementRead'

export async function prepareAgentWorkspaceConfig(
  config: WorkspaceConfig,
): Promise<WorkspaceConfig> {
  let projectContext = config.project_context
  if (projectContext && !projectContext.project_id) {
    const manifest = await readProjectManagementManifest(projectContext.project_root)
    if (manifest) projectContext = { ...projectContext, project_id: manifest.project_id }
  }
  const installation = await getDesktopApi().pdkInventory.import({
    root: config.pdk_root,
    familyId: config.pdk,
    displayName: config.pdk,
  })
  return {
    ...config,
    project_context: projectContext,
    pdk_root: installation.root,
    pdk_installation_id: installation.id,
    pdk_requirement: {
      familyId: config.pdk,
      version: installation.version,
      manualConfig: null,
    },
  }
}

export interface AgentWorkspaceCreationResult {
  created: boolean
  error?: string
  workspacePath?: string
}

export const agentWorkspaceSetupKey: InjectionKey<
  (
    config: WorkspaceConfig,
    contract: DesktopAgentWorkspaceSetupContract,
    ownerSessionId: string,
  ) => Promise<AgentWorkspaceCreationResult>
> = Symbol('agentWorkspaceSetup')
