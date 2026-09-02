import { watch, type Ref } from 'vue'
import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import {
  backendRuntimeEventKind,
  backendRuntimeEventMessage,
  backendRuntimeEventState,
  backendRuntimeEventStep,
} from '@/api/backendRuntimeEvents'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function sameWorkspace(event: DesignRuntimeEvent, workspacePath: string): boolean {
  const directory = stringValue(event.workspaceDirectory)
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
  runtimeEvents: Readonly<Ref<DesignRuntimeEvent[]>>,
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

      const protocol = event.type === 'runtime.protocol' ? event.event : null
      const eventId = protocol?.eventId
      const eventKey = eventId
        ? [
            protocol?.workspaceId,
            protocol?.runtimeInstanceId,
            protocol?.operationId,
            eventId,
          ].join('\u001f')
        : ''
      if (eventKey) {
        if (handledEventIds.has(eventKey)) return
        handledEventIds.add(eventKey)
        if (handledEventIds.size > 512) {
          handledEventIds.delete(handledEventIds.values().next().value!)
        }
      }

      const step = backendRuntimeEventStep(event)
      switch (backendRuntimeEventKind(event)) {
        case 'step.started':
          if (step) report(`Running ${step}.`)
          break
        case 'step.completed': {
          if (!step) break
          const state = backendRuntimeEventState(event)?.toLowerCase()
          report(state === 'success' ? `Completed ${step}.` : `Failed ${step}.`)
          onFlowChanged()
          break
        }
        case 'operation.failed':
          if (backendRuntimeEventMessage(event)) {
            report(`Flow failed: ${backendRuntimeEventMessage(event)}`)
          }
          break
        case 'operation.cancelled':
          report('Flow cancelled.')
          break
      }
    },
  )

  return { start, stop }
}
