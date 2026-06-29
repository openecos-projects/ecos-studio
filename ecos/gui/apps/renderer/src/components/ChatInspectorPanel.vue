<template>
  <Teleport to="body" :disabled="!isAnyPanelFullscreen">
    <div
      :class="[
        'chat-inspector-panel flex flex-col h-full w-full min-w-0 max-w-full bg-(--bg-primary) overflow-hidden',
        {
          'is-panel-fullscreen panel-fullscreen-card': isAnyPanelFullscreen,
          'is-chat-fullscreen': isChatFullscreen,
          'is-step-config-fullscreen': isStepConfigFullscreen,
        },
      ]"
    >
      <div class="chat-inspector-topbar h-10 shrink-0 flex items-center gap-2 px-3 border-b border-(--border-color)">
        <div class="chat-inspector-tabs flex items-center gap-2 min-w-0">
          <button type="button" @click="selectTab('chat')" :class="tabClass(activeTab === 'chat')" title="AI Chat">
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
        </div>

        <button
          type="button"
          class="chat-inspector-fullscreen-toggle"
          :title="activePanelFullscreen ? 'Exit full screen' : 'Full screen'"
          :aria-label="activePanelFullscreen
            ? (activeTab === 'chat' ? 'Exit AI Chat full screen' : 'Exit step configuration full screen')
            : (activeTab === 'chat' ? 'View AI Chat full screen' : 'View step configuration full screen')"
          @click="toggleActivePanelFullscreen"
        >
          <i :class="activePanelFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"></i>
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

const route = useRoute()
const stepEnumValues = Object.values(StepEnum)

function stepFromRoutePath(): StepEnum | undefined {
  const segment = route.path.split('/').pop() || ''
  return stepEnumValues.find((s) => s.toLowerCase() === segment.toLowerCase())
}

/** Synthesis 不提供步骤配置编辑，隐藏 Inspector 标签与面板 */
const showStepConfigInspector = computed(() => stepFromRoutePath() !== StepEnum.SYNTHESIS)

const activeTab = ref<'chat' | 'inspector'>('chat')
const isChatFullscreen = ref(false)
const isStepConfigFullscreen = ref(false)

const isAnyPanelFullscreen = computed(() => isChatFullscreen.value || isStepConfigFullscreen.value)
const activePanelFullscreen = computed(() =>
  activeTab.value === 'chat' ? isChatFullscreen.value : isStepConfigFullscreen.value,
)

watch(
  () => route.path,
  () => {
    if (!showStepConfigInspector.value && activeTab.value === 'inspector') {
      activeTab.value = 'chat'
    }
    if (!showStepConfigInspector.value && isStepConfigFullscreen.value) {
      closePanelFullscreen()
    }
  },
)

function selectTab(tab: 'chat' | 'inspector'): void {
  if (tab === 'inspector' && !showStepConfigInspector.value) return
  activeTab.value = tab

  if (isAnyPanelFullscreen.value) {
    openPanelFullscreen(tab)
  }
}

function openPanelFullscreen(panel: 'chat' | 'inspector'): void {
  if (panel === 'inspector' && !showStepConfigInspector.value) return

  activeTab.value = panel
  isChatFullscreen.value = panel === 'chat'
  isStepConfigFullscreen.value = panel === 'inspector'
}

function closePanelFullscreen(): void {
  isChatFullscreen.value = false
  isStepConfigFullscreen.value = false
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
