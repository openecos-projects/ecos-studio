import type { InjectionKey } from 'vue'
import type { WorkspaceConfig } from '@/types'

export const agentWorkspaceSetupKey: InjectionKey<
  (config: WorkspaceConfig) => Promise<boolean>
> = Symbol('agentWorkspaceSetup')
