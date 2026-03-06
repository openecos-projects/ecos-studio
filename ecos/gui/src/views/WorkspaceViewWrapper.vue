<template>
  <div class="workspace-view">
    <!-- 主内容区域 -->
    <main class="workspace-main">
      <!-- 最左侧工具栏  -->
      <LeftSidebar />
      <router-view class="editor-view" />
      <!-- 最右侧属性栏 -->
      <!-- <RightSidebar /> -->
    </main>
  </div>
  <NewProjectWizard v-if="showWizard" @close="showWizard = false" @create="handleWizardCreate" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import LeftSidebar from '../components/LeftSidebar.vue'
// import RightSidebar from '../components/RightSidebar.vue'
import { useMenuEvents } from '../composables/useMenuEvents'
import NewProjectWizard from '../components/NewProjectWizard.vue'
import type { WorkspaceConfig } from '../types'
import { useWorkspace } from '../composables/useWorkspace'

const { closeProject } = useWorkspace()

const showWizard = ref(false)

const handleNewProject = () => {
  console.log('new_project');
  showWizard.value = true
}

const handleWizardCreate = (config: WorkspaceConfig) => {
  console.log('handleWizardCreate', config);
}

useMenuEvents({
  new_project: handleNewProject
})

onBeforeRouteLeave(async () => {
  await closeProject()
})
</script>

<style scoped>
.workspace-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: auto;
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
  /* 重要：防止 flex 子元素溢出 */
  min-width: 0;
  /* 允许 flex 子元素收缩 */
}

.editor-view {
  width: 100%;
  height: 100%;
}

/* 响应式布局 - 在小屏幕上调整最小尺寸 */
@media (max-width: 1630px) {
  .workspace-main {
    /* 在小屏幕上允许更多的灵活性 */
    max-width: 100vw;
  }
}
</style>
