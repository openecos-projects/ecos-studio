import type { InjectionKey } from 'vue'
import type {
  DesktopAgentWorkspaceSetupContract,
  ProjectManifest,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { mutateProjectManifest } from '@/api/projectManifest'
import { readProjectManagementManifest } from '@/utils/projectManagementRead'

export async function prepareAgentWorkspaceConfig(
  config: WorkspaceConfig,
): Promise<WorkspaceConfig> {
  let projectContext = config.project_context
  let manifest: ProjectManifest | null = null
  if (projectContext && !projectContext.project_id) {
    const rootExists =
      projectContext.mode === 'select' ||
      (await getDesktopApi().workspace.pathExists(projectContext.project_root))
    if (rootExists)
      manifest = await readProjectManagementManifest(projectContext.project_root)
    if (manifest) projectContext = adoptProjectIdentity(projectContext, manifest)
  }
  if (projectContext?.mode === 'create' && !projectContext.project_id) {
    const projectRoot = projectContext.project_root
    const projectName = projectContext.project_name.trim() || leafName(projectRoot)
    const designName = String(config.parameters.design ?? '').trim() || projectName
    const rtlImport = config.filelist
      ? { filelist: config.filelist }
      : config.rtl_list.length
        ? { verilog: [...config.rtl_list] }
        : undefined
    try {
      manifest = await mutateProjectManifest(projectRoot, {
        type: 'create',
        name: projectName,
        designName,
        ...(config.mpc ? { mpc: config.mpc } : {}),
        ...(rtlImport ? { rtlImport } : {}),
      })
    } catch (error) {
      throw new Error(
        `Unable to create project at ${projectRoot}: ${errorMessage(error)}. ` +
          'Choose an empty project directory or an existing project.',
      )
    }
    projectContext = adoptProjectIdentity(projectContext, manifest)
  } else if (projectContext?.mode === 'select' && !manifest) {
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

function adoptProjectIdentity(
  projectContext: NonNullable<WorkspaceConfig['project_context']>,
  manifest: ProjectManifest,
): NonNullable<WorkspaceConfig['project_context']> {
  const projectRoot = manifest.root_path || projectContext.project_root
  return {
    ...projectContext,
    mode: 'select',
    project_id: manifest.project_id,
    project_name: manifest.name || projectContext.project_name,
    project_root: projectRoot,
    project_json_path:
      projectRoot !== projectContext.project_root
        ? `${projectRoot.replace(/[\\/]+$/, '')}/project.json`
        : projectContext.project_json_path,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function leafName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || 'project'
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
