<template>
  <Teleport to="body" :disabled="!isAnyPanelFullscreen">
    <div
      :class="[
        'chat-inspector-panel flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden bg-(--bg-primary)',
        {
          'is-panel-fullscreen panel-fullscreen-card': isAnyPanelFullscreen,
          'is-chat-fullscreen': isChatFullscreen,
          'is-step-config-fullscreen': isStepConfigFullscreen,
        },
      ]"
    >
      <div
        class="chat-inspector-topbar flex h-10 shrink-0 items-center gap-2 border-b border-(--border-color) px-3"
      >
        <div class="chat-inspector-tabs flex min-w-0 items-center gap-2">
          <button
            type="button"
            @click="selectTab('chat')"
            :class="tabClass(activeTab === 'chat')"
            title="AI Chat"
          >
            <i class="ri-chat-3-line text-base"></i>
          </button>
          <button
            v-if="showStepConfigInspector"
            type="button"
            @click="selectTab('inspector')"
            :class="tabClass(activeTab === 'inspector')"
            title="Configuration"
          >
            <i class="ri-layout-column-line text-base"></i>
          </button>
          <button
            v-if="showStepQorAnalysis"
            type="button"
            @click="selectTab('analysis')"
            :class="tabClass(activeTab === 'analysis')"
            title="QoR Analysis"
            aria-label="QoR Analysis"
          >
            <i class="ri-bar-chart-box-line text-base"></i>
          </button>
        </div>

        <button
          type="button"
          class="chat-inspector-fullscreen-toggle"
          :title="activePanelFullscreen ? 'Exit full screen' : 'Full screen'"
          :aria-label="
            activePanelFullscreen
              ? activeTab === 'chat'
                ? 'Exit AI Chat full screen'
                : activeTab === 'inspector'
                  ? 'Exit step configuration full screen'
                  : 'Exit step QoR analysis full screen'
              : activeTab === 'chat'
                ? 'View AI Chat full screen'
                : activeTab === 'inspector'
                  ? 'View step configuration full screen'
                  : 'View step QoR analysis full screen'
          "
          @click="toggleActivePanelFullscreen"
        >
          <i
            :class="
              activePanelFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'
            "
          ></i>
        </button>
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <!-- KeepAlive：避免 v-if 销毁聊天导致 blob 图重新加载/裂图；状态与滚动由子组件 onActivated 恢复 -->
        <KeepAlive>
          <AIChatPanel
            v-if="activeTab === 'chat'"
            class="h-full min-h-0 w-full max-w-full min-w-0 flex-1 overflow-hidden"
          />
        </KeepAlive>

        <StepConfigPanel
          v-if="activeTab === 'inspector' && showStepConfigInspector"
          class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        />

        <StepQorAnalysisPanel
          v-if="activeTab === 'analysis' && showStepQorAnalysis"
          class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        />
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <Transition name="panel-fullscreen-backdrop">
      <div
        v-if="isAnyPanelFullscreen"
        class="panel-fullscreen-overlay"
        @click="closePanelFullscreen"
      ></div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { StepEnum } from '@/api/type'
import AIChatPanel from './AIChatPanel.vue'
import StepConfigPanel from './StepConfigPanel.vue'
import StepQorAnalysisPanel from './StepQorAnalysisPanel.vue'

const route = useRoute()
const stepEnumValues = Object.values(StepEnum)

function stepFromRoutePath(): StepEnum | undefined {
  const segment = route.path.split('/').pop() || ''
  return stepEnumValues.find((s) => s.toLowerCase() === segment.toLowerCase())
}

/** Synthesis 不提供步骤配置编辑，隐藏 Inspector 标签与面板 */
const showStepConfigInspector = computed(() => stepFromRoutePath() !== StepEnum.SYNTHESIS)
const showStepQorAnalysis = computed(() =>
  [StepEnum.PLACEMENT, StepEnum.ROUTING, StepEnum.STA].includes(
    stepFromRoutePath() ?? StepEnum.INIT,
  ),
)

const activeTab = ref<'chat' | 'inspector' | 'analysis'>('chat')
const isChatFullscreen = ref(false)
const isStepConfigFullscreen = ref(false)
const isStepQorAnalysisFullscreen = ref(false)

const isAnyPanelFullscreen = computed(
  () =>
    isChatFullscreen.value ||
    isStepConfigFullscreen.value ||
    isStepQorAnalysisFullscreen.value,
)
const activePanelFullscreen = computed(() =>
  activeTab.value === 'chat'
    ? isChatFullscreen.value
    : activeTab.value === 'inspector'
      ? isStepConfigFullscreen.value
      : isStepQorAnalysisFullscreen.value,
)

watch(
  () => route.path,
  () => {
    if (!showStepConfigInspector.value && activeTab.value === 'inspector') {
      activeTab.value = 'chat'
    }
    if (!showStepQorAnalysis.value && activeTab.value === 'analysis') {
      activeTab.value = 'chat'
    }
    if (!showStepConfigInspector.value && isStepConfigFullscreen.value) {
      closePanelFullscreen()
    }
    if (!showStepQorAnalysis.value && isStepQorAnalysisFullscreen.value) {
      closePanelFullscreen()
    }
  },
)

function selectTab(tab: 'chat' | 'inspector' | 'analysis'): void {
  if (tab === 'inspector' && !showStepConfigInspector.value) return
  if (tab === 'analysis' && !showStepQorAnalysis.value) return
  activeTab.value = tab

  if (isAnyPanelFullscreen.value) {
    openPanelFullscreen(tab)
  }
}

function openPanelFullscreen(panel: 'chat' | 'inspector' | 'analysis'): void {
  if (panel === 'inspector' && !showStepConfigInspector.value) return
  if (panel === 'analysis' && !showStepQorAnalysis.value) return

  activeTab.value = panel
  isChatFullscreen.value = panel === 'chat'
  isStepConfigFullscreen.value = panel === 'inspector'
  isStepQorAnalysisFullscreen.value = panel === 'analysis'
}

function closePanelFullscreen(): void {
  isChatFullscreen.value = false
  isStepConfigFullscreen.value = false
  isStepQorAnalysisFullscreen.value = false
}

function toggleActivePanelFullscreen(): void {
  if (activePanelFullscreen.value) {
    closePanelFullscreen()
    return
  }
  openPanelFullscreen(activeTab.value)
}

function onFullscreenKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.key !== 'Escape' || !isAnyPanelFullscreen.value) return
  closePanelFullscreen()
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onFullscreenKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onFullscreenKeydown)
})

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

.chat-inspector-panel.is-panel-fullscreen {
  position: fixed;
  inset: 12px;
  z-index: 20000;
  width: calc(100vw - 24px) !important;
  height: calc(100vh - 24px) !important;
  max-width: none !important;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 0;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.34);
}

.chat-inspector-topbar {
  justify-content: space-between;
}

.chat-inspector-tabs {
  flex: 1 1 auto;
}

.chat-inspector-fullscreen-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;
}

.chat-inspector-fullscreen-toggle:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
  transform: translateY(-1px);
}

.chat-inspector-fullscreen-toggle:active {
  transform: translateY(0);
}

.panel-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 19995;
  background: rgba(0, 0, 0, 0.78);
}

.panel-fullscreen-backdrop-enter-active,
.panel-fullscreen-backdrop-leave-active {
  transition: opacity 0.18s ease-out;
}

.panel-fullscreen-backdrop-enter-from,
.panel-fullscreen-backdrop-leave-to {
  opacity: 0;
}
</style>
