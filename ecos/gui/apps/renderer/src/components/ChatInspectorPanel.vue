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
      <!-- Config/QoR: one compact chrome row (no duplicate Chat|Config bar above tabs). -->
      <div
        v-if="activeTab !== 'chat'"
        class="panel-side-chrome"
        role="tablist"
        aria-label="Right panel modes"
      >
        <button
          type="button"
          role="tab"
          class="panel-side-chrome__tab"
          :aria-selected="false"
          title="Back to Agent chat"
          @click="selectTab('chat')"
        >
          Chat
        </button>
        <button
          v-if="showStepConfigInspector"
          type="button"
          role="tab"
          class="panel-side-chrome__tab"
          :class="{ 'panel-side-chrome__tab--active': activeTab === 'inspector' }"
          :aria-selected="activeTab === 'inspector'"
          title="Configuration"
          @click="selectTab('inspector')"
        >
          Config
        </button>
        <button
          v-if="showStepQorAnalysis"
          type="button"
          role="tab"
          class="panel-side-chrome__tab"
          :class="{ 'panel-side-chrome__tab--active': activeTab === 'analysis' }"
          :aria-selected="activeTab === 'analysis'"
          title="QoR Analysis"
          aria-label="QoR Analysis"
          @click="selectTab('analysis')"
        >
          QoR
        </button>
        <div class="panel-side-chrome__spacer" aria-hidden="true"></div>
        <button
          type="button"
          class="panel-side-chrome__icon chat-inspector-fullscreen-toggle"
          :title="activePanelFullscreen ? 'Exit full screen' : 'Full screen'"
          :aria-label="fullscreenAriaLabel"
          @click="toggleActivePanelFullscreen"
        >
          <i
            :class="
              activePanelFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'
            "
            aria-hidden="true"
          ></i>
        </button>
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <!-- KeepAlive：避免 v-if 销毁聊天导致 blob 图重新加载/裂图；状态与滚动由子组件 onActivated 恢复 -->
        <KeepAlive>
          <AIChatPanel
            v-if="activeTab === 'chat'"
            shell="workspace"
            class="h-full min-h-0 w-full max-w-full min-w-0 flex-1 overflow-hidden"
          >
            <template #tab-actions>
              <button
                v-if="showStepConfigInspector"
                type="button"
                class="panel-side-chrome__tab"
                title="Configuration"
                @click="selectTab('inspector')"
              >
                Config
              </button>
              <button
                v-if="showStepQorAnalysis"
                type="button"
                class="panel-side-chrome__tab"
                title="QoR Analysis"
                aria-label="QoR Analysis"
                @click="selectTab('analysis')"
              >
                QoR
              </button>
              <button
                type="button"
                class="panel-side-chrome__icon chat-inspector-fullscreen-toggle"
                :title="activePanelFullscreen ? 'Exit full screen' : 'Full screen'"
                :aria-label="fullscreenAriaLabel"
                @click="toggleActivePanelFullscreen"
              >
                <i
                  :class="
                    activePanelFullscreen
                      ? 'ri-fullscreen-exit-line'
                      : 'ri-fullscreen-line'
                  "
                  aria-hidden="true"
                ></i>
              </button>
            </template>
          </AIChatPanel>
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
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { StepEnum } from '@/api/type'
import AIChatPanel from './AIChatPanel.vue'
import StepConfigPanel from './StepConfigPanel.vue'
import StepQorAnalysisPanel from './StepQorAnalysisPanel.vue'
import { useAgentShellStore } from '@/stores/agentShellStore'

const route = useRoute()
const agentShell = useAgentShellStore()
const { chatFocusNonce } = storeToRefs(agentShell)
const stepEnumValues = Object.values(StepEnum)

function stepFromRoutePath(): StepEnum | undefined {
  const segment = route.path.split('/').pop() || ''
  return stepEnumValues.find((s) => s.toLowerCase() === segment.toLowerCase())
}

/** 仅步骤路由显示 Config/QoR；Home/tech/configure 只保留 Chat */
const showStepConfigInspector = computed(() => {
  const step = stepFromRoutePath()
  return Boolean(step) && step !== StepEnum.SYNTHESIS
})
const showStepQorAnalysis = computed(() => {
  const step = stepFromRoutePath()
  return (
    Boolean(step) &&
    [StepEnum.PLACEMENT, StepEnum.ROUTING, StepEnum.STA].includes(step)
  )
})

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

const fullscreenAriaLabel = computed(() => {
  if (activePanelFullscreen.value) {
    if (activeTab.value === 'chat') return 'Exit AI Chat full screen'
    if (activeTab.value === 'inspector') return 'Exit step configuration full screen'
    return 'Exit step QoR analysis full screen'
  }
  if (activeTab.value === 'chat') return 'View AI Chat full screen'
  if (activeTab.value === 'inspector') return 'View step configuration full screen'
  return 'View step QoR analysis full screen'
})

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

watch(chatFocusNonce, () => {
  selectTab('chat')
})

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

.panel-side-chrome {
  display: flex;
  height: 2.25rem;
  flex-shrink: 0;
  align-items: center;
  gap: 0.125rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 0 0.35rem 0 0.4rem;
  background: color-mix(in srgb, var(--bg-secondary) 55%, var(--bg-primary));
}

.panel-side-chrome__spacer {
  min-width: 0;
  flex: 1;
}

.panel-side-chrome__tab {
  display: inline-flex;
  height: 1.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  padding: 0 0.5rem;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
}

.panel-side-chrome__tab:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
}

.panel-side-chrome__tab--active {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
  color: var(--text-primary);
}

.panel-side-chrome__tab:focus-visible,
.panel-side-chrome__icon:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
}

.panel-side-chrome__icon {
  display: inline-flex;
  height: 1.5rem;
  width: 1.5rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.panel-side-chrome__icon:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
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
