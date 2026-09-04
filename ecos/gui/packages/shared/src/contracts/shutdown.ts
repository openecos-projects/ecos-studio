import type { DesktopEventUnsubscribe } from './desktopEvents.ts'

export type DesktopShutdownState =
  | 'idle'
  | 'draining'
  | 'force-eligible'
  | 'cleaning-renderers'
  | 'forcing'
  | 'error'
  | 'approved'

export interface DesktopShutdownStatus {
  activeFlows: number
  attemptId: string | null
  finalizations: number
  forceEligible: boolean
  issue?: string
  pendingCommands?: number
  pendingCreations: number
  scope: 'window' | 'application' | null
  snapshotFailures: number
  state: DesktopShutdownState
}

export interface DesktopShutdownCleanupRequest {
  attemptId: string
}

export interface DesktopShutdownApi {
  cancel(): Promise<void>
  completeCleanup(request: {
    attemptId: string
    ok: boolean
    issue?: string
  }): Promise<void>
  getStatus(): Promise<DesktopShutdownStatus>
  reviewOptions(): Promise<void>
  onCleanupRequested(
    listener: (request: DesktopShutdownCleanupRequest) => void,
  ): DesktopEventUnsubscribe
  onStatusChanged(
    listener: (status: DesktopShutdownStatus) => void,
  ): DesktopEventUnsubscribe
}
