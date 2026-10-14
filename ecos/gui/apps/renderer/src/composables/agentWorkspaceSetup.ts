import type { InjectionKey } from 'vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { readProjectManagementManifest } from '@/utils/projectManagementRead'

export async function prepareAgentWorkspaceConfig(
  config: WorkspaceConfig,
): Promise<WorkspaceConfig> {
  let projectContext = config.project_context
  let manifest = null
  if (projectContext && !projectContext.project_id) {
    // Identity discovery failures keep failing fast (existing contract).
    manifest = await readProjectManagementManifest(projectContext.project_root)
    if (manifest) projectContext = { ...projectContext, project_id: manifest.project_id }
  } else if (projectContext?.mode === 'select') {
    // Existing project: reuse its declared design RTL when present.
    manifest = await readProjectManagementManifest(projectContext.project_root).catch(
      () => null,
    )
  }
  // RTL/filelist inputs now mean "import into the project rtl/ directory".
  // A project that already declares design RTL is reused instead, so the
  // agent selection is cleared to avoid re-importing the same sources.
  const projectDeclaresRtl =
    Boolean(manifest?.base_design?.rtl_list?.length) ||
    Boolean(manifest?.base_design?.filelist)
  const effectiveConfig = projectDeclaresRtl
    ? { ...config, rtl_list: [], filelist: '' }
    : config
  const installation = await getDesktopApi().pdkInventory.import({
    root: config.pdk_root,
    familyId: config.pdk,
    displayName: config.pdk,
  })
  return {
    ...effectiveConfig,
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
