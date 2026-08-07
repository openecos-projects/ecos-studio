import { getCurrentInstance, onBeforeUnmount } from 'vue'
import type { WorkspaceStepResource } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { useMessageStore } from '@/stores/messageStore'
import { readOptionalProjectTextFile, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  flowStepArtifactFingerprint,
  flowStepKey,
  flowStepRunArtifacts,
  isSuccessfulFlowStep,
} from './flowRunArtifacts'

const RUN_ARTIFACT_POLL_INTERVAL_MS = 600
const RUN_ARTIFACT_SETTLE_POLLS = 3

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

interface CapturedStepState {
  baselineFingerprint: string
  baselineSucceeded: boolean
  sawNonSuccess: boolean
  published: boolean
}

function waitForNextPoll(): Promise<void> {
  return new Promise((resolve) =>
    window.setTimeout(resolve, RUN_ARTIFACT_POLL_INTERVAL_MS),
  )
}

function filename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Watches the resource index while a user-initiated run is active. Existing
 * artifacts are baselined first, so opening an already completed workspace does
 * not fill the information panel with historical output.
 */
export function useFlowRunArtifacts() {
  const messageStore = useMessageStore()
  const { registerBlobUrl } = useWorkspaceLifecycle()
  const activeCaptures = new Set<FlowRunArtifactCapture>()

  async function startFlowRunArtifactCapture(
    options: FlowRunArtifactCaptureOptions = {},
  ): Promise<FlowRunArtifactCapture> {
    const targetSteps = new Set(
      (options.stepNames ?? []).map(flowStepKey).filter((name) => name.length > 0),
    )
    const capturedSteps = new Map<string, CapturedStepState>()
    let stopped = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let pendingPoll: Promise<void> | null = null

    const matchesTarget = (step: WorkspaceStepResource): boolean =>
      targetSteps.size === 0 || targetSteps.has(flowStepKey(step.name))

    async function publishStepArtifacts(step: WorkspaceStepResource): Promise<void> {
      const artifacts = flowStepRunArtifacts(step)

      for (const report of artifacts.reports) {
        try {
          const authorizedPath = await resolveProjectPathAccess(report.path)
          if (!authorizedPath) continue
          const content = await readOptionalProjectTextFile(authorizedPath)
          if (content === null) continue

          messageStore.addInfoMessage({
            title: filename(report.path),
            step: step.name,
            compact: true,
            items: [
              {
                label: filename(report.path),
                content,
                format: 'text',
              },
            ],
          })
        } catch (error) {
          console.warn(`Failed to load report ${report.path}:`, error)
        }
      }

      if (!artifacts.layout) return

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

    async function inspectIndex(
      mode: 'baseline' | 'watch',
      forcedStepNames: ReadonlySet<string> = new Set(),
    ): Promise<void> {
      if (stopped) return

      try {
        const index = await getWorkspaceResourceIndexApi()
        for (const step of index.flow.steps) {
          if (!matchesTarget(step)) continue

          const key = flowStepKey(step.name)
          const fingerprint = flowStepArtifactFingerprint(step)
          const isSucceeded = isSuccessfulFlowStep(step)
          const captured = capturedSteps.get(key)

          if (!captured) {
            capturedSteps.set(key, {
              baselineFingerprint: fingerprint,
              baselineSucceeded: isSucceeded,
              sawNonSuccess: !isSucceeded,
              published: false,
            })
            continue
          }

          if (mode === 'baseline') continue
          if (!isSucceeded) {
            captured.sawNonSuccess = true
            captured.published = false
            continue
          }

          const shouldPublish =
            forcedStepNames.has(key) ||
            !captured.baselineSucceeded ||
            captured.sawNonSuccess ||
            captured.baselineFingerprint !== fingerprint

          if (!shouldPublish || captured.published) continue

          await publishStepArtifacts(step)
          captured.published = true
        }
      } catch (error) {
        console.warn('Failed to inspect flow run artifacts:', error)
      }
    }

    function poll(
      mode: 'baseline' | 'watch' = 'watch',
      forcedStepNames: ReadonlySet<string> = new Set(),
    ): Promise<void> {
      if (pendingPoll) return pendingPoll
      pendingPoll = inspectIndex(mode, forcedStepNames).finally(() => {
        pendingPoll = null
      })
      return pendingPoll
    }

    const capture: FlowRunArtifactCapture = {
      async settle(settleOptions: FlowRunArtifactSettleOptions = {}): Promise<void> {
        const forcedStepNames = new Set(
          (settleOptions.forceStepNames ?? []).map(flowStepKey),
        )
        for (let attempt = 0; attempt < RUN_ARTIFACT_SETTLE_POLLS; attempt += 1) {
          await poll('watch', forcedStepNames)
          if (attempt < RUN_ARTIFACT_SETTLE_POLLS - 1) await waitForNextPoll()
        }
        capture.stop()
      },
      stop(): void {
        if (stopped) return
        stopped = true
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        activeCaptures.delete(capture)
      },
    }

    activeCaptures.add(capture)
    await poll('baseline')
    if (!stopped) {
      pollTimer = setInterval(() => {
        void poll('watch')
      }, RUN_ARTIFACT_POLL_INTERVAL_MS)
    }
    return capture
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      for (const capture of activeCaptures) capture.stop()
    })
  }

  return { startFlowRunArtifactCapture }
}
