import { getCurrentInstance, onBeforeUnmount, watch } from 'vue'
import type { WorkspaceResourceIndex, WorkspaceStepResource } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { useMessageStore } from '@/stores/messageStore'
import { readOptionalProjectTextFileTail, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  flowStepKey,
  flowStepRunArtifacts,
  isSuccessfulFlowStep,
} from './flowRunArtifacts'
import { registerRuntimeStepRenderTask } from './runtimeStepRenderSync'

const MAX_STEP_REPORTS = 8
const MAX_LAYOUT_PREVIEW_BYTES = 8 * 1024 * 1024

export interface FlowRunArtifactCaptureOptions {
  stepNames?: readonly string[]
}

export interface FlowRunArtifactSettleOptions {
  forceStepNames?: readonly string[]
}

export interface FlowRunArtifactCapture {
  settle(options?: FlowRunArtifactSettleOptions): Promise<void>
  stop(): void
}

function filename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Captures the bounded report/layout view for every successful GUI step. The
 * capture runs through Electron IPC and is awaited by the workspace render
 * gate, so the next ECC step cannot overlap this NFS work with a stale UI.
 */
export function useFlowRunArtifacts() {
  const messageStore = useMessageStore()
  const { runtimeEvents } = useWorkspace()
  const { registerBlobUrl } = useWorkspaceLifecycle()
  const activeCaptures = new Set<FlowRunArtifactCapture>()

  function startFlowRunArtifactCapture(
    options: FlowRunArtifactCaptureOptions = {},
  ): FlowRunArtifactCapture {
    const targetSteps = new Set(
      (options.stepNames ?? []).map(flowStepKey).filter((name) => name.length > 0),
    )
    const publishedSteps = new Set<string>()
    const completedSteps = new Set<string>()
    const forcedSteps = new Set<string>()
    let stopped = false
    let inspectionQueue = Promise.resolve()

    const matchesTarget = (stepName: string): boolean =>
      targetSteps.size === 0 || targetSteps.has(flowStepKey(stepName))

    async function publishStepArtifacts(step: WorkspaceStepResource): Promise<void> {
      const artifacts = flowStepRunArtifacts(step)

      for (const report of artifacts.reports.slice(0, MAX_STEP_REPORTS)) {
        try {
          const authorizedPath = await resolveProjectPathAccess(report.path)
          if (!authorizedPath) continue
          const tail = await readOptionalProjectTextFileTail(authorizedPath, 64 * 1024)
          if (tail === null) continue

          messageStore.addInfoMessage({
            title: filename(report.path),
            step: step.name,
            compact: true,
            items: [
              {
                label: filename(report.path),
                content: tail.content,
                format: 'text',
              },
            ],
          })
        } catch (error) {
          console.warn(`Failed to load report ${report.path}:`, error)
        }
      }

      if (
        !artifacts.layout ||
        (artifacts.layout.sizeBytes ?? 0) > MAX_LAYOUT_PREVIEW_BYTES
      ) {
        return
      }
      try {
        const authorizedPath = await resolveProjectPathAccess(artifacts.layout.path)
        if (!authorizedPath) return
        const imageUrl = await readProjectBlobUrl(authorizedPath, {
          mimeType: 'image/png',
        })
        registerBlobUrl(imageUrl, { label: `flow layout: ${step.name}` })
        messageStore.addMapMessage({
          title: 'Layout preview',
          step: step.name,
          imageUrl,
          localPath: artifacts.layout.path,
          info: [],
          category: 'Layout',
          compact: true,
          showLegend: false,
        })
      } catch (error) {
        console.warn(`Failed to load layout image ${artifacts.layout.path}:`, error)
      }
    }

    async function inspectCompletedSteps(
      stepNames?: Iterable<string>,
      resourceIndex?: WorkspaceResourceIndex,
    ): Promise<void> {
      if (stopped) return
      try {
        const index = resourceIndex ?? (await getWorkspaceResourceIndexApi())
        if (stopped) return
        for (const stepName of new Set(
          stepNames ?? [...completedSteps, ...forcedSteps],
        )) {
          if (!matchesTarget(stepName)) continue
          const key = flowStepKey(stepName)
          if (publishedSteps.has(key) && !forcedSteps.has(key)) continue
          const step = index.flow.steps.find(
            (candidate) => flowStepKey(candidate.name) === key,
          )
          if (!step || !isSuccessfulFlowStep(step) || stopped) continue
          await publishStepArtifacts(step)
          publishedSteps.add(key)
        }
      } catch (error) {
        console.warn('Failed to capture completed flow artifacts:', error)
      }
    }

    function enqueueInspection(
      stepNames?: Iterable<string>,
      resourceIndex?: WorkspaceResourceIndex,
    ): Promise<void> {
      inspectionQueue = inspectionQueue.then(() =>
        inspectCompletedSteps(stepNames, resourceIndex),
      )
      return inspectionQueue
    }

    function enqueueFinalInspection(): void {
      void enqueueInspection()
    }

    let stopWatchingRuntimeEvents: (() => void) | null = null
    const capture: FlowRunArtifactCapture = {
      async settle(settleOptions: FlowRunArtifactSettleOptions = {}): Promise<void> {
        for (const stepName of settleOptions.forceStepNames ?? []) {
          forcedSteps.add(flowStepKey(stepName))
        }
        await enqueueInspection()
        capture.stop()
      },
      stop(): void {
        if (stopped) return
        stopped = true
        stopWatchingRuntimeEvents?.()
        stopWatchingRuntimeEvents = null
        unregisterStepRenderTask()
        activeCaptures.delete(capture)
      },
    }

    const unregisterStepRenderTask = registerRuntimeStepRenderTask(async (commit) => {
      if (stopped || !commit.step || !matchesTarget(commit.step)) return
      completedSteps.add(flowStepKey(commit.step))
      await enqueueInspection([flowStepKey(commit.step)], await commit.resourceIndex())
    })

    stopWatchingRuntimeEvents = watch(
      () => runtimeEvents.value[runtimeEvents.value.length - 1],
      (event) => {
        if (stopped || !event) return
        const data = event.data
        const protocolType = data.runtimeProtocolType
        const step = typeof data.step === 'string' ? data.step : ''
        if (protocolType === 'step.completed' && step) {
          const state = typeof data.state === 'string' ? data.state.toLowerCase() : ''
          if (state === 'success') completedSteps.add(flowStepKey(step))
          return
        }
        if (
          ['operation.completed', 'operation.failed', 'operation.cancelled'].includes(
            String(protocolType),
          )
        ) {
          enqueueFinalInspection()
          void inspectionQueue.finally(() => capture.stop())
        }
      },
    )

    activeCaptures.add(capture)
    return capture
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      for (const capture of activeCaptures) capture.stop()
    })
  }

  return { startFlowRunArtifactCapture }
}
