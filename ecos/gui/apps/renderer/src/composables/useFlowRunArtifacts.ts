import { watch } from 'vue'
import type {
  DesignRuntimeEvent,
  WorkspaceResourceIndex,
  WorkspaceStepResource,
} from '@ecos-studio/shared'
import {
  backendRuntimeEventKind,
  backendRuntimeEventState,
  backendRuntimeEventStep,
  backendRuntimeEventTerminalState,
} from '@/api/backendRuntimeEvents'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { useMessageStore } from '@/stores/messageStore'
import { getDesktopApi } from '@/platform/desktop'
import { readOptionalProjectTextFile, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  addCapturedFlowStep,
  capturedFlowStepSetHas,
  deleteCapturedFlowStep,
  flowStepRunArtifacts,
  isSuccessfulFlowStep,
  sameCapturedFlowStep,
} from './flowRunArtifacts'
import {
  normalizeWorkspaceProjectPath,
  onWorkspaceRerunPrepared,
} from './homeRunArtifacts'
import { registerRuntimeStepRenderTask } from './runtimeStepRenderSync'

const MAX_STEP_REPORTS = 10

export interface FlowRunArtifactCaptureOptions {
  inspectExisting?: boolean
  ownerSessionId?: string
  stepNames?: readonly string[]
  stopOnTerminal?: boolean
}

export interface FlowRunArtifactSettleOptions {
  forceStepNames?: readonly string[]
}

export interface FlowRunArtifactCapture {
  inspect(stepNames?: Iterable<string>): Promise<void>
  settle(options?: FlowRunArtifactSettleOptions): Promise<void>
  stop(): void
}

function filename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

async function readBackendLayoutBlobUrl(stepName: string): Promise<string | null> {
  const api = getDesktopApi().backendWorkspace
  const overview = await api.getOverview()
  const revision = overview.overview.revision
  const artifacts = overview.overview.artifacts
  if (
    !revision ||
    (revision.status !== 'ready' && revision.status !== 'partial') ||
    !artifacts ||
    (artifacts.status !== 'ready' && artifacts.status !== 'partial')
  ) {
    return null
  }
  const layout = artifacts.data.items.find(
    (artifact) =>
      artifact.kind === 'layout_image' &&
      artifact.availability === 'available' &&
      artifact.stepId &&
      sameCapturedFlowStep(artifact.stepId, stepName),
  )
  if (!layout) return null
  const workspaceRevision = layout.sourceRevision ?? revision.data.workspaceRevision
  const result = await api.getArtifact({
    artifactId: layout.artifactId,
    workspaceContextId: overview.workspaceContextId,
    workspaceRevision,
  })
  if (
    result.workspaceContextId !== overview.workspaceContextId ||
    result.workspaceRevision !== workspaceRevision ||
    result.artifact.status !== 'ready'
  ) {
    return null
  }
  const content = result.artifact.data
  return URL.createObjectURL(
    new Blob([content.bytes.slice()], { type: content.mimeType }),
  )
}

/**
 * Captures every report and layout artifact for successful GUI steps. The
 * capture runs through Electron IPC and is awaited by the workspace render
 * gate, so the next ECC step cannot overlap this NFS work with a stale UI.
 */
export function useFlowRunArtifacts() {
  const messageStore = useMessageStore()
  const { backendRuntimeEvents, currentProject } = useWorkspace()
  const { registerBlobUrl, registerCleanup } = useWorkspaceLifecycle()

  function startFlowRunArtifactCapture(
    options: FlowRunArtifactCaptureOptions = {},
  ): FlowRunArtifactCapture {
    const targetSteps = (options.stepNames ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
    const publishedSteps = new Set<string>()
    const completedSteps = new Set<string>()
    const forcedSteps = new Set<string>()
    const existingRuntimeEvents = new WeakSet<object>()
    const handledRuntimeEvents = new WeakSet<object>()
    if (!options.inspectExisting) {
      for (const event of backendRuntimeEvents.value) existingRuntimeEvents.add(event)
    }
    let stopped = false
    let inspectionQueue = Promise.resolve()
    let unregisterWorkspaceCleanup: (() => void) | null = null

    const ownerSessionId = (): string | undefined =>
      options.ownerSessionId ?? messageStore.activeSessionId ?? undefined

    const matchesTarget = (stepName: string): boolean =>
      targetSteps.length === 0 ||
      targetSteps.some((target) => sameCapturedFlowStep(target, stepName))

    const alreadyPublishedInSession = (step: WorkspaceStepResource): boolean => {
      const sessionId = ownerSessionId()
      if (!sessionId) return false
      const messages = (messageStore.messagesBySessionId[sessionId] ?? []).filter(
        (message) => {
          if (!message.isGuiArtifact) return false
          const messageStep = message.infoData?.step ?? message.mapData?.step ?? ''
          return sameCapturedFlowStep(messageStep, step.name)
        },
      )
      const artifacts = flowStepRunArtifacts(step)
      const reports = artifacts.reports.slice(0, MAX_STEP_REPORTS)
      const reportTitles = new Set(
        messages
          .filter((message) => message.type === 'info')
          .map((message) => message.infoData?.title ?? ''),
      )
      const reportsComplete = reports.every((report) =>
        reportTitles.has(filename(report.path)),
      )
      const layoutComplete =
        !artifacts.layout || messages.some((message) => message.type === 'map')
      return reportsComplete && layoutComplete
    }

    async function publishStepArtifacts(step: WorkspaceStepResource): Promise<boolean> {
      const artifacts = flowStepRunArtifacts(step)
      const reports = artifacts.reports.slice(0, MAX_STEP_REPORTS)
      let complete = true
      const sessionId = ownerSessionId()
      const existingReportTitles = new Set(
        (sessionId ? messageStore.messagesBySessionId[sessionId] : [])
          .filter((message) => {
            if (!message.isGuiArtifact || message.type !== 'info') return false
            const messageStep = message.infoData?.step ?? ''
            return sameCapturedFlowStep(messageStep, step.name)
          })
          .map((message) => message.infoData?.title ?? ''),
      )

      for (const report of reports) {
        const title = filename(report.path)
        if (existingReportTitles.has(title)) continue
        try {
          const authorizedPath = await resolveProjectPathAccess(report.path)
          if (!authorizedPath) {
            complete = false
            continue
          }
          const content = await readOptionalProjectTextFile(authorizedPath)
          if (content === null) {
            complete = false
            continue
          }

          messageStore.addInfoMessage(
            {
              title,
              step: step.name,
              compact: true,
              items: [
                {
                  label: title,
                  content,
                  format: 'text',
                },
              ],
            },
            ownerSessionId(),
          )
        } catch (error) {
          complete = false
          console.warn(`Failed to load report ${report.path}:`, error)
        }
      }

      if (!artifacts.layout) return complete
      let imageUrl: string | null = null
      try {
        const authorizedPath = await resolveProjectPathAccess(artifacts.layout.path)
        if (authorizedPath) {
          imageUrl = await readProjectBlobUrl(authorizedPath, {
            mimeType: 'image/png',
          })
        }
      } catch {
        // The committed backend artifact can become readable before the legacy path.
      }
      if (!imageUrl) {
        try {
          imageUrl = await readBackendLayoutBlobUrl(step.name)
        } catch {
          // Retried by the next step/terminal inspection.
        }
      }
      if (!imageUrl) {
        console.warn(`Failed to load layout image ${artifacts.layout.path}`)
        return false
      }
      try {
        registerBlobUrl(imageUrl, { label: `flow layout: ${step.name}` })
        messageStore.addMapMessage(
          {
            title: 'Layout preview',
            step: step.name,
            imageUrl,
            localPath: artifacts.layout.path,
            info: [],
            category: 'Layout',
            compact: true,
            showLegend: false,
          },
          ownerSessionId(),
        )
      } catch (error) {
        URL.revokeObjectURL(imageUrl)
        complete = false
        console.warn(`Failed to load layout image ${artifacts.layout.path}:`, error)
      }
      return complete
    }

    async function inspectCompletedSteps(
      stepNames?: Iterable<string>,
      resourceIndex?: WorkspaceResourceIndex,
    ): Promise<void> {
      if (stopped) return
      try {
        const index = resourceIndex ?? (await getWorkspaceResourceIndexApi())
        if (stopped) return
        const requested = stepNames ? [...stepNames] : null
        const names = requested ?? [...completedSteps, ...forcedSteps]
        for (const stepName of new Set(names)) {
          if (!matchesTarget(stepName)) continue
          const forced = capturedFlowStepSetHas(forcedSteps, stepName)
          if (capturedFlowStepSetHas(publishedSteps, stepName) && !forced) continue
          const step = index.flow.steps.find((candidate) =>
            sameCapturedFlowStep(candidate.name, stepName),
          )
          if (!step || !isSuccessfulFlowStep(step) || stopped) continue
          if (alreadyPublishedInSession(step) && !forced) {
            addCapturedFlowStep(publishedSteps, stepName)
            continue
          }
          if (await publishStepArtifacts(step)) {
            addCapturedFlowStep(publishedSteps, step.name)
          }
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

    async function inspectExistingCompletedSteps(): Promise<void> {
      try {
        const index = await getWorkspaceResourceIndexApi()
        if (stopped) return
        for (const step of index.flow.steps) {
          if (matchesTarget(step.name) && isSuccessfulFlowStep(step)) {
            addCapturedFlowStep(completedSteps, step.name)
          }
        }
        await enqueueInspection(undefined, index)
      } catch (error) {
        console.warn('Failed to inspect existing flow artifacts:', error)
      }
    }

    let stopWatchingRuntimeEvents: (() => void) | null = null
    let unregisterWorkspaceRerunPrepared: (() => void) | null = null
    const capture: FlowRunArtifactCapture = {
      inspect(stepNames?: Iterable<string>): Promise<void> {
        return enqueueInspection(stepNames)
      },
      async settle(settleOptions: FlowRunArtifactSettleOptions = {}): Promise<void> {
        for (const stepName of settleOptions.forceStepNames ?? []) {
          addCapturedFlowStep(forcedSteps, stepName)
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
        unregisterWorkspaceRerunPrepared?.()
        unregisterWorkspaceRerunPrepared = null
        unregisterWorkspaceCleanup?.()
        unregisterWorkspaceCleanup = null
      },
    }

    const unregisterStepRenderTask = registerRuntimeStepRenderTask(async (commit) => {
      if (stopped || !commit.step || !matchesTarget(commit.step)) return
      addCapturedFlowStep(completedSteps, commit.step)
      await enqueueInspection([commit.step], await commit.resourceIndex())
    })

    unregisterWorkspaceRerunPrepared = onWorkspaceRerunPrepared((event) => {
      const projectPath = currentProject.value?.path
      if (
        !projectPath ||
        normalizeWorkspaceProjectPath(event.projectPath) !==
          normalizeWorkspaceProjectPath(projectPath)
      ) {
        return
      }
      const affected = event.affectedSteps.filter(matchesTarget)
      if (affected.length > 0) {
        for (const stepName of affected) {
          deleteCapturedFlowStep(publishedSteps, stepName)
          deleteCapturedFlowStep(completedSteps, stepName)
        }
        messageStore.clearSessionGuiArtifactsForSteps(affected, ownerSessionId())
      }
    })

    function consumeRuntimeEvent(event: DesignRuntimeEvent): void {
      if (
        stopped ||
        existingRuntimeEvents.has(event) ||
        handledRuntimeEvents.has(event)
      ) {
        return
      }
      handledRuntimeEvents.add(event)
      const protocolType = backendRuntimeEventKind(event)
      const step = backendRuntimeEventStep(event) ?? ''
      if (protocolType === 'step.started' && step) {
        deleteCapturedFlowStep(publishedSteps, step)
        return
      }
      if (protocolType === 'step.completed' && step) {
        const state = backendRuntimeEventState(event)?.toLowerCase() ?? ''
        if (state === 'success') addCapturedFlowStep(completedSteps, step)
        return
      }
      if (backendRuntimeEventTerminalState(event)) {
        enqueueFinalInspection()
        if (options.stopOnTerminal !== false) {
          void inspectionQueue.finally(() => capture.stop())
        }
      }
    }

    stopWatchingRuntimeEvents = watch(
      backendRuntimeEvents,
      (events) => {
        for (const event of events) consumeRuntimeEvent(event)
      },
      { deep: true, flush: 'sync' },
    )

    unregisterWorkspaceCleanup = registerCleanup(() => capture.stop(), {
      label: 'flow run artifact capture',
    })
    if (options.inspectExisting) {
      void inspectExistingCompletedSteps()
    }
    return capture
  }

  return { startFlowRunArtifactCapture }
}
