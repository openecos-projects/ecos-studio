<template>
  <Teleport to="body">
    <Transition name="home-agent-drawer">
      <aside
        v-if="homeAgentOpen"
        class="home-agent-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="ECOS Agent"
        :style="{ width: panelWidthStyle }"
      >
        <div
          class="agent-panel-resize-handle"
          title="Resize Agent panel"
          aria-label="Resize Agent panel"
          role="separator"
          aria-orientation="vertical"
          @pointerdown="onResizePointerDown"
        ></div>
        <div class="home-agent-drawer__body">
          <AIChatPanel shell="home" class="home-agent-drawer__chat" />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import AIChatPanel from './AIChatPanel.vue'
import { useAgentPanelResize } from '@/composables/useAgentPanelResize'
import { useAgentShellStore } from '@/stores/agentShellStore'

const agentShell = useAgentShellStore()
const { homeAgentOpen } = storeToRefs(agentShell)
/** Use viewport as the width budget for the fixed right drawer. */
const viewportRef = ref<HTMLElement | null>(
  typeof document !== 'undefined' ? document.documentElement : null,
)
const { panelWidthStyle, onResizePointerDown } = useAgentPanelResize(viewportRef)
</script>

<style scoped>
.home-agent-drawer {
  position: fixed;
  top: var(--topbar-height, 40px);
  right: 0;
  bottom: var(--status-bar-height, 24px);
  z-index: 40;
  display: flex;
  min-width: 280px;
  max-width: min(720px, 100vw);
  flex-direction: column;
  border-left: 1px solid var(--border-color);
  /* Keep the same surface as the shell so the drawer is not a solid square slab. */
  background: var(--bg-primary);
  box-shadow: -6px 0 24px rgb(0 0 0 / 6%);
}

.agent-panel-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  z-index: 2;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}

.agent-panel-resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: transparent;
  transition:
    background-color 120ms ease,
    width 120ms ease,
    left 120ms ease;
}

.agent-panel-resize-handle:hover::before,
:global(body.agent-panel-resizing) .agent-panel-resize-handle::before {
  left: 2px;
  width: 2px;
  background: var(--accent-color);
}

.home-agent-drawer__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.home-agent-drawer__chat {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.home-agent-drawer-enter-active,
.home-agent-drawer-leave-active {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}

.home-agent-drawer-enter-from,
.home-agent-drawer-leave-to {
  transform: translateX(12px);
  opacity: 0;
}
</style>
