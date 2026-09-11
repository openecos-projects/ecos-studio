<template>
  <div class="workspace-view">
    <main :key="workspaceViewKey" class="workspace-main">
      <FrontendLeftSidebar v-if="currentProject?.designTool === 'frontend'" />
      <LeftSidebar v-else />
      <div class="workspace-body">
        <div class="workspace-editor">
          <router-view class="editor-view" />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import FrontendLeftSidebar from '../components/FrontendLeftSidebar.vue'
import LeftSidebar from '../components/LeftSidebar.vue'
import { clearBaselineStepConfigCache } from '../composables/useBaselineStepConfig'
import { clearHomeSnapshotCache } from '../composables/useHomeSnapshots'
import { clearStepDashboardDataCache } from '../composables/useStepDashboardData'
import { useWorkspace } from '../composables/useWorkspace'
import { useWorkspaceAgentFlowCapture } from '../composables/workspaceAgentFlowCapture'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'

const { currentProject, workspaceSession } = useWorkspace()
const agentShell = useAgentShellStore()
const backendWorkspaceSession = useBackendWorkspaceSession()
useWorkspaceAgentFlowCapture()
const workspaceViewKey = computed(
  () => `${currentProject.value?.path ?? ''}:${workspaceSession.value.sessionId}`,
)

watch(
  () =>
    [
      currentProject.value?.path ?? '',
      workspaceSession.value.sessionId,
      workspaceSession.value.state,
    ] as const,
  ([path, sessionId, state], previous) => {
    const [previousPath, previousSessionId, previousState] = previous
    const pathChanged = path !== previousPath
    const activeSessionReplaced =
      state === 'active' &&
      (sessionId !== previousSessionId || previousState !== 'active')
    if (pathChanged || activeSessionReplaced) {
      if (path) backendWorkspaceSession.clearWorkspace(path)
      backendWorkspaceSession.clear()
      if (path && currentProject.value?.designTool !== 'frontend') {
        void backendWorkspaceSession.start(path, {
          forceRefresh: activeSessionReplaced,
        })
      }
    }
    if (!path || !previousPath || path === previousPath) return
    // Agent chat tabs keep their frozen context across workspace switches.
    if (agentShell.shouldPreserveSession()) {
      agentShell.consumePreserveSession()
    }
  },
)

onMounted(() => {
  agentShell.setMode('workspace')
  agentShell.closeHomeAgent()
  if (currentProject.value?.designTool !== 'frontend') {
    void backendWorkspaceSession.start(currentProject.value?.path)
  }
})

onBeforeRouteLeave(() => {
  backendWorkspaceSession.dispose()
  clearStepDashboardDataCache()
  clearBaselineStepConfigCache()
  clearHomeSnapshotCache()
  // Keep Agent tabs across workspace navigation.
  agentShell.resetShell({ keepHomeOpen: false })
})
</script>

<style scoped>
.workspace-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.workspace-main {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
  width: 100%;
  min-height: 0;
  min-width: 0;
}

.workspace-body {
  display: flex;
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.workspace-editor {
  display: flex;
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.editor-view {
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

@media (max-width: 1630px) {
  .workspace-main {
    max-width: 100vw;
  }
}
</style>
