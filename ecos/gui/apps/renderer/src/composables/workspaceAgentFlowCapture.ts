import { getCurrentInstance, onUnmounted, watch } from 'vue'
import { useAgentFlowProgress } from '@/composables/useAgentFlowProgress'
import {
  useFlowRunArtifacts,
  type FlowRunArtifactCapture,
} from '@/composables/useFlowRunArtifacts'
import { useWorkspace } from '@/composables/useWorkspace'
import { getAgentSessionUi } from '@/components/agentSessionUi'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useMessageStore } from '@/stores/messageStore'
import { isFlowExecutionActiveForWorkspace } from './flowExecutionState'
import { normalizeWorkspaceProjectPath } from './homeRunArtifacts'

const activeCaptures = new Map<
  string,
  { workspacePath: string; capture: FlowRunArtifactCapture }
>()

/** Publish queued artifacts before the Agent appends its terminal response. */
export async function waitForWorkspaceAgentFlowArtifacts(
  workspacePath: string,
  sessionId: string,
): Promise<void> {
  const active = activeCaptures.get(sessionId)
  if (
    !active ||
    normalizeWorkspaceProjectPath(active.workspacePath) !==
      normalizeWorkspaceProjectPath(workspacePath)
  ) {
    return
  }
  await active.capture.inspect()
}

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
    if (activeCaptures.get(activeSessionId)?.capture === capture) {
      activeCaptures.delete(activeSessionId)
    }
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
    activeCaptures.set(sessionId, { workspacePath, capture })
  }

  watch(
    () => ({
      running: isFlowExecutionActiveForWorkspace(currentProject.value?.path),
      sessionId: agentShell.sessionId,
      workspacePath: currentProject.value?.path ?? '',
      tabWorkspacePath: agentShell.activeTab?.workspacePath ?? '',
      // Session start emits the welcome message; publishing before it settles
      // interleaves restored artifacts with the greeting.
      connecting: agentShell.sessionId
        ? getAgentSessionUi(agentShell.sessionId).isConnecting
        : false,
    }),
    ({ running, sessionId, workspacePath, tabWorkspacePath, connecting }) => {
      if (!sessionId || !workspacePath) {
        stopCapture()
        stopProgress()
        return
      }
      // A tab bound to another workspace keeps its own conversation.
      if (
        connecting ||
        (tabWorkspacePath &&
          normalizeWorkspaceProjectPath(tabWorkspacePath) !==
            normalizeWorkspaceProjectPath(workspacePath))
      ) {
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
