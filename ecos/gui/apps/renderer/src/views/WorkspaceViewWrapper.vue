<template>
  <div class="workspace-view">
    <main :key="workspaceViewKey" class="workspace-main">
      <LeftSidebar />
      <div class="workspace-body">
        <div class="workspace-editor">
          <router-view class="editor-view" />
        </div>
        <aside v-if="workspaceChatExpanded" class="workspace-chat-rail">
          <ChatInspectorPanel class="workspace-chat-rail__panel" />
        </aside>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import LeftSidebar from '../components/LeftSidebar.vue'
import ChatInspectorPanel from '../components/ChatInspectorPanel.vue'
import { clearHomeQorComparisonCache } from '../composables/useHomeQorComparison'
import { clearHomeSnapshotCache } from '../composables/useHomeSnapshots'
import { clearStepDashboardDataCache } from '../composables/useStepDashboardData'
import { useWorkspace } from '../composables/useWorkspace'
import { useAgentShellStore } from '@/stores/agentShellStore'

const { closeProject, currentProject } = useWorkspace()
const agentShell = useAgentShellStore()
const { workspaceChatExpanded } = storeToRefs(agentShell)
const workspaceViewKey = computed(() => currentProject.value?.path ?? '')

watch(
  () => currentProject.value?.path,
  (path, previousPath) => {
    if (!path || !previousPath || path === previousPath) return
    if (agentShell.shouldPreserveSession()) {
      agentShell.consumePreserveSession()
      return
    }
    agentShell.resetShell()
  },
)

onMounted(() => {
  agentShell.setMode('workspace')
  agentShell.closeHomeAgent()
})

onBeforeRouteLeave(async () => {
  await closeProject()
  clearStepDashboardDataCache()
  clearHomeQorComparisonCache()
  clearHomeSnapshotCache()
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

.workspace-chat-rail {
  display: flex;
  width: min(420px, 36vw);
  min-width: 280px;
  max-width: 520px;
  height: 100%;
  flex-shrink: 0;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.workspace-chat-rail__panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 1630px) {
  .workspace-main {
    max-width: 100vw;
  }
}
</style>
