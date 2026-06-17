<template>
  <div class="flex flex-col items-center justify-center h-full w-full text-(--text-primary) relative overflow-hidden">
    <div class="relative z-10 flex flex-col items-center w-full max-w-4xl px-8">

      <!-- Logo + Title -->
      <div class="flex items-center justify-center mb-10">
        <div class="relative">
          <div class="absolute -inset-4 bg-(--accent-color)/10 rounded-full blur-xl"></div>
          <i class="ri-cpu-line text-6xl text-(--accent-color) relative"></i>
        </div>
        <div class="flex flex-col ml-5">
          <h1 class="text-4xl font-bold text-(--text-primary) tracking-tight">ECOS Studio</h1>
        </div>
      </div>


      <!-- Design Tools -->
      <div class="w-full max-w-2xl mb-8">
        <h3 class="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3 px-1">Design Tools</h3>
        <div class="grid grid-cols-3 gap-4">
          <!-- Frontend Design -->
          <div
            class="group relative flex flex-col items-center justify-center py-8 bg-(--bg-secondary) rounded-xl border border-(--border-color) transition-all duration-200 opacity-50 cursor-default overflow-hidden">
            <div class="w-12 h-12 rounded-xl bg-(--bg-primary) flex items-center justify-center mb-3">
              <i class="ri-code-s-slash-line text-2xl text-(--text-secondary)"></i>
            </div>
            <span class="text-sm font-medium text-(--text-primary) mb-1">Frontend Design</span>
            <span class="text-xs text-(--text-secondary)">RTL / Verilog / SystemVerilog</span>
            <div class="absolute inset-0 flex items-center justify-center bg-(--bg-primary)/60">
              <span class="text-xs font-medium text-(--text-secondary) bg-(--bg-secondary) px-3 py-1 rounded-full border border-(--border-color)">Coming Soon</span>
            </div>
          </div>
          <!-- SOC -->
          <button @click="navigateToSoc"
            class="group flex flex-col items-center justify-center py-8 bg-(--bg-secondary) rounded-xl border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 hover:scale-[1.02] cursor-pointer hover:shadow-lg hover:shadow-(--accent-color)/5">
            <div class="w-12 h-12 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors mb-3">
              <i class="ri-cpu-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
            </div>
            <span class="text-sm font-medium text-(--text-primary) mb-1">SoC</span>
            <span class="text-xs text-(--text-secondary)">Remote template catalog</span>
          </button>
          
          <!-- Backend Design -->
          <button @click="navigateToECC"
            class="group flex flex-col items-center justify-center py-8 bg-(--bg-secondary) rounded-xl border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 hover:scale-[1.02] cursor-pointer hover:shadow-lg hover:shadow-(--accent-color)/5">
            <div class="w-12 h-12 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors mb-3">
              <i class="ri-cpu-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
            </div>
            <span class="text-sm font-medium text-(--text-primary) mb-1">Backend Design</span>
            <span class="text-xs text-(--text-secondary)">Synthesis → P&R → GDS</span>
          </button>
        </div>
      </div>

      <!-- Quick links -->
      <div class="w-full max-w-2xl mb-8">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="space-y-2">
              <button @click="navigateToTools"
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group text-left">
                <i class="ri-tools-line text-lg text-(--accent-color)"></i>
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-medium text-(--text-primary)">Resource Manager</span>
                  <span class="block text-xs text-(--text-secondary) truncate">EDA tools and PDKs</span>
                </span>
                <i class="ri-arrow-right-s-line text-lg text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
              </button>

              <button @click="handleNotReady"
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group text-left opacity-50">
                <i class="ri-puzzle-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">IP Catalog</span>
              </button>
            </div>
          </div>

          <div>
            <div class="space-y-2">
              <button @click="handleNotReady"
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group text-left opacity-50">
                <i class="ri-bar-chart-box-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">Benchmarks</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <!-- Continue Working -->
      <div v-if="lastProject" class="w-full max-w-2xl mb-8">
        <button @click="handleResume"
          class="w-full flex items-center gap-4 px-6 py-4 bg-(--bg-secondary) rounded-xl border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group"
          :class="lastProject.workspaceRecognized === false ? 'opacity-50 pointer-events-none' : 'hover:shadow-lg hover:shadow-(--accent-color)/5'">
          <div class="w-11 h-11 rounded-lg bg-(--accent-color)/10 flex items-center justify-center shrink-0 group-hover:bg-(--accent-color)/20 transition-colors">
            <i class="ri-folder-line text-xl text-(--accent-color)"></i>
          </div>
          <div class="flex-1 min-w-0 text-left">
            <div class="flex items-center gap-2">
              <span class="font-medium text-(--text-primary) truncate">{{ lastProject.name }}</span>
              <span v-if="lastProject.pdk"
                class="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-color)/10 text-(--accent-color) font-medium shrink-0">
                {{ lastProject.pdk }}
              </span>
              <span v-if="lastProject.status" :class="statusBadgeClass(lastProject.status)"
                class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0">
                {{ statusLabel(lastProject.status) }}
              </span>
            </div>
            <div class="flex items-center gap-3 mt-1 text-xs text-(--text-secondary)">
              <span v-if="lastProject.completedSteps != null && lastProject.totalSteps">
                {{ lastProject.completedSteps }}/{{ lastProject.totalSteps }} steps
              </span>
              <span>{{ formatDate(lastProject.lastOpened) }}</span>
              <span v-if="lastProject.workspaceRecognized === false" class="text-red-400">Workspace not recognized</span>
            </div>
          </div>
          <div class="flex items-center gap-2 text-(--text-secondary) group-hover:text-(--accent-color) transition-colors shrink-0">
            <span class="text-sm">Resume</span>
            <i class="ri-arrow-right-line"></i>
          </div>
        </button>
      </div>
      
      <!-- Project Management entry -->
      <button @click="navigateToProjects"
        class="flex items-center gap-3 px-6 py-3 rounded-xl border border-dashed border-(--border-color) hover:border-(--accent-color) text-(--text-secondary) hover:text-(--accent-color) transition-all duration-200 cursor-pointer group">
        <i class="ri-folder-settings-line text-lg group-hover:text-(--accent-color) transition-colors"></i>
        <span class="text-sm font-medium">Project Management</span>
        <i class="ri-arrow-right-s-line text-lg group-hover:translate-x-0.5 transition-transform"></i>
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
const handleNotReady = () => { /* placeholder */ }

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
