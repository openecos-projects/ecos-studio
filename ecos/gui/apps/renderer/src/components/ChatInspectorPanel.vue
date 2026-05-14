<template>
  <div class="chat-inspector-panel flex flex-col h-full w-full min-w-0 max-w-full bg-(--bg-primary) overflow-hidden">
    <div class="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-(--border-color)">
      <button type="button" @click="activeTab = 'chat'" :class="tabClass(activeTab === 'chat')" title="AI Chat">
        <i class="ri-chat-3-line text-base"></i>
      </button>
      <button
        v-if="showStepConfigInspector"
        type="button"
        @click="activeTab = 'inspector'"
        :class="tabClass(activeTab === 'inspector')"
        title="Configuration"
      >
        <i class="ri-layout-column-line text-base"></i>
      </button>
    </div>

    <div class="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
      <!-- KeepAlive：避免 v-if 销毁聊天导致 blob 图重新加载/裂图；状态与滚动由子组件 onActivated 恢复 -->
      <KeepAlive>
        <AIChatPanel v-if="activeTab === 'chat'" class="flex-1 min-h-0 h-full min-w-0 w-full max-w-full overflow-hidden" />
      </KeepAlive>

      <StepConfigPanel
        v-if="activeTab === 'inspector' && showStepConfigInspector"
        class="flex-1 min-h-0 flex flex-col h-full min-w-0 overflow-hidden"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { StepEnum } from '@/api/type'
import AIChatPanel from './AIChatPanel.vue'
import StepConfigPanel from './StepConfigPanel.vue'

const route = useRoute()
const stepEnumValues = Object.values(StepEnum)

function stepFromRoutePath(): StepEnum | undefined {
  const segment = route.path.split('/').pop() || ''
  return stepEnumValues.find((s) => s.toLowerCase() === segment.toLowerCase())
}

/** Synthesis 不提供步骤配置编辑，隐藏 Inspector 标签与面板 */
const showStepConfigInspector = computed(() => stepFromRoutePath() !== StepEnum.SYNTHESIS)

const activeTab = ref<'chat' | 'inspector'>('chat')

watch(
  () => route.path,
  () => {
    if (!showStepConfigInspector.value && activeTab.value === 'inspector') {
      activeTab.value = 'chat'
    }
  },
)

function tabClass(active: boolean) {
  return [
    'h-8 w-9 rounded flex items-center justify-center transition-all cursor-pointer border',
    active
      ? 'text-(--accent-color) bg-(--accent-color)/20 border-(--accent-color)/50'
      : 'text-(--text-secondary) border-transparent hover:bg-(--bg-hover)',
  ]
}
</script>

<style scoped>
/* Do not use contain: size — it can zero out nested flex height and black out content */
.chat-inspector-panel {
  box-sizing: border-box;
}
</style>
