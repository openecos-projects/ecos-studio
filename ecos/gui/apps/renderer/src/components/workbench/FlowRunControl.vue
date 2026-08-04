<template>
  <div ref="controlElement" class="flow-run-control">
    <button
      type="button"
      class="flow-run-icon-button flow-run-start-button"
      :aria-busy="flowRunControlBusy"
      :disabled="flowRunControlBusy"
      :title="activeMode.label"
      @click="handleRunFlow"
    >
      <i
        :class="flowRunControlBusy ? 'ri-loader-4-line animate-spin' : 'ri-play-fill'"
        aria-hidden="true"
      />
    </button>
    <button
      type="button"
      class="flow-run-icon-button"
      :aria-expanded="showModeMenu"
      aria-haspopup="menu"
      :disabled="flowRunControlBusy"
      :title="`Select: ${activeMode.label}`"
      @click="showModeMenu = !showModeMenu"
    >
      <i class="ri-more-2-fill" aria-hidden="true" />
    </button>

    <div v-if="showModeMenu" class="flow-run-menu" role="menu">
      <button
        v-for="(mode, key) in runModes"
        :key="key"
        type="button"
        role="menuitemradio"
        :aria-checked="activeRunMode === key"
        :class="{ 'is-active': activeRunMode === key }"
        @click="handleRunModeSelect(key)"
      >
        <i :class="mode.icon" aria-hidden="true" />
        <span>{{ mode.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useFlowRunMode } from '@/composables/useFlowRunMode'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useFlowStages } from '@/composables/useFlowStages'
import { useSubflow } from '@/composables/useSubflow'
import { useWorkspace } from '@/composables/useWorkspace'

const controlElement = ref<HTMLElement | null>(null)
const showModeMenu = ref(false)
const { currentStage } = useCurrentStage()
const { activeRunMode, isRerun, runModes, selectRunMode } = useFlowRunMode(currentStage)
const { isRunning, runFlow, runAllFlow } = useFlowRunner()
const {
  hasOngoingRunStage,
  refreshFlowStages,
  setFirstRunStepOngoing,
  setRunStepOngoingByPath,
} = useFlowStages()
const { refreshCurrentSubflow } = useSubflow()
const { ensureApiReady } = useWorkspace()

const flowRunControlBusy = computed(() => isRunning.value || hasOngoingRunStage.value)
const activeMode = computed(() => runModes.value[activeRunMode.value])

function closeMenu(): void {
  showModeMenu.value = false
}

function handlePointerDown(event: PointerEvent): void {
  if (!controlElement.value?.contains(event.target as Node)) closeMenu()
}

function handleRunModeSelect(mode: string): void {
  selectRunMode(mode)
  closeMenu()
}

async function handleRunFlow(): Promise<void> {
  closeMenu()
  if (flowRunControlBusy.value) return

  if (!(await ensureApiReady())) {
    await refreshFlowStages()
    return
  }

  if (currentStage.value === 'home') {
    setFirstRunStepOngoing()
    await runAllFlow({ rerun: isRerun.value })
    await refreshFlowStages()
    return
  }

  setRunStepOngoingByPath(currentStage.value)
  await runFlow({ rerun: isRerun.value })
  await Promise.all([refreshCurrentSubflow(), refreshFlowStages()])
}

onMounted(() => document.addEventListener('pointerdown', handlePointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handlePointerDown))
</script>

<style scoped>
.flow-run-control,
.flow-run-menu,
.flow-run-menu button {
  align-items: center;
  display: flex;
}

.flow-run-control {
  gap: 4px;
  position: relative;
}

.flow-run-icon-button {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 25px;
  justify-content: center;
  padding: 0;
  width: 25px;
}

.flow-run-icon-button:hover:not(:disabled) {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.flow-run-start-button {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: #fff;
}

.flow-run-start-button:hover:not(:disabled) {
  color: #fff;
  opacity: 0.85;
}

.flow-run-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.flow-run-menu {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  left: 0;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  flex-direction: column;
  gap: 2px;
  min-width: 130px;
  padding: 4px;
  position: absolute;
  top: calc(100% + 5px);
  z-index: 20;
}

.flow-run-menu button {
  background: transparent;
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 11px;
  gap: 7px;
  padding: 6px 7px;
  text-align: left;
  width: 100%;
}

.flow-run-menu button:hover,
.flow-run-menu button.is-active {
  background: var(--bg-primary);
}

.flow-run-menu button.is-active {
  color: var(--accent-color);
}
</style>
