<template>
  <div
    class="relative flex h-full w-full flex-col items-center justify-center overflow-hidden text-(--text-primary)"
  >
    <div class="relative z-10 flex w-full max-w-4xl flex-col items-center px-8">
      <!-- Logo + Title -->
      <div class="mb-10 flex items-center justify-center">
        <div class="relative">
          <div
            class="absolute -inset-4 rounded-full bg-(--accent-color)/10 blur-xl"
          ></div>
          <i class="ri-cpu-line relative text-6xl text-(--accent-color)"></i>
        </div>
        <div class="ml-5 flex flex-col">
          <h1 class="text-4xl font-bold tracking-tight text-(--text-primary)">
            ECOS Studio
          </h1>
        </div>
      </div>

      <!-- Design Tools -->
      <div class="mb-8 w-full max-w-2xl">
        <h3
          class="mb-3 px-1 text-xs font-semibold tracking-wider text-(--text-secondary) uppercase"
        >
          Design Tools
        </h3>
        <div class="grid grid-cols-3 gap-4">
          <!-- Frontend Design -->
          <div
            class="group relative flex cursor-default flex-col items-center justify-center overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary) py-8 opacity-50 transition-all duration-200"
          >
            <div
              class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-(--bg-primary)"
            >
              <i class="ri-code-s-slash-line text-2xl text-(--text-secondary)"></i>
            </div>
            <span class="mb-1 text-sm font-medium text-(--text-primary)"
              >Frontend Design</span
            >
            <span class="text-xs text-(--text-secondary)"
              >RTL / Verilog / SystemVerilog</span
            >
            <div
              class="absolute inset-0 flex items-center justify-center bg-(--bg-primary)/60"
            >
              <span
                class="rounded-full border border-(--border-color) bg-(--bg-secondary) px-3 py-1 text-xs font-medium text-(--text-secondary)"
                >Coming Soon</span
              >
            </div>
          </div>
          <!-- SOC -->
          <button
            @click="navigateToSoc"
            class="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-(--border-color) bg-(--bg-secondary) py-8 transition-all duration-200 hover:scale-[1.02] hover:border-(--accent-color) hover:shadow-(--accent-color)/5 hover:shadow-lg"
          >
            <div
              class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-(--bg-primary) transition-colors group-hover:bg-(--accent-color)/10"
            >
              <i
                class="ri-cpu-line text-2xl text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
              ></i>
            </div>
            <span class="mb-1 text-sm font-medium text-(--text-primary)">SoC</span>
            <span class="text-xs text-(--text-secondary)">Remote template catalog</span>
          </button>

          <!-- Backend Design -->
          <button
            @click="navigateToECC"
            class="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-(--border-color) bg-(--bg-secondary) py-8 transition-all duration-200 hover:scale-[1.02] hover:border-(--accent-color) hover:shadow-(--accent-color)/5 hover:shadow-lg"
          >
            <div
              class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-(--bg-primary) transition-colors group-hover:bg-(--accent-color)/10"
            >
              <i
                class="ri-cpu-line text-2xl text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
              ></i>
            </div>
            <span class="mb-1 text-sm font-medium text-(--text-primary)"
              >Backend Design</span
            >
            <span class="text-xs text-(--text-secondary)">Synthesis → P&R → GDS</span>
          </button>
        </div>
      </div>

      <!-- Quick links -->
      <div class="mb-8 w-full max-w-2xl">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="space-y-2">
              <button
                @click="navigateToTools"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-tools-line text-lg text-(--accent-color)"></i>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-(--text-primary)"
                    >Resource Manager</span
                  >
                  <span class="block truncate text-xs text-(--text-secondary)"
                    >EDA tools and PDKs</span
                  >
                </span>
                <i
                  class="ri-arrow-right-s-line text-lg text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
                ></i>
              </button>

              <button
                @click="handleNotReady"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left opacity-50 transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-puzzle-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">IP Catalog</span>
              </button>
            </div>
          </div>

          <div>
            <div class="space-y-2">
              <button
                @click="handleNotReady"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left opacity-50 transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-bar-chart-box-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">Benchmarks</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <!-- Continue Working -->
      <div v-if="lastProject" class="mb-8 w-full max-w-2xl">
        <button
          @click="handleResume"
          class="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-(--border-color) bg-(--bg-secondary) px-6 py-4 transition-all duration-200 hover:border-(--accent-color)"
          :class="
            lastProject.workspaceRecognized === false
              ? 'pointer-events-none opacity-50'
              : 'hover:shadow-(--accent-color)/5 hover:shadow-lg'
          "
        >
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-(--accent-color)/10 transition-colors group-hover:bg-(--accent-color)/20"
          >
            <i class="ri-folder-line text-xl text-(--accent-color)"></i>
          </div>
          <div class="min-w-0 flex-1 text-left">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium text-(--text-primary)">{{
                lastProject.name
              }}</span>
              <span
                v-if="lastProject.pdk"
                class="shrink-0 rounded bg-(--accent-color)/10 px-1.5 py-0.5 text-[10px] font-medium text-(--accent-color)"
              >
                {{ lastProject.pdk }}
              </span>
              <span
                v-if="lastProject.status"
                :class="statusBadgeClass(lastProject.status)"
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              >
                {{ statusLabel(lastProject.status) }}
              </span>
            </div>
            <div class="mt-1 flex items-center gap-3 text-xs text-(--text-secondary)">
              <span v-if="lastProject.completedSteps != null && lastProject.totalSteps">
                {{ lastProject.completedSteps }}/{{ lastProject.totalSteps }} steps
              </span>
              <span>{{ formatDate(lastProject.lastOpened) }}</span>
              <span v-if="lastProject.workspaceRecognized === false" class="text-red-400"
                >Workspace not recognized</span
              >
            </div>
          </div>
          <div
            class="flex shrink-0 items-center gap-2 text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
          >
            <span class="text-sm">Resume</span>
            <i class="ri-arrow-right-line"></i>
          </div>
        </button>
      </div>

      <!-- Project Management entry -->
      <button
        @click="navigateToProjects"
        class="group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-(--border-color) px-6 py-3 text-(--text-secondary) transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color)"
      >
        <i
          class="ri-folder-settings-line text-lg transition-colors group-hover:text-(--accent-color)"
        ></i>
        <span class="text-sm font-medium">Project Management</span>
        <i
          class="ri-arrow-right-s-line text-lg transition-transform group-hover:translate-x-0.5"
        ></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { ProjectStatus } from '../types'
import { useWorkspace } from '../composables/useWorkspace'

const router = useRouter()
const { recentProjects, openProject, loadRecentProjects } = useWorkspace()

onMounted(async () => {
  await loadRecentProjects()
})

const lastProject = computed(() => {
  return recentProjects.value.length > 0 ? recentProjects.value[0] : null
})

const navigateToECC = () => router.push('/ecc')
const navigateToSoc = () => router.push('/soc')
const navigateToProjects = () => router.push('/projects')
const navigateToTools = () => router.push('/tools')
const handleNotReady = () => {
  /* placeholder */
}

const handleResume = async () => {
  if (!lastProject.value || lastProject.value.workspaceRecognized === false) return
  const success = await openProject(lastProject.value)
  if (success) router.push('/workspace')
}

function statusBadgeClass(status: ProjectStatus): string {
  const map: Record<ProjectStatus, string> = {
    success: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    running: 'bg-blue-500/15 text-blue-400',
    in_progress: 'bg-amber-500/15 text-amber-400',
    not_started: 'bg-gray-500/15 text-gray-400',
  }
  return map[status] || 'bg-gray-500/15 text-gray-400'
}

function statusLabel(status: ProjectStatus): string {
  const map: Record<ProjectStatus, string> = {
    success: 'Success',
    failed: 'Failed',
    running: 'Running',
    in_progress: 'In Progress',
    not_started: 'Not Started',
  }
  return map[status] || 'Unknown'
}

function formatDate(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  return new Date(date).toLocaleDateString('en-US')
}
</script>
