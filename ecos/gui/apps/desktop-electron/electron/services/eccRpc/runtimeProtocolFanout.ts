import type { EccRuntimeEvent, EccRuntimeProtocolPayload } from '@ecos-studio/shared'

import type { EccRpcRuntimeSidecar } from './runtimeClient'
import { StepLogEventBridge } from './stepLogEventBridge'
import type { WorkspaceSessionRegistry } from './workspaceSessions'

/**
 * The runtime.protocol fanout path: how ecc notifications and synthesized
 * events (step.log) are shaped for listeners, and how the step log bridge
 * is attached to a workspace-bound sidecar. Kept out of the runtime
 * coordinator so that module stays focused on RPC/session orchestration.
 */

export function wrapProtocolEvent(
  sessions: WorkspaceSessionRegistry,
  boundDirectory: string | null,
  protocolEvent: EccRuntimeProtocolPayload,
): EccRuntimeEvent {
  const session = sessions.findByEccWorkspaceId(protocolEvent.workspaceId)
  return {
    event: protocolEvent,
    type: 'runtime.protocol',
    ...(session
      ? {
          workspaceDirectory: session.directory,
          workspaceHandle: session.workspaceHandle,
        }
      : {}),
    ...(boundDirectory && !session ? { workspaceDirectory: boundDirectory } : {}),
  }
}

export function attachStepLogBridge(options: {
  directory: string | null
  sidecar: EccRpcRuntimeSidecar
  emitProtocolEvent: (event: EccRuntimeProtocolPayload) => void
  emitRuntimeEvent: (event: EccRuntimeEvent) => void
}): StepLogEventBridge | null {
  const { directory, sidecar } = options
  if (!directory || typeof sidecar.attachStepLogArchiver !== 'function') {
    return null
  }
  const bridge = new StepLogEventBridge({
    workspaceDirectory: directory,
    emitProtocolEvent: options.emitProtocolEvent,
    emitUnscoped: (text) => {
      if (typeof sidecar.appendStderrText === 'function') {
        sidecar.appendStderrText(text)
        return
      }
      options.emitRuntimeEvent({ text, type: 'runtime.stderr' })
    },
  })
  sidecar.attachStepLogArchiver(bridge.archiver)
  return bridge
}
