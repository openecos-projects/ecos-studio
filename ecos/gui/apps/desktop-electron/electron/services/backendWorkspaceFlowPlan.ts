import type { FlowStepSummary } from '@ecos-studio/shared'

type FlowPlanStep = Pick<FlowStepSummary, 'stage' | 'inputProducers' | 'designSource'>

export function matchWorkspaceFlowPlan(
  value: unknown,
  steps: readonly FlowStepSummary[],
  workspaceId?: string,
): FlowPlanStep[] | undefined {
  if (!Array.isArray(value)) return
  const workspacePlan = value[0]?.record === 'workspace_flow'
  if (
    workspacePlan
      ? value[0].workspace_id !== workspaceId
      : value[0]?.record !== 'flow_status'
  )
    return
  const enabled = value.filter(
    (row) => row?.record === 'flow_step' && (workspacePlan || row.enabled === true),
  )
  if (enabled.length !== steps.length) return

  const previous = new Set<string>()
  const result: FlowPlanStep[] = []
  let stage = 0
  for (const [index, step] of steps.entries()) {
    const row = enabled[index]
    if (
      row.step !== step.stepId ||
      row.tool !== step.toolId ||
      previous.has(step.stepId) ||
      (!workspacePlan && step.inputStep) ||
      !Number.isSafeInteger(row.stage) ||
      row.stage < Math.max(1, stage) ||
      row.stage > stage + 1 ||
      !row.needs ||
      typeof row.needs !== 'object' ||
      Array.isArray(row.needs)
    )
      return

    const inputProducers: Record<string, string | null> = {}
    for (const [input, producer] of Object.entries(row.needs)) {
      if (!/^[a-z][a-z0-9_]*$/.test(input) || input === 'constructor') return
      if (
        producer !== null &&
        (typeof producer !== 'string' || !previous.has(producer))
      ) {
        return
      }
      inputProducers[input] = producer
    }
    const designSource: unknown = row.design_source
    if (
      workspacePlan &&
      designSource !== null &&
      (typeof designSource !== 'string' || !previous.has(designSource))
    )
      return
    if (workspacePlan && step.inputStep && designSource !== step.inputStep) return
    stage = row.stage
    previous.add(step.stepId)
    result.push({
      stage,
      inputProducers,
      ...(typeof designSource === 'string' || designSource === null
        ? { designSource }
        : {}),
    })
  }
  return result
}
