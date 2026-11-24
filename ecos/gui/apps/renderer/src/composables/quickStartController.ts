import {
  executeQuickStartWorkflow,
  QUICK_START_WORKFLOW_YAML,
  type QuickStartCapability,
  type QuickStartWorkflowEvent,
  type QuickStartValue,
} from './quickStartWorkflow'

export interface QuickStartResourceSnapshot {
  design: { id: string; path: string; version: string } | null
  diagnostics?: string[]
  mpc: { displayName?: string; id: string; path?: string; version: string } | null
  pdk: { id: string; path: string; version: string } | null
  toolIssues?: string[]
}

export interface QuickStartWorkflowHost {
  appVersion: string
  createProject(inputs: {
    design: QuickStartResourceSnapshot['design']
    mpc: QuickStartResourceSnapshot['mpc']
    pdk: QuickStartResourceSnapshot['pdk']
  }): Promise<QuickStartValue>
  createWorkspace(inputs: {
    project: QuickStartValue
    resources: QuickStartResourceSnapshot
  }): Promise<QuickStartValue>
  handoff(inputs: { project: QuickStartValue; workspace: QuickStartValue }): Promise<void>
  listResources(): Promise<QuickStartResourceSnapshot>
  navigate(surface: string): Promise<void>
  startFlow(inputs: {
    project: QuickStartValue
    workspace: QuickStartValue
  }): Promise<QuickStartValue>
}

export async function runQuickStartWorkflow(
  host: QuickStartWorkflowHost,
  onEvent?: (event: QuickStartWorkflowEvent) => void,
  signal?: AbortSignal,
): Promise<{ bindings: Record<string, QuickStartValue> }> {
  const capabilities: Record<string, QuickStartCapability> = {
    preflight_resources: {
      projection: {
        detailKey: 'quick_start.preflight.done',
        labelKey: 'quick_start.preflight',
        surface: 'home',
      },
      run: async () => {
        const resources = await host.listResources()
        const unavailable = [
          ...(!resources.design ? ['内置 GCD 示例'] : []),
          ...(!resources.pdk ? ['ICS55 PDK'] : []),
          ...(!resources.mpc ? ['MPC Frame 0.1.0'] : []),
          ...(resources.toolIssues ?? []),
        ]
        if (unavailable.length) {
          const details = resources.diagnostics?.join('\n')
          throw new Error([unavailable.join('\n'), details].filter(Boolean).join('\n\n'))
        }
        return resources as unknown as QuickStartValue
      },
    },
    open_project_management: {
      projection: {
        detailKey: 'quick_start.project_management.opened',
        labelKey: 'quick_start.project_management',
        surface: 'project-management',
      },
      run: () => host.navigate('project-management'),
    },
    create_project: {
      projection: {
        detailKey: 'quick_start.project.created',
        labelKey: 'quick_start.project.create',
        surface: 'project-management',
      },
      run: ({ bindings }) => {
        const resources = bindings.preflight as unknown as QuickStartResourceSnapshot
        return host.createProject(resources)
      },
    },
    create_workspace: {
      projection: {
        detailKey: 'quick_start.workspace.created',
        labelKey: 'quick_start.workspace.create',
        surface: 'workspace-setup',
      },
      run: ({ bindings }) => {
        const resources = bindings.preflight as unknown as QuickStartResourceSnapshot
        return host.createWorkspace({ project: bindings.project, resources })
      },
    },
    workspace_handoff: {
      projection: {
        detailKey: 'quick_start.workspace.handoff',
        labelKey: 'quick_start.workspace.handoff',
        surface: 'workspace',
      },
      run: async ({ bindings }) => {
        await host.handoff({ project: bindings.project, workspace: bindings.workspace })
      },
    },
    start_flow: {
      projection: {
        detailKey: 'quick_start.flow.started',
        labelKey: 'quick_start.flow.start',
        surface: 'workspace',
      },
      run: ({ bindings }) =>
        host.startFlow({ project: bindings.project, workspace: bindings.workspace }),
    },
  }

  const result = await executeQuickStartWorkflow(
    QUICK_START_WORKFLOW_YAML,
    capabilities,
    {
      appVersion: host.appVersion,
      onEvent,
      signal,
    },
  )
  return { bindings: result.bindings }
}
