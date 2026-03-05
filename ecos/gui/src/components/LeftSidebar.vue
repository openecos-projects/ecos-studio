<template>
  <div class="flex h-full">
    <!-- 第一栏：流程步骤导航  -->
    <div
      class="w-[64px] shrink-0 bg-(--bg-sidebar) border-r border-(--border-color) flex flex-col justify-between py-3 overflow-y-auto">
      <div class="overflow-y-auto">
        <router-link v-for="stage in flowStages" :key="stage.path" :to="'/workspace/' + stage.path"
          class="flex flex-col items-center justify-center py-4 transition-all group relative mb-1" :class="[
            currentStage === stage.path ? 'text-(--accent-color)' : 'text-(--text-secondary)',
          ]">
          <!-- 选中状态的指示条 -->
          <div v-if="currentStage === stage.path"
            class="absolute left-0 top-2 bottom-2 w-1 bg-(--accent-color) rounded-r-full shadow-[0_0_10px_var(--accent-color)]">
          </div>

          <!-- 图标容器 -->
          <div class="relative transition-transform group-hover:-translate-y-0.5">
            <i :class="stage.icon" class="text-xl mb-1.5 inline-block"></i>

            <!-- 状态指示点 -->
            <i v-if="stage.state === 'Success'"
              class="ri-checkbox-circle-fill absolute -top-1 -right-1 text-[10px] text-green-500 bg-(--bg-sidebar) rounded-full"></i>
            <i v-else-if="stage.state === 'Ongoing'"
              class="ri-loader-4-line absolute -top-1 -right-1 text-[10px] text-blue-400 bg-(--bg-sidebar) rounded-full animate-spin"></i>
            <i v-else-if="stage.state === 'Pending'"
              class="ri-time-line absolute -top-1 -right-1 text-[10px] text-(--text-secondary) bg-(--bg-sidebar) rounded-full"></i>
            <i v-else-if="stage.state === 'Invalid'"
              class="ri-error-warning-fill absolute -top-1 -right-1 text-[10px] text-red-500 bg-(--bg-sidebar) rounded-full"></i>
            <i v-else-if="stage.state === 'Incomplete'"
              class="ri-indeterminate-circle-fill absolute -top-1 -right-1 text-[10px] text-amber-500 bg-(--bg-sidebar) rounded-full"></i>
          </div>

          <span class="text-[9px] font-bold text-center leading-tight uppercase tracking-tighter scale-90">
            {{ stage.label }}
          </span>
        </router-link>
      </div>
      <button @click="toggleTheme" class="p-2 text-(--text-secondary) hover:text-(--text-primary) transition-colors"
        title="Toggle theme">
        <i :class="isDark ? 'ri-sun-line' : 'ri-moon-line'" class="text-lg"></i>
      </button>
    </div>

    <!-- 第二栏：流程进度面板 (Configure 页面不显示) -->
    <div v-if="showProgressPanel"
      class="w-[240px] min-w-[200px] max-w-[300px] bg-(--bg-primary) border-r border-(--border-color) flex flex-col overflow-hidden shrink-0">

      <!-- ========== Home 概览面板 ========== -->
      <template v-if="showOverviewPanel">
        <!-- 顶部标题栏 -->
        <div class="px-4 py-3 border-b border-(--border-color)">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-(--accent-color)/20 flex items-center justify-center">
              <i class="ri-flow-chart text-(--accent-color) text-lg"></i>
            </div>
            <div>
              <h3 class="text-[13px] font-bold text-(--text-primary)">Flow Overview</h3>
              <p class="text-[10px] text-(--text-secondary)">RTL to GDS Pipeline</p>
            </div>
          </div>
        </div>

        <!-- 状态统计卡片 -->
        <div class="px-4 py-3 border-b border-(--border-color) bg-(--bg-secondary)/30">
          <div class="grid grid-cols-4 gap-2">
            <!-- 成功 -->
            <div
              class="flex flex-col items-center p-2 rounded-lg bg-green-500/10 cursor-pointer hover:bg-green-500/20 transition-colors">
              <span class="text-[14px] font-bold text-green-500">{{ flowStats.success }}</span>
              <span class="text-[8px] text-green-500/80 uppercase tracking-wider">Done</span>
            </div>
            <!-- 进行中 -->
            <div
              class="flex flex-col items-center p-2 rounded-lg bg-blue-500/10 cursor-pointer hover:bg-blue-500/20 transition-colors">
              <span class="text-[14px] font-bold text-blue-400">{{ flowStats.ongoing }}</span>
              <span class="text-[8px] text-blue-400/80 uppercase tracking-wider">Run</span>
            </div>
            <!-- 失败 -->
            <div
              class="flex flex-col items-center p-2 rounded-lg bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors">
              <span class="text-[14px] font-bold text-red-500">{{ flowStats.failed }}</span>
              <span class="text-[8px] text-red-500/80 uppercase tracking-wider">Fail</span>
            </div>
            <!-- 待处理 -->
            <div
              class="flex flex-col items-center p-2 rounded-lg bg-(--bg-secondary) cursor-pointer hover:bg-(--border-color)/50 transition-colors">
              <span class="text-[14px] font-bold text-(--text-secondary)">{{ flowStats.pending }}</span>
              <span class="text-[8px] text-(--text-secondary)/80 uppercase tracking-wider">Wait</span>
            </div>
          </div>

          <!-- 总进度条 -->
          <div class="mt-3">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] text-(--text-secondary) uppercase tracking-wider">Total Progress</span>
              <span class="text-[11px] font-bold text-(--accent-color)">{{ flowStats.success }}/{{ flowStats.total
                }}</span>
            </div>
            <div class="h-1.5 bg-(--bg-secondary) rounded-full overflow-hidden">
              <div class="h-full bg-(--accent-color) rounded-full transition-all duration-500"
                :style="{ width: `${flowProgressPercent}%` }"></div>
            </div>
          </div>
        </div>

        <!-- 步骤列表 -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="runStages.length === 0" class="flex items-center justify-center h-full">
            <div class="text-center px-4">
              <i class="ri-file-list-3-line text-3xl text-(--text-secondary) opacity-50"></i>
              <p class="text-[11px] text-(--text-secondary) mt-2">No flow data available</p>
              <p class="text-[10px] text-(--text-secondary) opacity-70 mt-1">Load a project to see the flow</p>
            </div>
          </div>

          <div v-else class="p-3 space-y-1">
            <router-link v-for="(stage, index) in runStages" :key="stage.path" :to="'/workspace/' + stage.path"
              class="group relative flex items-center gap-3 p-2 rounded-lg transition-all hover:bg-(--bg-secondary)/50 cursor-pointer"
              :class="{ 'bg-(--bg-secondary)/30': stage.state === 'Ongoing' }">
              <!-- 连接线 -->
              <div v-if="index < runStages.length - 1" class="absolute left-[22px] top-[42px] w-0.5 h-[calc(100%-34px)]"
                :class="[
                  stage.state === 'Success' ? 'bg-green-500/50' :
                    stage.state === 'Ongoing' ? 'bg-linear-to-b from-blue-400/50 to-(--border-color)' :
                      'bg-(--border-color)'
                ]"></div>

              <!-- 状态图标 -->
              <div class="relative shrink-0">
                <!-- 成功 -->
                <div v-if="stage.state === 'Success'"
                  class="w-[30px] h-[30px] rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
                  <i class="ri-check-line text-green-500 text-sm"></i>
                </div>
                <!-- 进行中 -->
                <div v-else-if="stage.state === 'Ongoing'"
                  class="w-[30px] h-[30px] rounded-full bg-blue-500/20 border-2 border-blue-400 flex items-center justify-center">
                  <i class="ri-loader-4-line text-blue-400 text-sm animate-spin"></i>
                </div>
                <!-- 失败/无效 -->
                <div v-else-if="stage.state === 'Invalid'"
                  class="w-[30px] h-[30px] rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
                  <i class="ri-close-line text-red-500 text-sm"></i>
                </div>
                <!-- 未完成 -->
                <div v-else-if="stage.state === 'Incomplete'"
                  class="w-[30px] h-[30px] rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center">
                  <i class="ri-indeterminate-circle-fill text-amber-500 text-sm"></i>
                </div>
                <!-- 待处理 -->
                <div v-else
                  class="w-[30px] h-[30px] rounded-full bg-(--bg-secondary) border-2 border-(--border-color) flex items-center justify-center">
                  <i :class="stage.icon" class="text-[10px] text-(--text-secondary)"></i>
                </div>
              </div>

              <!-- 步骤信息 -->
              <div class="flex-1 min-w-0 h-full flex flex-col justify-center gap-0.5">
                <div class="flex items-center gap-2">
                  <span class="text-[12px] font-semibold truncate" :class="[
                    stage.state === 'Success' ? 'text-green-500' :
                      stage.state === 'Ongoing' ? 'text-blue-400' :
                        stage.state === 'Invalid' ? 'text-red-500' :
                          stage.state === 'Incomplete' ? 'text-amber-500' :
                            'text-(--text-primary)'
                  ]">
                    {{ stage.label }}
                  </span>
                  <!-- 运行中的脉冲动画 -->
                  <span v-if="stage.state === 'Ongoing'"
                    class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                </div>
                <!-- 运行时信息：内存 & 耗时 -->
                <div
                  v-if="stage.state === 'Success' && (stage.runtime || stage['peak memory (mb)'])"
                  class="flex items-center gap-3 text-[10px] text-(--text-secondary) leading-tight">
                  <span v-if="stage['peak memory (mb)']" class="flex items-center gap-1">
                    <i class="ri-ram-line text-[10px]"></i>
                    {{ stage['peak memory (mb)'].toFixed(1) }} MB
                  </span>
                  <span v-if="stage.runtime" class="flex items-center gap-1">
                    <i class="ri-time-line text-[10px]"></i>
                    {{ stage.runtime }}
                  </span>
                </div>
              </div>

              <!-- 箭头 -->
              <i
                class="ri-arrow-right-s-line text-(--text-secondary) opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-sm"></i>
            </router-link>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="p-3 border-t border-(--border-color) bg-(--bg-secondary)/30 space-y-2">
          <!-- SSE 消息显示区域 -->
          <!-- <div v-if="sseMessages.length > 0"
            class="max-h-32 overflow-y-auto bg-(--bg-secondary) rounded p-2 text-[10px] space-y-1">
            <div v-for="(msg, idx) in sseMessages.slice(-5)" :key="idx" class="flex items-center gap-1" :class="{
              'text-blue-400': msg.data?.type === 'step_start',
              'text-green-500': msg.data?.type === 'step_complete' || msg.data?.type === 'task_complete',
              'text-amber-500': msg.data?.type === 'data_ready',
              'text-red-500': msg.data?.type === 'error',
              'text-(--text-secondary)': msg.data?.type === 'message'
            }">
              <i :class="{
                'ri-play-circle-line': msg.data?.type === 'step_start',
                'ri-checkbox-circle-line': msg.data?.type === 'step_complete',
                'ri-trophy-line': msg.data?.type === 'task_complete',
                'ri-database-2-line': msg.data?.type === 'data_ready',
                'ri-error-warning-line': msg.data?.type === 'error',
                'ri-chat-1-line': msg.data?.type === 'message'
              }" class="text-xs"></i>
              <span class="truncate">
                {{ msg.data?.step || msg.message?.[0] || msg.data?.type }}
                <span v-if="msg.data?.id" class="opacity-70">({{ msg.data.id }})</span>
              </span>
            </div>
          </div> -->

          <!-- RTL2GDS 控制区 -->
          <div class="rtl2gds-control">
            <!-- 状态指示灯 -->
            <div class="rtl2gds-status-dots">
              <span class="status-dot"
                :class="flowResult === 'success' ? 'dot-success-active' : 'dot-success-dim'"></span>
              <span class="status-dot" :class="flowResult === 'failed' ? 'dot-failed-active' : 'dot-failed-dim'"></span>
            </div>

            <!-- 模式选择器（Cursor 风格下拉） -->
            <div class="mode-selector" @click.stop>
              <!-- 当前模式显示 + 触发器 -->
              <button class="mode-trigger" @click="showModeMenu = !showModeMenu" :disabled="isRunning">
                <i :class="runModes[runMode].icon" class="mode-trigger-icon"></i>
                <span>{{ runModes[runMode].label }}</span>
                <i class="ri-arrow-down-s-line mode-chevron" :class="{ open: showModeMenu }"></i>
              </button>

              <!-- 下拉菜单 -->
              <Transition name="mode-menu">
                <div v-if="showModeMenu" class="mode-menu">
                  <button v-for="(mode, key) in runModes" :key="key" class="mode-menu-item"
                    :class="{ active: runMode === key }" @click="runMode = key as string; showModeMenu = false">
                    <i :class="mode.icon" class="mode-item-icon"></i>
                    <span class="mode-item-label">{{ mode.label }}</span>
                    <span v-if="mode.shortcut" class="mode-item-shortcut">{{ mode.shortcut }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <!-- 执行按钮 -->
            <button @click="handleRunFlow" :disabled="isRunning" class="run-go-btn" :class="{ running: isRunning }">
              <i :class="isRunning ? 'ri-loader-4-line animate-spin' : 'ri-play-fill'"></i>
            </button>
          </div>
        </div>
      </template>

      <!-- ========== 子流程面板 ========== -->
      <template v-else-if="showSubflowPanel">
        <!-- 顶部标题栏 -->
        <div class="px-4 py-3 border-b border-(--border-color)">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-(--accent-color)/20 flex items-center justify-center">
              <i class="ri-focus-2-line text-(--accent-color) text-lg"></i>
            </div>
            <div>
              <h3 class="text-[13px] font-bold text-(--text-primary)">{{ currentStepTitle }}</h3>
              <p class="text-[10px] text-(--text-secondary)">{{ currentStepEngine }}</p>
            </div>
          </div>
        </div>

        <!-- 进度统计 -->
        <div class="px-4 py-3 border-b border-(--border-color) bg-(--bg-secondary)/30">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] text-(--text-secondary) uppercase tracking-wider">Progress</span>
            <span class="text-[11px] font-bold text-(--accent-color)">{{ completedSteps }}/{{ totalSteps || 0
              }}</span>
          </div>
          <div class="h-1.5 bg-(--bg-secondary) rounded-full overflow-hidden">
            <div class="h-full bg-(--accent-color) rounded-full transition-all duration-500"
              :style="{ width: `${progressPercent}%` }"></div>
          </div>
          <div class="flex items-center justify-between mt-2 text-[9px] text-(--text-secondary)">
            <span>Total: {{ totalTime }}</span>
            <span
              :class="overallStatus === 'completed' ? 'text-green-500' : overallStatus === 'running' ? 'text-blue-400' : 'text-(--text-secondary)'">
              {{ overallStatus === 'completed' ? 'Completed' : overallStatus === 'running' ? 'Running...' : 'Ready' }}
            </span>
          </div>
        </div>

        <!-- 步骤列表 -->
        <div class="flex-1 overflow-y-auto">
          <!-- 加载状态 -->
          <div v-if="isLoadingSubflow" class="flex items-center justify-center h-full">
            <div class="text-center">
              <i class="ri-loader-4-line text-2xl text-(--accent-color) animate-spin"></i>
              <p class="text-[11px] text-(--text-secondary) mt-2">Loading subflow...</p>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-else-if="subflowSteps.length === 0" class="flex items-center justify-center h-full">
            <div class="text-center px-4">
              <i class="ri-file-list-3-line text-3xl text-(--text-secondary) opacity-50"></i>
              <p class="text-[11px] text-(--text-secondary) mt-2">No subflow data available</p>
              <p class="text-[10px] text-(--text-secondary) opacity-70 mt-1">Run the step to generate subflow</p>
            </div>
          </div>

          <!-- 步骤列表 -->
          <div v-else class="p-3 space-y-1">
            <div v-for="(step, index) in subflowSteps" :key="step.id" class="group relative"
              :class="{ 'opacity-50': step.status === 'pending' && index > 0 && subflowSteps[index - 1].status === 'pending' }">
              <!-- 连接线：从圆形底部到下一个圆形顶部 -->
              <div v-if="index < subflowSteps.length - 1"
                class="absolute left-[22px] top-[42px] w-0.5 h-[calc(100%-34px)]" :class="[
                  step.status === 'completed' ? 'bg-green-500/50' :
                    step.status === 'running' ? 'bg-linear-to-b from-blue-400/50 to-(--border-color)' :
                      'bg-(--border-color)'
                ]"></div>

              <!-- 步骤项 -->
              <div
                class="flex items-start gap-3 p-2 rounded-lg transition-all hover:bg-(--bg-secondary)/50 cursor-pointer"
                :class="{ 'bg-(--bg-secondary)/30': step.status === 'running' }">
                <!-- 状态图标 -->
                <div class="relative shrink-0 mt-0.5">
                  <!-- 完成状态 -->
                  <div v-if="step.status === 'completed'"
                    class="w-[30px] h-[30px] rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
                    <i class="ri-check-line text-green-500 text-sm"></i>
                  </div>
                  <!-- 运行状态 -->
                  <div v-else-if="step.status === 'running'"
                    class="w-[30px] h-[30px] rounded-full bg-blue-500/20 border-2 border-blue-400 flex items-center justify-center">
                    <i class="ri-loader-4-line text-blue-400 text-sm animate-spin"></i>
                  </div>
                  <!-- 失败状态 -->
                  <div v-else-if="step.status === 'failed'"
                    class="w-[30px] h-[30px] rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
                    <i class="ri-close-line text-red-500 text-sm"></i>
                  </div>
                  <!-- 等待状态 -->
                  <div v-else
                    class="w-[30px] h-[30px] rounded-full bg-(--bg-secondary) border-2 border-(--border-color) flex items-center justify-center">
                    <span class="text-[10px] font-bold text-(--text-secondary)">{{ index + 1 }}</span>
                  </div>
                </div>

                <!-- 步骤信息 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-semibold truncate" :class="[
                      step.status === 'completed' ? 'text-green-500' :
                        step.status === 'running' ? 'text-blue-400' :
                          step.status === 'failed' ? 'text-red-500' :
                            'text-(--text-primary)'
                    ]">
                      {{ step.name }}
                    </span>
                    <!-- 运行中的脉冲动画 -->
                    <span v-if="step.status === 'running'"
                      class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                  </div>
                  <p class="text-[10px] text-(--text-secondary) mt-0.5 truncate">{{ step.description }}</p>
                  <!-- 耗时显示 -->
                  <div v-if="step.duration || step.status === 'running'" class="flex items-center gap-2 mt-1">
                    <i class="ri-time-line text-[10px] text-(--text-secondary)"></i>
                    <span class="text-[10px]"
                      :class="step.status === 'running' ? 'text-blue-400' : 'text-(--text-secondary)'">
                      {{ step.duration || 'calculating...' }}
                    </span>
                  </div>
                </div>

                <!-- 展开箭头 -->
                <i
                  class="ri-arrow-right-s-line text-(--text-secondary) opacity-0 group-hover:opacity-100 transition-opacity shrink-0"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="p-3 border-t border-(--border-color) bg-(--bg-secondary)/30 space-y-2">
          <!-- 操作按钮组 -->
          <div class="flex gap-2">
            <button @click="handleRunFlow" :disabled="isRunning"
              class="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-(--accent-color) text-white text-[11px] font-bold rounded hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 shadow-lg shadow-(--accent-color)/20">
              <i :class="isRunning ? 'ri-loader-4-line animate-spin' : 'ri-play-fill'"></i>
              {{ isRunning ? 'RUNNING' : 'RUN' }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useThemeStore } from '@/stores/themeStore'
import { useFlowStages } from '@/composables/useFlowStages'
import { useSubflow } from '@/composables/useSubflow'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useCurrentStage } from '@/composables/useCurrentStage'
// import { useWorkspace } from '@/composables/useWorkspace'

// ============ Composables ============

const themeStore = useThemeStore()

// 流程阶段管理
const { flowStages, refreshFlowStages, setFirstRunStepOngoing } = useFlowStages()

// 子流程管理
const {
  subflowSteps,
  isLoading: isLoadingSubflow,
  currentStepTitle,
  currentStepEngine,
  completedSteps,
  progressPercent,
  totalTime,
  overallStatus,
  totalSteps,
  refreshCurrentSubflow
} = useSubflow()

// 流程运行器
const {
  isRunning,
  runFlow,
  runAllFlow,
} = useFlowRunner()

// Workspace SSE 消息
// const { sseMessages } = useWorkspace()

// 当前阶段
const { currentStage, showProgressPanel, showOverviewPanel, showSubflowPanel } = useCurrentStage()

// ============ Flow 概览计算 ============
// 只统计 run 组的步骤
const runStages = computed(() => flowStages.value.filter(s => s.group === 'run'))

const flowStats = computed(() => {
  const stages = runStages.value
  return {
    total: stages.length,
    success: stages.filter(s => s.state === 'Success').length,
    ongoing: stages.filter(s => s.state === 'Ongoing').length,
    failed: stages.filter(s => s.state === 'Invalid' || s.state === 'Incomplete').length,
    pending: stages.filter(s => s.state === 'Pending' || s.state === 'Unstart' || !s.state).length
  }
})

const flowProgressPercent = computed(() => {
  if (flowStats.value.total === 0) return 0
  return (flowStats.value.success / flowStats.value.total) * 100
})

// RTL2GDS 结果状态：从 flowRunner 的 state 推断
const flowResult = computed(() => {
  if (flowStats.value.total === 0) return 'none'
  if (flowStats.value.failed > 0) return 'failed'
  if (flowStats.value.success === flowStats.value.total) return 'success'
  if (flowStats.value.ongoing > 0) return 'running'
  return 'none'
})

// ============ 主题相关 ============
const isDark = computed(() => themeStore.themeName === 'dark')

const toggleTheme = () => {
  themeStore.toggleTheme()
}

// ============ 运行模式 ============
const runMode = ref('run')
const showModeMenu = ref(false)

const runModes: Record<string, { label: string; icon: string; shortcut?: string }> = {
  run: { label: 'Run RTL2GDS', icon: 'ri-play-fill' },
  rerun: { label: 'ReRun', icon: 'ri-restart-line' },
}

// 点击外部关闭菜单
const closeMenu = () => { showModeMenu.value = false }
onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))

// ============ 事件处理 ============
const handleRunFlow = async () => {
  closeMenu()
  if (currentStage.value === 'home') {
    // 乐观更新：立即将第一个待运行步骤显示为 Ongoing
    setFirstRunStepOngoing()
    await runAllFlow()
    // Home 面板刷新 flow.json 派生的总流程状态
    await refreshFlowStages()
  } else {
    await runFlow()
    // 子流程页同步刷新子流程与侧栏总流程状态
    await Promise.all([
      refreshCurrentSubflow(),
      refreshFlowStages()
    ])
  }
}
</script>

<style scoped>
/* 自定义滚动条 - 更细的样式 */
::-webkit-scrollbar {
  width: 3px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* ====== RTL2GDS 控制区 ====== */
.rtl2gds-control {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
}

/* 状态指示灯 */
.rtl2gds-status-dots {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.dot-success-active {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
}

.dot-success-dim {
  background: transparent;
  border: 1.5px solid #10b981;
  opacity: 0.35;
}

.dot-failed-active {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
}

.dot-failed-dim {
  background: transparent;
  border: 1.5px solid #ef4444;
  opacity: 0.35;
}

/* ====== 模式选择器（Cursor 风格） ====== */
.mode-selector {
  position: relative;
  flex: 1;
  min-width: 0;
}

.mode-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-trigger:hover:not(:disabled) {
  border-color: var(--text-secondary);
}

.mode-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-trigger-icon {
  font-size: 12px;
  color: var(--text-secondary);
}

.mode-chevron {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
}

.mode-chevron.open {
  transform: rotate(180deg);
}

/* 下拉菜单 */
.mode-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px;
  z-index: 50;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.mode-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s ease;
}

.mode-menu-item:hover {
  background: var(--bg-primary);
}

.mode-menu-item.active {
  background: var(--accent-color);
  color: #fff;
}

.mode-item-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.mode-item-label {
  flex: 1;
  text-align: left;
}

.mode-item-shortcut {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
}

.mode-menu-item.active .mode-item-shortcut {
  color: rgba(255, 255, 255, 0.6);
}

/* 菜单动画 */
.mode-menu-enter-active {
  transition: all 0.15s ease-out;
}

.mode-menu-leave-active {
  transition: all 0.1s ease-in;
}

.mode-menu-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

.mode-menu-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

/* ====== 执行按钮 ====== */
.run-go-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: var(--accent-color);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.run-go-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.run-go-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.run-go-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.run-go-btn.running {
  animation: pulse-btn 1.5s ease infinite;
}

@keyframes pulse-btn {

  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.8;
  }
}
</style>
