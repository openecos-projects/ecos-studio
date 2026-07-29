import type { InjectionKey } from 'vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'

export interface AgentWorkspaceCreationResult {
  created: boolean
  error?: string
}

export const agentWorkspaceSetupKey: InjectionKey<
  (
    config: WorkspaceConfig,
    contract: DesktopAgentWorkspaceSetupContract,
  ) => Promise<AgentWorkspaceCreationResult>
> = Symbol('agentWorkspaceSetup')
