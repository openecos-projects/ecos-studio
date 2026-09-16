import { getCurrentInstance, onUnmounted, watch } from 'vue'
import { useAgentFlowProgress } from '@/composables/useAgentFlowProgress'
import { useFlowRunArtifacts } from '@/composables/useFlowRunArtifacts'
import { useWorkspace } from '@/composables/useWorkspace'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useMessageStore } from '@/stores/messageStore'
import { isFlowExecutionActiveForWorkspace } from './flowExecutionState'

/**
 * Publishes GUI-started flow reports and layouts into the visible Agent tab.
 * Capture used to live on FlowRunControl, so leaving Dashboard or a step page
 * stopped it before any artifacts arrived.
 */
export function useWorkspaceAgentFlowCapture(): void {
  const agentShell = useAgentShellStore()
  const messageStore = useMessageStore()
  const { backendRuntimeEvents, currentProject } = useWorkspace()
  const { startFlowRunArtifactCapture } = useFlowRunArtifacts()
  const progress = useAgentFlowProgress(
    (message) => {
      const sessionId = agentShell.sessionId
      if (!sessionId) return
      messageStore.appendToolProgress(message, sessionId)
    },
    () => undefined,
    backendRuntimeEvents,
  )

  let capture: ReturnType<typeof startFlowRunArtifactCapture> | null = null
  let activeWorkspacePath = ''
  let activeSessionId = ''
  let progressWorkspacePath = ''
  let runWasActive = false

  function stopCapture(): void {
    capture?.stop()
    capture = null
    activeWorkspacePath = ''
    activeSessionId = ''
  }

  function stopProgress(): void {
    if (!progressWorkspacePath) return
    progress.stop()
    const sessionId = agentShell.sessionId
    if (sessionId) messageStore.finishToolProgress(sessionId)
    progressWorkspacePath = ''
    runWasActive = false
  }

  function startCapture(workspacePath: string, sessionId: string): void {
    if (
      activeWorkspacePath === workspacePath &&
      activeSessionId === sessionId &&
      capture
    ) {
      return
    }
    stopCapture()
    activeWorkspacePath = workspacePath
    activeSessionId = sessionId
    messageStore.setActiveSessionId(sessionId)
    capture = startFlowRunArtifactCapture({
      inspectExisting: true,
      ownerSessionId: sessionId,
      stopOnTerminal: false,
    })
  }

  watch(
    () => ({
      running: isFlowExecutionActiveForWorkspace(currentProject.value?.path),
      sessionId: agentShell.sessionId,
      workspacePath: currentProject.value?.path ?? '',
    }),
    ({ running, sessionId, workspacePath }) => {
      if (!sessionId || !workspacePath) {
        stopCapture()
        stopProgress()
        return
      }
      if (progressWorkspacePath !== workspacePath) {
        progress.stop()
        progress.start(workspacePath)
        progressWorkspacePath = workspacePath
      }
      startCapture(workspacePath, sessionId)
      if (running) {
        runWasActive = true
        return
      }
      if (runWasActive) {
        runWasActive = false
        messageStore.finishToolProgress(sessionId)
      }
    },
    { immediate: true },
  )

  if (getCurrentInstance()) {
    onUnmounted(() => {
      stopCapture()
      stopProgress()
    })
  }
}
