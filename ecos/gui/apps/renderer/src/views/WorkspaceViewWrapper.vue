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
</template>

<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router'
import LeftSidebar from '../components/LeftSidebar.vue'
// import RightSidebar from '../components/RightSidebar.vue'
import { useWorkspace } from '../composables/useWorkspace'

const { closeProject } = useWorkspace()

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
  /* auto 会在子树 min-content 变宽时出现整页横向滚动条；主区域由内部 Splitter/滚动区消化 */
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
  /* 重要：防止 flex 子元素溢出 */
  min-width: 0;
  /* 允许 flex 子元素收缩 */
}

.editor-view {
  /* 与 LeftSidebar 同列 flex：勿用 width:100%，否则会与侧栏宽度叠加超出 workspace-main */
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
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
