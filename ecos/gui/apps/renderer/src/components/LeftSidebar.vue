<template>
  <div class="flex h-full">
    <!-- 第一栏：流程步骤导航  -->
    <div
      class="flex w-[64px] shrink-0 flex-col justify-between overflow-y-auto border-r border-(--border-color) bg-(--bg-sidebar) py-3"
    >
      <div class="overflow-y-auto">
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
          <!-- 选中状态的指示条 -->
          <div
            v-if="currentStage === stage.path"
            class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-(--accent-color) shadow-[0_0_10px_var(--accent-color)]"
          ></div>

          <!-- 图标容器 -->
          <div class="relative transition-transform group-hover:-translate-y-0.5">
            <i :class="stage.icon" class="mb-1.5 inline-block text-xl"></i>

            <!-- 状态指示点 -->
            <i
              v-if="!stage.virtual && stage.state === 'Success'"
              class="ri-checkbox-circle-fill absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-green-500"
            ></i>
            <i
              v-else-if="!stage.virtual && stage.state === 'Ongoing'"
              class="ri-loader-4-line absolute -top-1 -right-1 animate-spin rounded-full bg-(--bg-sidebar) text-[10px] text-blue-400"
            ></i>
            <i
              v-else-if="!stage.virtual && stage.state === 'Pending'"
              class="ri-time-line absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-(--text-secondary)"
            ></i>
            <i
              v-else-if="!stage.virtual && stage.state === 'Invalid'"
              class="ri-error-warning-fill absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-red-500"
            ></i>
            <i
              v-else-if="!stage.virtual && stage.state === 'Incomplete'"
              class="ri-indeterminate-circle-fill absolute -top-1 -right-1 rounded-full bg-(--bg-sidebar) text-[10px] text-amber-500"
            ></i>
          </div>

          <span
            class="scale-90 text-center text-[9px] leading-tight font-bold tracking-tighter uppercase"
          >
            {{ stage.label }}
          </span>
        </router-link>
      </div>
    </div>

    <!-- 第二栏：流程进度面板 (Configure 页面不显示) -->
    <div
      v-if="showWorkspaceProgressPanel"
      class="flex w-[240px] max-w-[300px] min-w-[200px] shrink-0 flex-col overflow-hidden border-r border-(--border-color) bg-(--bg-primary)"
    >
      <!-- ========== Home 概览面板 ========== -->
      <template v-if="showFlowOverviewPanel">
        <!-- 顶部标题栏 -->
        <div class="border-b border-(--border-color) px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center">
              <i class="ri-flow-chart text-xl text-(--text-secondary)"></i>
            </div>
            <div>
              <h3 class="text-[14px] font-semibold tracking-wide text-(--text-primary)">
                {{ isFrontendProject ? 'Frontend Workspace' : 'Flow Overview' }}
              </h3>
              <p class="mt-0.5 text-[11px] text-(--text-secondary)">
                {{
                  isFrontendProject ? 'Frontend Verification Flow' : 'RTL to GDS Pipeline'
                }}
              </p>
            </div>
          </div>
        </div>

        <!-- 状态统计卡片 -->
        <div class="border-b border-(--border-color) bg-(--bg-secondary)/30 px-4 py-3">
          <div class="grid grid-cols-4 gap-2">
            <!-- 成功 -->
            <div
              class="flex cursor-pointer flex-col items-center rounded-lg bg-green-500/10 p-2 transition-colors hover:bg-green-500/20"
            >
              <span class="text-[14px] font-bold text-green-500">{{
                flowStats.success
              }}</span>
              <span class="text-[8px] tracking-wider text-green-500/80 uppercase"
                >Done</span
              >
            </div>
            <!-- 进行中 -->
            <div
              class="flex cursor-pointer flex-col items-center rounded-lg bg-blue-500/10 p-2 transition-colors hover:bg-blue-500/20"
            >
              <span class="text-[14px] font-bold text-blue-400">{{
                flowStats.ongoing
              }}</span>
              <span class="text-[8px] tracking-wider text-blue-400/80 uppercase"
                >Run</span
              >
            </div>
            <!-- 失败 -->
            <div
              class="flex cursor-pointer flex-col items-center rounded-lg bg-red-500/10 p-2 transition-colors hover:bg-red-500/20"
            >
              <span class="text-[14px] font-bold text-red-500">{{
                flowStats.failed
              }}</span>
              <span class="text-[8px] tracking-wider text-red-500/80 uppercase"
                >Fail</span
              >
            </div>
            <!-- 待处理 -->
            <div
              class="flex cursor-pointer flex-col items-center rounded-lg bg-(--bg-secondary) p-2 transition-colors hover:bg-(--border-color)/50"
            >
              <span class="text-[14px] font-bold text-(--text-secondary)">{{
                flowStats.pending
              }}</span>
              <span class="text-[8px] tracking-wider text-(--text-secondary)/80 uppercase"
                >Wait</span
              >
            </div>
          </div>

          <!-- 总进度条 -->
          <div class="mt-3">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[10px] tracking-wider text-(--text-secondary) uppercase"
                >Total Progress</span
              >
              <span class="text-[11px] font-bold text-(--accent-color)"
                >{{ flowStats.success }}/{{ flowStats.total }}</span
              >
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-(--bg-secondary)">
              <div
                class="h-full rounded-full bg-(--accent-color) transition-all duration-500"
                :style="{ width: `${flowProgressPercent}%` }"
              ></div>
            </div>
          </div>
        </div>

        <!-- 步骤列表 -->
        <div class="flex-1 overflow-y-auto">
          <div
            v-if="runStages.length === 0"
            class="flex h-full items-center justify-center"
          >
            <div class="px-4 text-center">
              <i
                class="ri-file-list-3-line text-3xl text-(--text-secondary) opacity-50"
              ></i>
              <p class="mt-2 text-[11px] text-(--text-secondary)">
                No flow data available
              </p>
              <p class="mt-1 text-[10px] text-(--text-secondary) opacity-70">
                Load a project to see the flow
              </p>
            </div>
          </div>

          <div v-else class="space-y-1 p-3">
            <router-link
              v-for="(stage, index) in runStages"
              :key="stage.path"
              :to="workspaceStageLink(stage.path)"
              class="group relative flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-all hover:bg-(--bg-secondary)/50"
              :class="{
                'bg-(--bg-secondary)/30': stage.state === 'Ongoing',
                'bg-(--accent-color)/10': currentStage === stage.path,
              }"
            >
              <!-- 连接线 -->
              <div
                v-if="index < runStages.length - 1"
                class="absolute top-[42px] left-[22px] h-[calc(100%-34px)] w-0.5"
                :class="[
                  stage.state === 'Success'
                    ? 'bg-green-500/50'
                    : stage.state === 'Ongoing'
                      ? 'bg-linear-to-b from-blue-400/50 to-(--border-color)'
                      : 'bg-(--border-color)',
                ]"
              ></div>

              <!-- 状态图标 -->
              <div class="relative shrink-0">
                <!-- 成功 -->
                <div
                  v-if="stage.state === 'Success'"
                  class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-green-500 bg-green-500/20"
                >
                  <i class="ri-check-line text-sm text-green-500"></i>
                </div>
                <!-- 进行中 -->
                <div
                  v-else-if="stage.state === 'Ongoing'"
                  class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-blue-400 bg-blue-500/20"
                >
                  <i class="ri-loader-4-line animate-spin text-sm text-blue-400"></i>
                </div>
                <!-- 失败/无效 -->
                <div
                  v-else-if="stage.state === 'Invalid'"
                  class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-red-500 bg-red-500/20"
                >
                  <i class="ri-close-line text-sm text-red-500"></i>
                </div>
                <!-- 未完成 -->
                <div
                  v-else-if="stage.state === 'Incomplete'"
                  class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/20"
                >
                  <i class="ri-indeterminate-circle-fill text-sm text-amber-500"></i>
                </div>
                <!-- 待处理 -->
                <div
                  v-else
                  class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-(--border-color) bg-(--bg-secondary)"
                >
                  <i :class="stage.icon" class="text-[10px] text-(--text-secondary)"></i>
                </div>
              </div>

              <!-- 步骤信息 -->
              <div class="flex h-full min-w-0 flex-1 flex-col justify-center gap-0.5">
                <div class="flex items-center gap-2">
                  <span
                    class="truncate text-[12px] font-semibold"
                    :class="[
                      stage.state === 'Success'
                        ? 'text-green-500'
                        : stage.state === 'Ongoing'
                          ? 'text-blue-400'
                          : stage.state === 'Invalid'
                            ? 'text-red-500'
                            : stage.state === 'Incomplete'
                              ? 'text-amber-500'
                              : 'text-(--text-primary)',
                    ]"
                  >
                    {{ stage.label }}
                  </span>
                  <!-- 运行中的脉冲动画 -->
                  <span
                    v-if="stage.state === 'Ongoing'"
                    class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
                  ></span>
                </div>
                <!-- 运行时信息：内存 & 耗时 -->
                <div
                  v-if="
                    stage.state === 'Success' &&
                    (stage.runtime || stage['peak memory (mb)'])
                  "
                  class="flex items-center gap-3 text-[10px] leading-tight text-(--text-secondary)"
                >
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
                class="ri-arrow-right-s-line shrink-0 text-sm text-(--text-secondary) opacity-0 transition-opacity group-hover:opacity-100"
              ></i>
            </router-link>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div
          v-if="showOverviewRunControls"
          class="space-y-2 border-t border-(--border-color) bg-(--bg-secondary)/30 p-3"
        >
          <!-- Runtime event message display area -->
          <!-- <div v-if="runtimeEvents.length > 0"
            class="max-h-32 overflow-y-auto bg-(--bg-secondary) rounded p-2 text-[10px] space-y-1">
            <div v-for="(msg, idx) in runtimeEvents.slice(-5)" :key="idx" class="flex items-center gap-1" :class="{
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
              <span
                class="status-dot"
                :class="
                  flowResult === 'success' ? 'dot-success-active' : 'dot-success-dim'
                "
              ></span>
              <span
                class="status-dot"
                :class="flowResult === 'failed' ? 'dot-failed-active' : 'dot-failed-dim'"
              ></span>
            </div>

            <!-- 模式选择器（Cursor 风格下拉） -->
            <div class="mode-selector" @click.stop>
              <!-- 当前模式显示 + 触发器 -->
              <button
                class="mode-trigger"
                @click="showModeMenu = !showModeMenu"
                :disabled="flowRunControlBusy"
              >
                <i :class="runModes[activeRunMode].icon" class="mode-trigger-icon"></i>
                <span>{{ runModes[activeRunMode].label }}</span>
                <i
                  class="ri-arrow-down-s-line mode-chevron"
                  :class="{ open: showModeMenu }"
                ></i>
              </button>

              <!-- 下拉菜单 -->
              <Transition name="mode-menu">
                <div v-if="showModeMenu" class="mode-menu">
                  <button
                    v-for="(mode, key) in runModes"
                    :key="key"
                    class="mode-menu-item"
                    :class="{ active: activeRunMode === key }"
                    @click="handleRunModeSelect(key)"
                  >
                    <i :class="mode.icon" class="mode-item-icon"></i>
                    <span class="mode-item-label">{{ mode.label }}</span>
                    <span v-if="mode.shortcut" class="mode-item-shortcut">{{
                      mode.shortcut
                    }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <!-- 执行按钮 -->
            <button
              @click="handleRunFlow"
              :disabled="flowRunControlBusy"
              class="run-go-btn"
              :class="{ running: flowRunControlBusy }"
            >
              <i
                :class="
                  flowRunControlBusy ? 'ri-loader-4-line animate-spin' : 'ri-play-fill'
                "
              ></i>
            </button>
          </div>
        </div>
      </template>

      <!-- ========== 子流程面板 ========== -->
      <template v-else-if="showBackendSubflowPanel">
        <!-- 顶部标题栏 -->
        <div class="border-b border-(--border-color) px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center">
              <i class="ri-focus-2-line text-xl text-(--text-secondary)"></i>
            </div>
            <div>
              <h3 class="text-[14px] font-semibold tracking-wide text-(--text-primary)">
                {{ currentStepTitle }}
              </h3>
              <p class="mt-0.5 text-[11px] text-(--text-secondary)">
                {{ currentStepEngine }}
              </p>
            </div>
          </div>
        </div>

        <!-- 进度统计 -->
        <div class="border-b border-(--border-color) bg-(--bg-secondary)/30 px-4 py-3">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-[10px] tracking-wider text-(--text-secondary) uppercase"
              >Progress</span
            >
            <span class="text-[11px] font-bold text-(--accent-color)"
              >{{ completedSteps }}/{{ totalSteps || 0 }}</span
            >
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-(--bg-secondary)">
            <div
              class="h-full rounded-full bg-(--accent-color) transition-all duration-500"
              :style="{ width: `${progressPercent}%` }"
            ></div>
          </div>
          <div
            class="mt-2 flex items-center justify-between text-[9px] text-(--text-secondary)"
          >
            <span>Total: {{ totalTime }}</span>
            <span
              :class="
                overallStatus === 'completed'
                  ? 'text-green-500'
                  : overallStatus === 'running'
                    ? 'text-blue-400'
                    : 'text-(--text-secondary)'
              "
            >
              {{
                overallStatus === 'completed'
                  ? 'Completed'
                  : overallStatus === 'running'
                    ? 'Running...'
                    : 'Ready'
              }}
            </span>
          </div>
        </div>

        <!-- 步骤列表 -->
        <div class="flex-1 overflow-y-auto">
          <!-- 加载状态 -->
          <div v-if="isLoadingSubflow" class="flex h-full items-center justify-center">
            <div class="text-center">
              <i class="ri-loader-4-line animate-spin text-2xl text-(--accent-color)"></i>
              <p class="mt-2 text-[11px] text-(--text-secondary)">Loading subflow...</p>
            </div>
          </div>

          <!-- 空状态 -->
          <div
            v-else-if="subflowSteps.length === 0"
            class="flex h-full items-center justify-center"
          >
            <div class="px-4 text-center">
              <i
                class="ri-file-list-3-line text-3xl text-(--text-secondary) opacity-50"
              ></i>
              <p class="mt-2 text-[11px] text-(--text-secondary)">
                No subflow data available
              </p>
              <p class="mt-1 text-[10px] text-(--text-secondary) opacity-70">
                Run the step to generate subflow
              </p>
            </div>
          </div>

          <!-- 步骤列表 -->
          <div v-else class="space-y-1 p-3">
            <div
              v-for="(step, index) in subflowSteps"
              :key="step.id"
              class="group relative"
              :class="{
                'opacity-50':
                  step.status === 'pending' &&
                  index > 0 &&
                  subflowSteps[index - 1].status === 'pending',
              }"
            >
              <!-- 连接线：从圆形底部到下一个圆形顶部 -->
              <div
                v-if="index < subflowSteps.length - 1"
                class="absolute top-[42px] left-[22px] h-[calc(100%-34px)] w-0.5"
                :class="[
                  step.status === 'completed'
                    ? 'bg-green-500/50'
                    : step.status === 'running'
                      ? 'bg-linear-to-b from-blue-400/50 to-(--border-color)'
                      : 'bg-(--border-color)',
                ]"
              ></div>

              <!-- 步骤项 -->
              <div
                class="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-all hover:bg-(--bg-secondary)/50"
                :class="{ 'bg-(--bg-secondary)/30': step.status === 'running' }"
              >
                <!-- 状态图标 -->
                <div class="relative mt-0.5 shrink-0">
                  <!-- 完成状态 -->
                  <div
                    v-if="step.status === 'completed'"
                    class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-green-500 bg-green-500/20"
                  >
                    <i class="ri-check-line text-sm text-green-500"></i>
                  </div>
                  <!-- 运行状态 -->
                  <div
                    v-else-if="step.status === 'running'"
                    class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-blue-400 bg-blue-500/20"
                  >
                    <i class="ri-loader-4-line animate-spin text-sm text-blue-400"></i>
                  </div>
                  <!-- 失败状态 -->
                  <div
                    v-else-if="step.status === 'failed'"
                    class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-red-500 bg-red-500/20"
                  >
                    <i class="ri-close-line text-sm text-red-500"></i>
                  </div>
                  <!-- 等待状态 -->
                  <div
                    v-else
                    class="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-(--border-color) bg-(--bg-secondary)"
                  >
                    <span class="text-[10px] font-bold text-(--text-secondary)">{{
                      index + 1
                    }}</span>
                  </div>
                </div>

                <!-- 步骤信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="truncate text-[12px] font-semibold"
                      :class="[
                        step.status === 'completed'
                          ? 'text-green-500'
                          : step.status === 'running'
                            ? 'text-blue-400'
                            : step.status === 'failed'
                              ? 'text-red-500'
                              : 'text-(--text-primary)',
                      ]"
                    >
                      {{ step.name }}
                    </span>
                    <!-- 运行中的脉冲动画 -->
                    <span
                      v-if="step.status === 'running'"
                      class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
                    ></span>
                  </div>
                  <p class="mt-0.5 truncate text-[10px] text-(--text-secondary)">
                    {{ step.description }}
                  </p>
                  <!-- 耗时显示 -->
                  <div
                    v-if="step.duration || step.status === 'running'"
                    class="mt-1 flex items-center gap-2"
                  >
                    <i class="ri-time-line text-[10px] text-(--text-secondary)"></i>
                    <span
                      class="text-[10px]"
                      :class="
                        step.status === 'running'
                          ? 'text-blue-400'
                          : 'text-(--text-secondary)'
                      "
                    >
                      {{ step.duration || 'calculating...' }}
                    </span>
                  </div>
                </div>

                <!-- 展开箭头 -->
                <i
                  class="ri-arrow-right-s-line shrink-0 text-(--text-secondary) opacity-0 transition-opacity group-hover:opacity-100"
                ></i>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div
          v-if="!isFrontendProject"
          class="space-y-2 border-t border-(--border-color) bg-(--bg-secondary)/30 p-3"
        >
          <!-- 操作按钮组 -->
          <div class="step-run-control">
            <div class="mode-selector" @click.stop>
              <button
                class="mode-trigger"
                @click="showModeMenu = !showModeMenu"
                :disabled="flowRunControlBusy"
              >
                <i :class="runModes[activeRunMode].icon" class="mode-trigger-icon"></i>
                <span>{{ runModes[activeRunMode].label }}</span>
                <i
                  class="ri-arrow-down-s-line mode-chevron"
                  :class="{ open: showModeMenu }"
                ></i>
              </button>

              <Transition name="mode-menu">
                <div v-if="showModeMenu" class="mode-menu">
                  <button
                    v-for="(mode, key) in runModes"
                    :key="key"
                    class="mode-menu-item"
                    :class="{ active: activeRunMode === key }"
                    @click="handleRunModeSelect(key)"
                  >
                    <i :class="mode.icon" class="mode-item-icon"></i>
                    <span class="mode-item-label">{{ mode.label }}</span>
                    <span v-if="mode.shortcut" class="mode-item-shortcut">{{
                      mode.shortcut
                    }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <button
              @click="handleRunFlow"
              :disabled="flowRunControlBusy"
              class="run-go-btn"
              :class="{ running: flowRunControlBusy }"
            >
              <i
                :class="
                  flowRunControlBusy
                    ? 'ri-loader-4-line animate-spin'
                    : runModes[activeRunMode].icon
                "
              ></i>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useFlowStages } from '@/composables/useFlowStages'
import { useSubflow } from '@/composables/useSubflow'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useFlowRunMode } from '@/composables/useFlowRunMode'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useWorkspace } from '@/composables/useWorkspace'

// ============ Composables ============

// 流程阶段管理
const {
  flowStages,
  hasOngoingRunStage,
  refreshFlowStages,
  setFirstRunStepOngoing,
  setRunStepOngoingByPath,
} = useFlowStages()

// 子流程管理
const {
  subflowSteps,
  isLoading: isLoadingSubflow,
  refreshCurrentSubflow,
  currentStepTitle,
  currentStepEngine,
  completedSteps,
  progressPercent,
  totalTime,
  overallStatus,
  totalSteps,
} = useSubflow()

// 流程运行器
const { isRunning, runFlow, runAllFlow } = useFlowRunner()

// Workspace runtime events
// const { runtimeEvents } = useWorkspace()

// 当前阶段
const { currentStage, showProgressPanel, showOverviewPanel, showSubflowPanel } =
  useCurrentStage()

const { ensureApiReady, currentProject } = useWorkspace()
const isFrontendProject = computed(() => currentProject.value?.designTool === 'frontend')
const isFrontendExpandedView = computed(
  () =>
    isFrontendProject.value && ['src', 'wave'].includes(currentStage.value.toLowerCase()),
)
const showWorkspaceProgressPanel = computed(
  () => showProgressPanel.value && !isFrontendExpandedView.value,
)
const showFlowOverviewPanel = computed(
  () => showOverviewPanel.value || (isFrontendProject.value && showSubflowPanel.value),
)
const showBackendSubflowPanel = computed(
  () => showSubflowPanel.value && !isFrontendProject.value,
)
const showOverviewRunControls = computed(
  () => showOverviewPanel.value || !isFrontendProject.value,
)
const { activeRunMode, isRerun, runModes, selectRunMode } = useFlowRunMode(currentStage, {
  fullFlowLabel: computed(() => (isFrontendProject.value ? 'Frontend Flow' : 'RTL2GDS')),
})
const route = useRoute()

// ============ Flow 概览计算 ============
// 只统计 run 组的步骤
const runStages = computed(() => flowStages.value.filter((s) => s.group === 'run'))
const sidebarStages = computed(() => {
  if (!isFrontendProject.value) return flowStages.value
  const stages = flowStages.value.filter(
    (stage) => stage.path !== 'configure' && stage.path !== 'tech',
  )
  const srcStage = {
    label: 'Src',
    path: 'src',
    icon: 'ri-code-s-slash-line',
    group: 'run' as const,
    state: '',
    runtime: '',
    'peak memory (mb)': 0,
    virtual: true,
  }
  const waveStage = {
    label: 'Wave',
    path: 'wave',
    icon: 'ri-pulse-line',
    group: 'run' as const,
    state: '',
    runtime: '',
    'peak memory (mb)': 0,
    virtual: true,
  }
  const prepareIndex = stages.findIndex((stage) => stage.path.toLowerCase() === 'prepare')
  if (prepareIndex < 0) return stages
  const withSrc = [
    ...stages.slice(0, prepareIndex + 1),
    srcStage,
    ...stages.slice(prepareIndex + 1),
  ]
  const simIndex = withSrc.findIndex((stage) => stage.path.toLowerCase() === 'sim')
  if (simIndex < 0) return [...withSrc, waveStage]
  return [...withSrc.slice(0, simIndex + 1), waveStage, ...withSrc.slice(simIndex + 1)]
})

const flowStats = computed(() => {
  const stages = runStages.value
  return {
    total: stages.length,
    success: stages.filter((s) => s.state === 'Success').length,
    ongoing: stages.filter((s) => s.state === 'Ongoing').length,
    failed: stages.filter((s) => s.state === 'Invalid' || s.state === 'Incomplete')
      .length,
    pending: stages.filter(
      (s) => s.state === 'Pending' || s.state === 'Unstart' || !s.state,
    ).length,
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

const flowRunControlBusy = computed(() => isRunning.value || hasOngoingRunStage.value)

// ============ 运行模式 ============
const showModeMenu = ref(false)

function workspaceStageLink(stagePath: string) {
  return {
    path: `/workspace/${stagePath}`,
    query: route.query,
  }
}

// 点击外部关闭菜单
const closeMenu = () => {
  showModeMenu.value = false
}

const handleRunModeSelect = (mode: string) => {
  selectRunMode(mode)
  closeMenu()
}

onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))

// ============ 事件处理 ============
const handleRunFlow = async () => {
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
  } else {
    setRunStepOngoingByPath(currentStage.value)
    await runFlow({ rerun: isRerun.value })
    await Promise.all([refreshCurrentSubflow(), refreshFlowStages()])
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

.step-run-control {
  display: flex;
  align-items: center;
  gap: 6px;
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
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    opacity 0.2s ease,
    box-shadow 0.2s ease;
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
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
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
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}

.mode-menu-leave-active {
  transition:
    opacity 0.1s ease-in,
    transform 0.1s ease-in;
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
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    transform 0.15s ease;
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
