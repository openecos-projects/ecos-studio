import type { InjectionKey } from 'vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'

export const agentWorkspaceSetupKey: InjectionKey<
  (setup: DesktopAgentWorkspaceSetupContract) => void
> = Symbol('agentWorkspaceSetup')
