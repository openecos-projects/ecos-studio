<template>
  <div class="flex h-full">
    <nav
      class="flex h-full w-[64px] shrink-0 flex-col overflow-y-auto border-r border-(--border-color) bg-(--bg-sidebar) py-3"
      aria-label="Frontend flow navigation"
    >
      <router-link
        v-for="stage in sidebarStages"
        :key="stage.path"
        :to="workspaceStageLink(stage.path)"
        class="group relative mb-1 flex flex-col items-center justify-center py-4 transition-all"
        :class="[
          currentStage === stage.path
            ? 'text-(--accent-color)'
            : 'text-(--text-secondary)',
        ]"
      >
        <span
          v-if="currentStage === stage.path"
          class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-(--accent-color) shadow-[0_0_10px_var(--accent-color)]"
          aria-hidden="true"
        />

        <span class="relative transition-transform group-hover:-translate-y-0.5">
          <i :class="stage.icon" class="mb-1.5 inline-block text-xl" aria-hidden="true" />
          <i
            v-if="!stage.virtual && normalizedState(stage.state) === 'success'"
            class="ri-checkbox-circle-fill absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-green-500"
            aria-label="Completed"
          />
          <i
            v-else-if="!stage.virtual && normalizedState(stage.state) === 'running'"
            class="ri-loader-4-line absolute -top-1 -right-1 animate-spin rounded-full bg-(--bg-sidebar) text-[10px] text-blue-400"
            aria-label="Running"
          />
          <i
            v-else-if="!stage.virtual && normalizedState(stage.state) === 'pending'"
            class="ri-time-line absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-(--text-secondary)"
            aria-label="Pending"
          />
          <i
            v-else-if="!stage.virtual && normalizedState(stage.state) === 'failed'"
            class="ri-error-warning-fill absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-red-500"
            aria-label="Failed"
          />
          <i
            v-else-if="!stage.virtual && normalizedState(stage.state) === 'incomplete'"
            class="ri-indeterminate-circle-fill absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-amber-500"
            aria-label="Incomplete"
          />
        </span>

        <span class="scale-90 text-center text-[9px] leading-tight font-bold uppercase">
          {{ stage.label }}
        </span>
      </router-link>
    </nav>

    <aside
      v-if="showWorkspaceProgressPanel"
      class="flex w-[240px] max-w-[300px] min-w-[200px] shrink-0 flex-col overflow-hidden border-r border-(--border-color) bg-(--bg-primary)"
      aria-label="Frontend flow overview"
    >
      <header class="border-b border-(--border-color) px-4 py-4">
        <div class="flex items-center gap-3">
          <i class="ri-flow-chart text-xl text-(--text-secondary)" aria-hidden="true" />
          <div>
            <h3 class="text-[14px] font-semibold text-(--text-primary)">
              Frontend Workspace
            </h3>
            <p class="mt-0.5 text-[11px] text-(--text-secondary)">
              Frontend Verification Flow
            </p>
          </div>
        </div>
      </header>

      <section
        class="border-b border-(--border-color) bg-(--bg-secondary)/30 px-4 py-3"
        aria-label="Frontend flow status summary"
      >
        <div class="grid grid-cols-4 gap-2">
          <div class="flex flex-col items-center rounded-lg bg-green-500/10 p-2">
            <strong class="text-[14px] text-green-500">{{ flowStats.success }}</strong>
            <span class="text-[8px] text-green-500/80 uppercase">Done</span>
          </div>
          <div class="flex flex-col items-center rounded-lg bg-blue-500/10 p-2">
            <strong class="text-[14px] text-blue-400">{{ flowStats.ongoing }}</strong>
            <span class="text-[8px] text-blue-400/80 uppercase">Run</span>
          </div>
          <div class="flex flex-col items-center rounded-lg bg-red-500/10 p-2">
            <strong class="text-[14px] text-red-500">{{ flowStats.failed }}</strong>
            <span class="text-[8px] text-red-500/80 uppercase">Fail</span>
          </div>
          <div class="flex flex-col items-center rounded-lg bg-(--bg-secondary) p-2">
            <strong class="text-[14px] text-(--text-secondary)">{{
              flowStats.pending
            }}</strong>
            <span class="text-[8px] text-(--text-secondary)/80 uppercase">Wait</span>
          </div>
        </div>

        <div class="mt-3">
          <div class="mb-1.5 flex items-center justify-between">
            <span class="text-[10px] text-(--text-secondary) uppercase"
              >Total Progress</span
            >
            <strong class="text-[11px] text-(--accent-color)">
              {{ flowStats.success }}/{{ flowStats.total }}
            </strong>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-(--bg-secondary)">
            <div
              class="h-full rounded-full bg-(--accent-color) transition-all duration-500"
              :style="{ width: `${flowProgressPercent}%` }"
            />
          </div>
        </div>
      </section>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-if="runStages.length === 0"
          class="flex h-full items-center justify-center px-4 text-center"
        >
          <div>
            <i
              class="ri-file-list-3-line text-3xl text-(--text-secondary) opacity-50"
              aria-hidden="true"
            />
            <p class="mt-2 text-[11px] text-(--text-secondary)">No flow data available</p>
          </div>
        </div>

        <div v-else class="space-y-1 p-3">
          <router-link
            v-for="(stage, index) in runStages"
            :key="stage.path"
            :to="workspaceStageLink(stage.path)"
            class="group relative flex items-center gap-3 rounded-lg p-2 transition-all hover:bg-(--bg-secondary)/50"
            :class="{
              'bg-(--bg-secondary)/30': normalizedState(stage.state) === 'running',
              'bg-(--accent-color)/10': currentStage === stage.path,
            }"
          >
            <span
              v-if="index < runStages.length - 1"
              class="absolute top-[42px] left-[22px] h-[calc(100%-34px)] w-0.5"
              :class="
                normalizedState(stage.state) === 'success'
                  ? 'bg-green-500/50'
                  : normalizedState(stage.state) === 'running'
                    ? 'bg-linear-to-b from-blue-400/50 to-(--border-color)'
                    : 'bg-(--border-color)'
              "
              aria-hidden="true"
            />

            <span class="relative shrink-0">
              <span
                v-if="normalizedState(stage.state) === 'success'"
                class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-green-500 bg-green-500/20"
              >
                <i class="ri-check-line text-sm text-green-500" aria-hidden="true" />
              </span>
              <span
                v-else-if="normalizedState(stage.state) === 'running'"
                class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-blue-400 bg-blue-500/20"
              >
                <i
                  class="ri-loader-4-line animate-spin text-sm text-blue-400"
                  aria-hidden="true"
                />
              </span>
              <span
                v-else-if="normalizedState(stage.state) === 'failed'"
                class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-red-500 bg-red-500/20"
              >
                <i class="ri-close-line text-sm text-red-500" aria-hidden="true" />
              </span>
              <span
                v-else-if="normalizedState(stage.state) === 'incomplete'"
                class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/20"
              >
                <i
                  class="ri-indeterminate-circle-fill text-sm text-amber-500"
                  aria-hidden="true"
                />
              </span>
              <span
                v-else
                class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-(--border-color) bg-(--bg-secondary)"
              >
                <i :class="stage.icon" class="text-[10px] text-(--text-secondary)" />
              </span>
            </span>

            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center gap-2">
                <strong
                  class="truncate text-[12px]"
                  :class="stageLabelClass(stage.state)"
                >
                  {{ stage.label }}
                </strong>
                <span
                  v-if="normalizedState(stage.state) === 'running'"
                  class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
                  aria-hidden="true"
                />
              </span>
              <span
                v-if="
                  normalizedState(stage.state) === 'success' &&
                  (stage.runtime || stage['peak memory (mb)'])
                "
                class="flex items-center gap-3 text-[10px] text-(--text-secondary)"
              >
                <span v-if="stage['peak memory (mb)']">
                  <i class="ri-ram-line" aria-hidden="true" />
                  {{ stage['peak memory (mb)'].toFixed(1) }} MB
                </span>
                <span v-if="stage.runtime">
                  <i class="ri-time-line" aria-hidden="true" />
                  {{ stage.runtime }}
                </span>
              </span>
            </span>

            <i
              class="ri-arrow-right-s-line shrink-0 text-(--text-secondary) opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </router-link>
        </div>
      </div>

      <footer
        v-if="isHomeStage"
        class="border-t border-(--border-color) bg-(--bg-secondary)/30 p-3"
      >
        <div class="frontend-run-control">
          <span class="frontend-run-status" aria-label="Frontend flow result">
            <span class="status-dot" :class="flowResult === 'success' && 'is-success'" />
            <span class="status-dot" :class="flowResult === 'failed' && 'is-failed'" />
          </span>

          <div class="frontend-run-mode" @click.stop>
            <button
              type="button"
              class="frontend-run-mode__trigger"
              :disabled="flowRunControlBusy"
              @click="showModeMenu = !showModeMenu"
            >
              <i :class="runModes[activeRunMode].icon" aria-hidden="true" />
              <span>{{ runModes[activeRunMode].label }}</span>
              <i
                class="ri-arrow-down-s-line ml-auto transition-transform"
                :class="showModeMenu && 'rotate-180'"
                aria-hidden="true"
              />
            </button>

            <Transition name="mode-menu">
              <div v-if="showModeMenu" class="frontend-run-mode__menu">
                <button
                  v-for="(mode, key) in runModes"
                  :key="key"
                  type="button"
                  class="frontend-run-mode__item"
                  :class="activeRunMode === key && 'is-active'"
                  @click="handleRunModeSelect(key)"
                >
                  <i :class="mode.icon" aria-hidden="true" />
                  <span>{{ mode.label }}</span>
                </button>
              </div>
            </Transition>
          </div>

          <button
            type="button"
            class="frontend-run-button"
            :class="flowRunControlBusy && 'is-running'"
            :disabled="flowRunControlBusy"
            :title="runModes[activeRunMode].label"
            @click="handleRunFlow"
          >
            <i
              :class="
                flowRunControlBusy
                  ? 'ri-loader-4-line animate-spin'
                  : runModes[activeRunMode].icon
              "
              aria-hidden="true"
            />
          </button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useFlowRunMode } from '@/composables/useFlowRunMode'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useFlowStages, type FlowStage } from '@/composables/useFlowStages'
import { useWorkspace } from '@/composables/useWorkspace'

type FrontendSidebarStage = FlowStage & { virtual?: boolean }
type DisplayState = 'success' | 'running' | 'failed' | 'incomplete' | 'pending'

const route = useRoute()
const { currentStage } = useCurrentStage()
const { flowStages, hasOngoingRunStage, refreshFlowStages, setFirstRunStepOngoing } =
  useFlowStages()
const { isRunning, runAllFlow } = useFlowRunner()
const { ensureApiReady } = useWorkspace()
const fullFlowLabel = computed(() => 'Frontend Flow')
const { activeRunMode, isRerun, runModes, selectRunMode } = useFlowRunMode(currentStage, {
  fullFlowLabel,
})

const runStages = computed(() =>
  flowStages.value.filter((stage) => stage.group === 'run'),
)
const sidebarStages = computed<FrontendSidebarStage[]>(() => {
  const stages = flowStages.value
    .filter((stage) => stage.path !== 'configure' && stage.path !== 'tech')
    .map((stage) => (stage.path === 'home' ? { ...stage, label: 'Home' } : stage))

  const srcStage = virtualStage('Src', 'src', 'ri-code-s-slash-line')
  const waveStage = virtualStage('Wave', 'wave', 'ri-pulse-line')
  const prepareIndex = stages.findIndex((stage) => stage.path.toLowerCase() === 'prepare')
  const srcIndex = prepareIndex >= 0 ? prepareIndex + 1 : Math.min(1, stages.length)
  const withSrc = [...stages.slice(0, srcIndex), srcStage, ...stages.slice(srcIndex)]
  const simIndex = withSrc.findIndex((stage) => stage.path.toLowerCase() === 'sim')
  const waveIndex = simIndex >= 0 ? simIndex + 1 : withSrc.length
  return [...withSrc.slice(0, waveIndex), waveStage, ...withSrc.slice(waveIndex)]
})

const isHomeStage = computed(() => currentStage.value === 'home')
const isExpandedFrontendView = computed(() =>
  ['src', 'wave'].includes(currentStage.value.toLowerCase()),
)
const showWorkspaceProgressPanel = computed(() => !isExpandedFrontendView.value)
const flowRunControlBusy = computed(() => isRunning.value || hasOngoingRunStage.value)
const showModeMenu = ref(false)

const flowStats = computed(() => {
  const states = runStages.value.map((stage) => normalizedState(stage.state))
  return {
    total: states.length,
    success: states.filter((state) => state === 'success').length,
    ongoing: states.filter((state) => state === 'running').length,
    failed: states.filter((state) => state === 'failed' || state === 'incomplete').length,
    pending: states.filter((state) => state === 'pending').length,
  }
})
const flowProgressPercent = computed(() =>
  flowStats.value.total === 0
    ? 0
    : (flowStats.value.success / flowStats.value.total) * 100,
)
const flowResult = computed(() => {
  if (flowStats.value.total === 0) return 'none'
  if (flowStats.value.failed > 0) return 'failed'
  if (flowStats.value.success === flowStats.value.total) return 'success'
  if (flowStats.value.ongoing > 0) return 'running'
  return 'none'
})

function virtualStage(label: string, path: string, icon: string): FrontendSidebarStage {
  return {
    label,
    path,
    icon,
    group: 'run',
    tool: '',
    state: '',
    runtime: '',
    'peak memory (mb)': 0,
    virtual: true,
  }
}

function workspaceStageLink(stagePath: string) {
  return { path: `/workspace/${stagePath}`, query: route.query }
}

function normalizedState(state: string): DisplayState {
  switch (state.trim().toLowerCase()) {
    case 'success':
    case 'completed':
      return 'success'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'invalid':
    case 'failed':
      return 'failed'
    case 'incomplete':
      return 'incomplete'
    default:
      return 'pending'
  }
}

function stageLabelClass(state: string): string {
  switch (normalizedState(state)) {
    case 'success':
      return 'text-green-500'
    case 'running':
      return 'text-blue-400'
    case 'failed':
      return 'text-red-500'
    case 'incomplete':
      return 'text-amber-500'
    default:
      return 'text-(--text-primary)'
  }
}

function closeModeMenu(): void {
  showModeMenu.value = false
}

function handleRunModeSelect(mode: string): void {
  selectRunMode(mode)
  closeModeMenu()
}

async function handleRunFlow(): Promise<void> {
  closeModeMenu()
  if (flowRunControlBusy.value || !isHomeStage.value) return
  if (!(await ensureApiReady())) {
    await refreshFlowStages()
    return
  }

  setFirstRunStepOngoing()
  await runAllFlow({ rerun: isRerun.value })
  await refreshFlowStages()
}

onMounted(() => document.addEventListener('click', closeModeMenu))
onUnmounted(() => document.removeEventListener('click', closeModeMenu))
</script>

<style scoped>
.frontend-run-control {
  align-items: center;
  display: flex;
  gap: 6px;
}

.frontend-run-status {
  display: flex;
  gap: 4px;
}

.status-dot {
  border: 1.5px solid #64748b;
  border-radius: 50%;
  height: 8px;
  opacity: 0.35;
  width: 8px;
}

.status-dot:first-child {
  border-color: #10b981;
}

.status-dot:last-child {
  border-color: #ef4444;
}

.status-dot.is-success {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
  opacity: 1;
}

.status-dot.is-failed {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
  opacity: 1;
}

.frontend-run-mode {
  flex: 1;
  min-width: 0;
  position: relative;
}

.frontend-run-mode__trigger,
.frontend-run-mode__item {
  align-items: center;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  display: flex;
  font-size: 11px;
  gap: 6px;
  width: 100%;
}

.frontend-run-mode__trigger {
  background: var(--bg-secondary);
  border-radius: 6px;
  font-weight: 600;
  padding: 5px 8px;
}

.frontend-run-mode__trigger:disabled,
.frontend-run-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.frontend-run-mode__menu {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  bottom: calc(100% + 4px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  left: 0;
  padding: 4px;
  position: absolute;
  right: 0;
  z-index: 50;
}

.frontend-run-mode__item {
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 6px 8px;
}

.frontend-run-mode__item:hover {
  background: var(--bg-primary);
}

.frontend-run-mode__item.is-active {
  background: var(--accent-color);
  color: #fff;
}

.frontend-run-button {
  align-items: center;
  background: var(--accent-color);
  border: 0;
  border-radius: 6px;
  color: #fff;
  display: flex;
  height: 30px;
  justify-content: center;
  width: 30px;
}

.frontend-run-button:hover:not(:disabled) {
  opacity: 0.85;
}

.mode-menu-enter-active,
.mode-menu-leave-active {
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}

.mode-menu-enter-from,
.mode-menu-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}
</style>
