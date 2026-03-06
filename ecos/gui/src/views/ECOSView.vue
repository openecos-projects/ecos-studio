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
        <div class="grid grid-cols-2 gap-4">
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

      <!-- Resources & Explore -->
      <div class="w-full max-w-2xl mb-8">
        <div class="grid grid-cols-2 gap-4">
          <!-- Resources column -->
          <div>
            <h3 class="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3 px-1">Resources</h3>
            <div class="space-y-2">
              <button @click="handleNotReady"
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group text-left opacity-50">
                <i class="ri-puzzle-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">IP Catalog</span>
              </button>

              <!-- PDK Manager card -->
              <div class="bg-(--bg-secondary) rounded-xl border border-(--border-color) overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center gap-2">
                    <i class="ri-database-2-line text-lg text-(--text-secondary)"></i>
                    <span class="text-sm font-medium text-(--text-primary)">PDK Manager</span>
                    <span v-if="importedPdks.length > 0" class="text-[10px] text-(--text-secondary)">({{ importedPdks.length }})</span>
                  </div>
                  <button @click="handleImportPdk"
                    class="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-(--accent-color) hover:bg-(--accent-color)/10 transition-colors cursor-pointer">
                    <i class="ri-add-line text-sm"></i>
                    Import
                  </button>
                </div>
                <div v-if="importedPdks.length > 0" class="border-t border-(--border-color)">
                  <div v-for="pdk in importedPdks" :key="pdk.id"
                    class="flex items-center gap-3 px-4 py-2.5 hover:bg-(--bg-primary)/50 transition-colors group">
                    <div class="w-6 h-6 rounded-md bg-(--accent-color)/10 flex items-center justify-center shrink-0">
                      <i class="ri-cpu-line text-xs text-(--accent-color)"></i>
                    </div>
                    <span class="text-sm text-(--text-primary) truncate flex-1">{{ pdk.name }}</span>
                    <span v-if="pdk.techNode"
                      class="text-[9px] px-1.5 py-0.5 rounded bg-(--accent-color)/10 text-(--accent-color) font-medium shrink-0">
                      {{ pdk.techNode }}
                    </span>
                    <button @click.stop="handleRemovePdk(pdk.id)"
                      class="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer"
                      title="Remove this PDK">
                      <i class="ri-close-line text-xs text-(--text-secondary) hover:text-red-500"></i>
                    </button>
                  </div>
                </div>
                <div v-else class="px-4 py-3 border-t border-(--border-color)">
                  <p class="text-xs text-(--text-secondary) opacity-60">No PDKs imported yet</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Explore column -->
          <div>
            <h3 class="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3 px-1">Explore</h3>
            <div class="space-y-2">
              <button @click="handleNotReady"
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group text-left opacity-50">
                <i class="ri-bar-chart-box-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">Benchmarks</span>
              </button>
              <button @click="handleNotReady"
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group text-left opacity-50">
                <i class="ri-book-open-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">Documentation</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <!-- Continue Working -->
      <div v-if="lastProject" class="w-full max-w-2xl mb-8">
        <button @click="handleResume"
          class="w-full flex items-center gap-4 px-6 py-4 bg-(--bg-secondary) rounded-xl border border-(--border-color) hover:border-(--accent-color) transition-all duration-200 cursor-pointer group"
          :class="lastProject.pathExists === false ? 'opacity-50 pointer-events-none' : 'hover:shadow-lg hover:shadow-(--accent-color)/5'">
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
              <span v-if="lastProject.pathExists === false" class="text-red-400">Path not reachable</span>
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
import { usePdkManager } from '../composables/usePdkManager'

const router = useRouter()
const { recentProjects, openProject, loadRecentProjects } = useWorkspace()
const { importedPdks, loadPdks, importPdk, removePdk } = usePdkManager()

onMounted(async () => {
  await Promise.all([loadRecentProjects(), loadPdks()])
})

const lastProject = computed(() => {
  return recentProjects.value.length > 0 ? recentProjects.value[0] : null
})

const navigateToECC = () => router.push('/ecc')
const navigateToProjects = () => router.push('/projects')
const handleNotReady = () => { /* placeholder */ }

const handleImportPdk = async () => {
  await importPdk()
}

const handleRemovePdk = async (id: string) => {
  await removePdk(id)
}

const handleResume = async () => {
  if (!lastProject.value || lastProject.value.pathExists === false) return
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
