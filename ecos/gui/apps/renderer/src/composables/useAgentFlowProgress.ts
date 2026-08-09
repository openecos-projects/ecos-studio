import { watch, type Ref } from 'vue'
import type { RuntimeEventResponse } from '@/api/runtimeEvents'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function sameWorkspace(event: RuntimeEventResponse, workspacePath: string): boolean {
  const directory = stringValue(event.data?.directory)
  return !directory || normalizedPath(directory) === normalizedPath(workspacePath)
}

/**
 * Feeds Agent progress from the same ordered ECC protocol stream used by the
 * workspace UI. Reading flow.json/subflow.json while a run is active would
 * create extra NFS pressure and can race the GUI step-render acknowledgement.
 */
export function useAgentFlowProgress(
  report: (message: string) => void,
  onFlowChanged: () => void = () => undefined,
  runtimeEvents: Readonly<Ref<RuntimeEventResponse[]>>,
) {
  let activeWorkspacePath = ''
  let active = false
  const handledEventIds = new Set<string>()

  function stop(): void {
    active = false
    activeWorkspacePath = ''
    handledEventIds.clear()
  }

  function start(workspacePath: string): void {
    stop()
    if (!workspacePath.trim()) return
    activeWorkspacePath = normalizedPath(workspacePath)
    active = true
  }

  watch(
    () => runtimeEvents.value[runtimeEvents.value.length - 1],
    (event) => {
      if (!active || !event || !sameWorkspace(event, activeWorkspacePath)) return

      const data = event.data
      const eventId = stringValue(data.runtimeEventId)
      if (eventId) {
        if (handledEventIds.has(eventId)) return
        handledEventIds.add(eventId)
        if (handledEventIds.size > 512) {
          handledEventIds.delete(handledEventIds.values().next().value!)
        }
      }

      const step = stringValue(data.step)
      switch (data.runtimeProtocolType) {
        case 'step.started':
          if (step) report(`Running ${step}.`)
          break
        case 'step.completed': {
          if (!step) break
          const state = stringValue(data.state)?.toLowerCase()
          report(state === 'success' ? `Completed ${step}.` : `Failed ${step}.`)
          onFlowChanged()
          break
        }
        case 'operation.failed':
          if (event.message[0]) report(`Flow failed: ${event.message[0]}`)
          break
        case 'operation.cancelled':
          report('Flow cancelled.')
          break
      }
    },
  )

  return { start, stop }
}
