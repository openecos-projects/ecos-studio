import type { InjectionKey } from 'vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'

export const agentWorkspaceSetupKey: InjectionKey<
  (
    config: WorkspaceConfig,
    contract: DesktopAgentWorkspaceSetupContract,
  ) => Promise<boolean>
> = Symbol('agentWorkspaceSetup')
