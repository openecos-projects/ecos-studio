import { getOptionalDesktopApi } from '@/platform/desktop'

interface FlowStep {
  name: string
  state: string
  tool: string
}

interface FlowState {
  steps?: unknown
}

interface SubflowRawStep {
  name: string
  state: string
  runtime?: string
  'peak memory (mb)'?: number
}

interface SubflowData {
  steps?: unknown
}

function flowSteps(content: string | null): FlowStep[] {
  if (!content) return []
  try {
    const flow = JSON.parse(content) as FlowState
    if (!Array.isArray(flow.steps)) return []
    return flow.steps.flatMap((step) => {
      if (
        typeof step !== 'object' ||
        step === null ||
        typeof (step as Record<string, unknown>).name !== 'string' ||
        typeof (step as Record<string, unknown>).state !== 'string' ||
        typeof (step as Record<string, unknown>).tool !== 'string'
      ) {
        return []
      }
      return [step as FlowStep]
    })
  } catch {
    return []
  }
}

function subflowSteps(content: string | null): SubflowRawStep[] {
  if (!content) return []
  try {
    const data = JSON.parse(content) as SubflowData
    if (!Array.isArray(data.steps)) return []
    return data.steps.flatMap((step) => {
      if (
        typeof step !== 'object' ||
        step === null ||
        typeof (step as Record<string, unknown>).name !== 'string' ||
        typeof (step as Record<string, unknown>).state !== 'string'
      ) {
        return []
      }
      return [step as SubflowRawStep]
    })
  } catch {
    return []
  }
}

function stepDirectory(workspacePath: string, step: FlowStep): string {
  return `${workspacePath.replace(/\/+$/, '')}/${step.name}_${step.tool}`
}

function subflowFilePath(workspacePath: string, step: FlowStep): string {
  return `${stepDirectory(workspacePath, step)}/subflow.json`
}

function flowKey(step: FlowStep): string {
  return `${step.name}:${step.tool}`
}

function isSuccess(state: string): boolean {
  return state.toLowerCase() === 'success'
}

function isOngoing(state: string): boolean {
  const normalized = state.toLowerCase()
  return normalized === 'ongoing' || normalized === 'running'
}

function isFailed(state: string): boolean {
  const normalized = state.toLowerCase()
  return (
    normalized === 'failed' ||
    normalized === 'incomplete' ||
    normalized === 'invalid'
  )
}

function subflowDetail(substep: SubflowRawStep, failed = false): string {
  return failed ? `${substep.name} failed` : substep.name
}

export function useAgentFlowProgress(
  report: (message: string) => void,
  onFlowChanged?: () => void,
) {
  let generation = 0
  let unwatchFlow: (() => void) | null = null
  const unwatchSubflows = new Map<string, () => void>()
  let states = new Map<string, string>()
  let subflowStates = new Map<string, string>()
  let seededSubflows = new Set<string>()

  function clearSubflowWatch(key: string): void {
    unwatchSubflows.get(key)?.()
    unwatchSubflows.delete(key)
  }

  async function observeSubflow(
    workspacePath: string,
    step: FlowStep,
    activeGeneration: number,
    options: { finalize?: boolean } = {},
  ): Promise<void> {
    const api = getOptionalDesktopApi()
    if (!api || activeGeneration !== generation) return

    const key = flowKey(step)
    const content = await api.workspace.readOptionalProjectTextFile(
      subflowFilePath(workspacePath, step),
    )
    if (activeGeneration !== generation) return

    const seeded = seededSubflows.has(key)
    for (const substep of subflowSteps(content)) {
      if (activeGeneration !== generation) return
      const subKey = `${key}::${substep.name}`
      const previous = subflowStates.get(subKey)
      subflowStates.set(subKey, substep.state)
      if (!seeded && !options.finalize) {
        // Initial seed: only surface the active substep; history waits for finalize.
        if (isOngoing(substep.state)) {
          report(`${step.name} › ${subflowDetail(substep)}`)
        }
        continue
      }

      if (previous === substep.state) continue

      if (isFailed(substep.state)) {
        report(`${step.name} › ${subflowDetail(substep, true)}`)
        continue
      }
      if (isOngoing(substep.state)) {
        report(`${step.name} › ${subflowDetail(substep)}`)
        continue
      }
      if (isSuccess(substep.state)) {
        // Ongoing already surfaced the step (with memory when available).
        if (previous && isOngoing(previous)) continue
        report(`${step.name} › ${subflowDetail(substep)}`)
      }
    }
    seededSubflows.add(key)
  }

  async function ensureSubflowWatch(
    workspacePath: string,
    step: FlowStep,
    activeGeneration: number,
  ): Promise<void> {
    const api = getOptionalDesktopApi()
    const key = flowKey(step)
    if (!api || activeGeneration !== generation || unwatchSubflows.has(key)) {
      await observeSubflow(workspacePath, step, activeGeneration)
      return
    }

    await observeSubflow(workspacePath, step, activeGeneration)
    if (activeGeneration !== generation) return

    try {
      const registered = await api.workspace.watchProjectFile(
        subflowFilePath(workspacePath, step),
        () => void observeSubflow(workspacePath, step, activeGeneration),
      )
      if (activeGeneration !== generation) {
        registered()
        return
      }
      unwatchSubflows.set(key, registered)
    } catch {
      // Subflow may not exist yet; flow.json polling/watch will retry via ensure.
    }
  }

  async function observe(workspacePath: string, activeGeneration: number): Promise<void> {
    const api = getOptionalDesktopApi()
    if (!api || activeGeneration !== generation) return

    const content = await api.workspace.readOptionalProjectTextFile(
      `${workspacePath}/home/flow.json`,
    )
    if (activeGeneration !== generation) return

    let flowChanged = false
    for (const step of flowSteps(content)) {
      if (activeGeneration !== generation) return
      const key = flowKey(step)
      const previous = states.get(key)
      states.set(key, step.state)
      if (previous !== undefined && previous !== step.state) {
        flowChanged = true
      }

      if (isOngoing(step.state)) {
        if (previous !== step.state && !isOngoing(previous ?? '')) {
          report(`Running ${step.name}.`)
        }
        await ensureSubflowWatch(workspacePath, step, activeGeneration)
        continue
      }

      if (isSuccess(step.state) && previous && !isSuccess(previous)) {
        await observeSubflow(workspacePath, step, activeGeneration, { finalize: true })
        if (activeGeneration !== generation) return
        report(`Completed ${step.name}.`)
        clearSubflowWatch(key)
        continue
      }

      if (isFailed(step.state) && previous && !isFailed(previous)) {
        await observeSubflow(workspacePath, step, activeGeneration, { finalize: true })
        if (activeGeneration !== generation) return
        report(`Failed ${step.name}.`)
        clearSubflowWatch(key)
      }
    }

    if (flowChanged && activeGeneration === generation) {
      onFlowChanged?.()
    }
  }

  function stop(): void {
    generation += 1
    unwatchFlow?.()
    unwatchFlow = null
    for (const unwatch of unwatchSubflows.values()) unwatch()
    unwatchSubflows.clear()
    states = new Map()
    subflowStates = new Map()
    seededSubflows = new Set()
  }

  async function start(workspacePath: string): Promise<void> {
    stop()
    const api = getOptionalDesktopApi()
    if (!api || !workspacePath) return

    const activeGeneration = generation
    try {
      await observe(workspacePath, activeGeneration)
      const registeredUnwatch = await api.workspace.watchProjectFile(
        `${workspacePath}/home/flow.json`,
        () => void observe(workspacePath, activeGeneration),
      )
      if (activeGeneration !== generation) {
        registeredUnwatch()
        return
      }
      unwatchFlow = registeredUnwatch
    } catch {
      report('Live flow progress is unavailable. Execution will continue.')
    }
  }

  return { start, stop }
}
