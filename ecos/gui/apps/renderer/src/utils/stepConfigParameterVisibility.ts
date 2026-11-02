const WORKSPACE_FLOW_SETUP_PARAMETER_IDS = new Set(['geometry.clock_tree'])

/** Workspace-level controls with a dedicated New Workspace Flow Setup editor. */
export function isWorkspaceFlowSetupParameter(parameterId: unknown): boolean {
  return (
    typeof parameterId === 'string' && WORKSPACE_FLOW_SETUP_PARAMETER_IDS.has(parameterId)
  )
}
