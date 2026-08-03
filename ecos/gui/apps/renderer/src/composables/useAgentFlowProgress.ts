import { getOptionalDesktopApi } from '@/platform/desktop'

interface FlowStep {
  name: string
  state: string
  tool: string
}

interface FlowState {
  steps?: unknown
}

const PRIMARY_ARTIFACT_PATTERN =
  /\.(?:def|v|verilog|gds|spef)(?:\.gz)?$/i

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

function outputDirectory(workspacePath: string, step: FlowStep): string {
  return `${workspacePath.replace(/\/+$/, '')}/${step.name}_${step.tool}/output`
}

export function useAgentFlowProgress(report: (message: string) => void) {
  let generation = 0
  let unwatch: (() => void) | null = null
  let states = new Map<string, string>()

  async function primaryArtifacts(workspacePath: string, step: FlowStep): Promise<string[]> {
    const api = getOptionalDesktopApi()
    if (!api) return []
    try {
      const entries = await api.workspace.listProjectDirectory(outputDirectory(workspacePath, step))
      return entries
        .filter((entry) => entry.type === 'file' && PRIMARY_ARTIFACT_PATTERN.test(entry.name))
        .map((entry) => entry.path)
    } catch {
      return []
    }
  }

  async function observe(workspacePath: string, activeGeneration: number): Promise<void> {
    const api = getOptionalDesktopApi()
    if (!api || activeGeneration !== generation) return

    const content = await api.workspace.readOptionalProjectTextFile(
      `${workspacePath}/home/flow.json`,
    )
    if (activeGeneration !== generation) return
    for (const step of flowSteps(content)) {
      if (activeGeneration !== generation) return
      const key = `${step.name}:${step.tool}`
      const previous = states.get(key)
      states.set(key, step.state)
      if (step.state === 'Ongoing' && previous !== 'Ongoing') {
        report(`Running ${step.name}.`)
        continue
      }
      if (step.state !== 'Success' || !previous || previous === 'Success') continue

      const artifacts = await primaryArtifacts(workspacePath, step)
      if (activeGeneration !== generation) return
      report(
        artifacts.length
          ? `Completed ${step.name}. Saved: ${artifacts.join('; ')}`
          : `Completed ${step.name}.`,
      )
    }
  }

  function stop(): void {
    generation += 1
    unwatch?.()
    unwatch = null
    states = new Map()
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
      unwatch = registeredUnwatch
    } catch {
      report('Live flow progress is unavailable. Execution will continue.')
    }
  }

  return { start, stop }
}
