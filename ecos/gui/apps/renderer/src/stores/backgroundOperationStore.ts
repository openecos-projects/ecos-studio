import type {
  EccBackgroundFinalization,
  EccBackgroundOperation,
  EccBackgroundWorkspaceCreation,
  EccBackgroundOperationOutcome,
  DesktopShutdownStatus,
} from '@ecos-studio/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { useNotificationStore } from '@/stores/notificationStore'
import { updateAuthoritativeBackendFlowState } from '@/composables/flowExecutionState'

export function isShutdownInProgress(state: DesktopShutdownStatus['state']): boolean {
  return [
    'draining',
    'force-eligible',
    'cleaning-renderers',
    'forcing',
    'error',
  ].includes(state)
}

export const useBackgroundOperationStore = defineStore('backgroundOperations', () => {
  const operations = ref<EccBackgroundOperation[]>([])
  const finalizations = ref<EccBackgroundFinalization[]>([])
  const creations = ref<EccBackgroundWorkspaceCreation[]>([])
  const generation = ref(-1)
  const issue = ref<string | null>(null)
  const loading = ref(false)
  const shutdownStatus = ref<DesktopShutdownStatus>(idleShutdownStatus())
  let requestSequence = 0
  let unsubscribe: (() => void) | null = null
  let unsubscribeShutdown: (() => void) | null = null
  const seenOutcomes = new Set<string>()
  const seenCreationRecoveries = new Set<string>()
  const notifications = useNotificationStore()

  const activeCount = computed(() => operations.value.length)

  async function refresh(): Promise<void> {
    const runtime = getDesktopApi().ecc?.runtime
    if (!runtime) return
    const sequence = ++requestSequence
    loading.value = true
    try {
      const projection = await runtime.operationProjection()
      if (sequence !== requestSequence || projection.generation < generation.value) return
      generation.value = projection.generation
      operations.value = projection.operations
      finalizations.value = projection.finalizations
      creations.value = projection.creations
      publishCreationRecoveries(projection.creations)
      publishOutcomes(projection.outcomes)
      updateAuthoritativeBackendFlowState(
        [
          ...projection.operations.map((operation) => operation.workspaceDirectory),
          ...projection.outcomes.map((operation) => operation.workspaceDirectory),
          ...projection.finalizations.map(
            (finalization) => finalization.workspaceDirectory,
          ),
        ],
        projection.operations.map((operation) => operation.workspaceDirectory),
      )
      issue.value = null
    } catch (error) {
      if (sequence !== requestSequence) return
      issue.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (sequence === requestSequence) loading.value = false
    }
  }

  function start(): Promise<void> {
    const desktopApi = getDesktopApi()
    const runtime = desktopApi.ecc?.runtime
    if (runtime) {
      unsubscribe ??= runtime.onOperationProjectionInvalidated((event) => {
        if (event.generation > generation.value) void refresh()
      })
    }
    if (desktopApi.shutdown) {
      unsubscribeShutdown ??= desktopApi.shutdown.onStatusChanged((status) => {
        shutdownStatus.value = status
      })
    }
    return Promise.all([
      runtime ? refresh() : Promise.resolve(),
      desktopApi.shutdown
        ? desktopApi.shutdown.getStatus().then((status) => {
            shutdownStatus.value = status
          })
        : Promise.resolve(),
    ]).then(() => undefined)
  }

  function dispose(): void {
    requestSequence += 1
    unsubscribe?.()
    unsubscribe = null
    unsubscribeShutdown?.()
    unsubscribeShutdown = null
    generation.value = -1
    operations.value = []
    finalizations.value = []
    creations.value = []
    issue.value = null
    loading.value = false
    shutdownStatus.value = idleShutdownStatus()
  }

  function operationForWorkspace(workspaceId: string, workspaceRevision?: number) {
    return operations.value.find(
      (operation) =>
        operation.workspaceId === workspaceId &&
        (workspaceRevision === undefined ||
          operation.workspaceRevision === workspaceRevision),
    )
  }

  function markCancellationRequested(workspaceHandle: string, operationId: string): void {
    operations.value = operations.value.map((operation) =>
      operation.workspaceHandle === workspaceHandle &&
      operation.operationId === operationId
        ? { ...operation, cancelRequested: true }
        : operation,
    )
  }

  async function cancelOperation(
    operation: Pick<EccBackgroundOperation, 'operationId' | 'workspaceHandle'>,
  ): Promise<void> {
    const result = await getDesktopApi().productCommands.execute({
      command: 'workspace.cancel',
      payload: {
        operationId: operation.operationId,
        workspaceHandle: operation.workspaceHandle,
      },
    })
    if (!('accepted' in result) || !result.accepted) {
      throw new Error('The Runtime did not accept the cancellation request.')
    }
    markCancellationRequested(operation.workspaceHandle, operation.operationId)
  }

  async function retryFinalSnapshot(workspaceHandle: string): Promise<void> {
    const result = await getDesktopApi().productCommands.execute({
      command: 'workspace.retrySnapshot',
      payload: { workspaceHandle },
    })
    if (!('recovered' in result) || !result.recovered) {
      throw new Error('The final Workspace snapshot is still unavailable.')
    }
    await refresh()
  }

  async function continueCreation(creationId: string): Promise<void> {
    const result = await getDesktopApi().productCommands.execute({
      command: 'workspace.continueCreation',
      payload: { creationId },
    })
    if (!('recovered' in result) || !result.recovered) {
      throw new Error(
        'issue' in result && result.issue
          ? result.issue
          : 'Workspace initialization could not continue.',
      )
    }
    await refresh()
  }

  async function abandonCreation(creationId: string): Promise<void> {
    const result = await getDesktopApi().productCommands.execute({
      command: 'workspace.abandonCreation',
      payload: { creationId },
    })
    if (!('abandoned' in result) || !result.abandoned) {
      throw new Error('Workspace recovery record could not be abandoned.')
    }
    await refresh()
  }

  async function cancelShutdown(): Promise<void> {
    await getDesktopApi().shutdown?.cancel()
  }

  async function reviewShutdownOptions(): Promise<void> {
    await getDesktopApi().shutdown?.reviewOptions()
  }

  function publishOutcomes(outcomes: EccBackgroundOperationOutcome[]): void {
    for (const outcome of outcomes) {
      const key = `${outcome.runtimeInstanceId ?? ''}\0${outcome.workspaceId}\0${outcome.operationId}\0${outcome.state}`
      if (seenOutcomes.has(key)) continue
      seenOutcomes.add(key)
      while (seenOutcomes.size > 256) {
        seenOutcomes.delete(seenOutcomes.values().next().value!)
      }
      const workspace =
        outcome.workspaceDirectory
          .replace(/[\\/]+$/g, '')
          .split(/[\\/]/)
          .pop() || outcome.workspaceDirectory
      notifications.addNotification({
        key: `runtime-outcome:${key}`,
        message:
          outcome.error?.message ??
          `${workspace}: ${outcome.currentStep || outcome.step || 'Flow'} ${outcome.state}.`,
        severity:
          outcome.state === 'succeeded'
            ? 'info'
            : outcome.state === 'cancelled'
              ? 'warn'
              : 'error',
        title:
          outcome.state === 'succeeded'
            ? 'Flow completed'
            : outcome.state === 'cancelled'
              ? 'Flow cancelled'
              : outcome.state === 'interrupted'
                ? 'Flow interrupted'
                : 'Flow failed',
      })
    }
  }

  function publishCreationRecoveries(entries: EccBackgroundWorkspaceCreation[]): void {
    for (const entry of entries) {
      if (entry.status !== 'recovered' || seenCreationRecoveries.has(entry.creationId)) {
        continue
      }
      seenCreationRecoveries.add(entry.creationId)
      notifications.addNotification({
        key: `workspace-creation-recovered:${entry.creationId}`,
        message:
          entry.issue ??
          `${entry.targetDirectory ?? 'Workspace'} registration is complete.`,
        severity: 'info',
        title: 'Workspace creation recovered',
      })
    }
  }

  return {
    activeCount,
    abandonCreation,
    cancelOperation,
    cancelShutdown,
    creations,
    dispose,
    finalizations,
    generation,
    issue,
    continueCreation,
    loading,
    markCancellationRequested,
    operationForWorkspace,
    operations,
    refresh,
    retryFinalSnapshot,
    reviewShutdownOptions,
    shutdownStatus,
    start,
  }
})

function idleShutdownStatus(): DesktopShutdownStatus {
  return {
    activeFlows: 0,
    attemptId: null,
    finalizations: 0,
    forceEligible: false,
    pendingCreations: 0,
    scope: null,
    snapshotFailures: 0,
    state: 'idle',
  }
}
