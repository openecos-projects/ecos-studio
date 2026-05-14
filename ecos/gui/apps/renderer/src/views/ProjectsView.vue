<template>
  <div class="flex flex-col h-full w-full text-(--text-primary) relative overflow-hidden">
    <div class="relative z-10 flex flex-col w-full max-w-5xl mx-auto px-8 py-6 h-full">

      <!-- Header -->
      <div class="flex items-center justify-between mb-6 shrink-0">
        <div class="flex items-center gap-4">
          <button @click="goBack"
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color) hover:border-(--accent-color) text-(--text-secondary) hover:text-(--accent-color) transition-all duration-200 cursor-pointer text-sm">
            <i class="ri-arrow-left-line"></i>
            <span>ECOS</span>
          </button>
          <h1 class="text-xl font-semibold">Project Management</h1>
          <span class="text-sm text-(--text-secondary)">{{ filteredProjects.length }} projects</span>
        </div>
      </div>

      <!-- Filter & Sort bar -->
      <div class="flex items-center gap-3 mb-4 shrink-0 flex-wrap">
        <!-- PDK filter -->
        <select v-model="filterPdk"
          class="px-3 py-2 text-sm bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) cursor-pointer focus:border-(--accent-color) focus:outline-none transition-colors">
          <option value="">All PDKs</option>
          <option v-for="pdk in availablePdks" :key="pdk" :value="pdk">{{ pdk }}</option>
        </select>

        <!-- Status filter -->
        <select v-model="filterStatus"
          class="px-3 py-2 text-sm bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) cursor-pointer focus:border-(--accent-color) focus:outline-none transition-colors">
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="in_progress">In Progress</option>
          <option value="not_started">Not Started</option>
        </select>

        <!-- Search -->
        <div class="flex-1 relative min-w-[200px]">
          <i class="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-(--text-secondary) text-sm"></i>
          <input v-model="searchQuery" type="text" placeholder="Search projects..."
            class="w-full pl-9 pr-3 py-2 text-sm bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:border-(--accent-color) focus:outline-none transition-colors" />
        </div>

        <!-- Sort -->
        <select v-model="sortBy"
          class="px-3 py-2 text-sm bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) cursor-pointer focus:border-(--accent-color) focus:outline-none transition-colors">
          <option value="lastModified">Last Modified</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
          <option value="progress">Progress</option>
        </select>
      </div>

      <!-- Project list -->
      <div class="flex-1 overflow-y-auto space-y-3 scrollbar-thin pb-4" v-if="filteredProjects.length > 0">
        <div v-for="project in filteredProjects" :key="project.id"
          class="flex items-start gap-4 px-5 py-4 bg-(--bg-secondary) rounded-xl border transition-all duration-200 group"
          :class="project.workspaceRecognized === false
            ? 'border-(--border-color) opacity-50 cursor-default'
            : 'border-(--border-color) hover:border-(--accent-color) hover:shadow-md cursor-pointer'"
          @click="project.workspaceRecognized !== false && handleOpen(project)">

          <!-- Status icon -->
          <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            :class="statusIconBgClass(project.status)">
            <i :class="[statusIcon(project.status), statusIconColorClass(project.status), 'text-lg']"
              :style="project.status === 'running' ? 'animation: spin 2s linear infinite' : ''"></i>
          </div>

          <!-- Project info -->
          <div class="flex-1 min-w-0">
            <!-- Row 1: Name + badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-(--text-primary) truncate">{{ project.name }}</span>
              <span v-if="project.status" :class="statusBadgeClass(project.status)"
                class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0">
                {{ statusLabel(project.status) }}
              </span>
              <span v-if="project.pdk"
                class="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-color)/10 text-(--accent-color) font-medium shrink-0">
                {{ project.pdk }}
              </span>
              <span v-if="project.workspaceRecognized === false"
                class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium shrink-0">
                Workspace not recognized
              </span>
            </div>

            <!-- Row 2: Parameters -->
            <div class="flex items-center gap-4 mt-1.5 text-xs text-(--text-secondary)">
              <span v-if="project.topModule" class="flex items-center gap-1">
                <i class="ri-code-s-slash-line text-[11px]"></i>
                {{ project.topModule }}
              </span>
              <span v-if="project.frequencyTarget" class="flex items-center gap-1">
                <i class="ri-speed-line text-[11px]"></i>
                {{ project.frequencyTarget }}MHz
              </span>
              <span v-if="project.coreUtilization" class="flex items-center gap-1">
                <i class="ri-layout-grid-line text-[11px]"></i>
                {{ (project.coreUtilization * 100).toFixed(0) }}% util
              </span>
              <span v-if="project.cellCount" class="flex items-center gap-1">
                <i class="ri-apps-line text-[11px]"></i>
                {{ project.cellCount.toLocaleString() }} cells
              </span>
              <span v-if="project.totalRuntime" class="flex items-center gap-1">
                <i class="ri-timer-line text-[11px]"></i>
                {{ project.totalRuntime }}
              </span>
            </div>

            <!-- Row 3: Progress bar + path -->
            <div class="flex items-center gap-3 mt-2">
              <div v-if="project.totalSteps && project.totalSteps > 0"
                class="flex items-center gap-2 flex-1 min-w-0">
                <div class="flex-1 h-1.5 bg-(--bg-primary) rounded-full overflow-hidden max-w-[200px]">
                  <div class="h-full rounded-full transition-all duration-300"
                    :class="progressBarColor(project.status)"
                    :style="{ width: `${((project.completedSteps || 0) / project.totalSteps) * 100}%` }">
                  </div>
                </div>
                <span class="text-[11px] text-(--text-secondary) shrink-0">
                  {{ project.completedSteps || 0 }}/{{ project.totalSteps }}
                </span>
              </div>
              <span class="text-[11px] text-(--text-secondary) font-mono truncate">{{ project.path }}</span>
            </div>
          </div>

          <!-- Right: time + actions -->
          <div class="flex items-center gap-2 shrink-0 mt-1">
            <span class="text-xs text-(--text-secondary) whitespace-nowrap">{{ formatDate(project.lastOpened) }}</span>
            <button @click.stop="handleRemove(project.id)"
              class="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer"
              title="Remove from list">
              <i class="ri-close-line text-sm text-(--text-secondary) hover:text-red-500"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="flex-1 flex flex-col items-center justify-center text-center">
        <i class="ri-folder-2-line text-6xl text-(--text-secondary) opacity-20 mb-4"></i>
        <p class="text-lg font-medium text-(--text-primary) mb-2">
          {{ recentProjects.length === 0 ? 'No projects yet' : 'No matching projects' }}
        </p>
        <p class="text-sm text-(--text-secondary) mb-6">
          {{ recentProjects.length === 0
            ? 'Create your first project from the Backend Design tool'
            : 'Try adjusting your filters or search query'
          }}
        </p>
        <button v-if="recentProjects.length === 0" @click="router.push('/ecc')"
          class="flex items-center gap-2 px-5 py-2.5 bg-(--accent-color)/10 text-(--accent-color) rounded-lg hover:bg-(--accent-color)/20 transition-colors cursor-pointer text-sm font-medium">
          <i class="ri-cpu-line"></i>
          Go to Backend Design
        </button>
        <button v-else @click="clearFilters"
          class="flex items-center gap-2 px-5 py-2.5 bg-(--bg-secondary) text-(--text-secondary) rounded-lg hover:text-(--text-primary) transition-colors cursor-pointer text-sm">
          <i class="ri-filter-off-line"></i>
          Clear Filters
        </button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Project, ProjectStatus } from '../types'
import { useWorkspace } from '../composables/useWorkspace'

const router = useRouter()
const { recentProjects, openProject, removeRecentProject, loadRecentProjects } = useWorkspace()

const filterPdk = ref('')
const filterStatus = ref('')
const searchQuery = ref('')
const sortBy = ref('lastModified')

onMounted(async () => {
  await loadRecentProjects()
})

const availablePdks = computed(() => {
  const pdks = new Set<string>()
  for (const p of recentProjects.value) {
    if (p.pdk) pdks.add(p.pdk)
  }
  return Array.from(pdks).sort()
})

const filteredProjects = computed(() => {
  let result = [...recentProjects.value]

  if (filterPdk.value) {
    result = result.filter(p => p.pdk === filterPdk.value)
  }
  if (filterStatus.value) {
    result = result.filter(p => p.status === filterStatus.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q) ||
      (p.topModule && p.topModule.toLowerCase().includes(q))
    )
  }

  result.sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'status': {
        const order: Record<string, number> = { success: 0, running: 1, in_progress: 2, failed: 3, not_started: 4 }
        return (order[a.status || 'not_started'] ?? 5) - (order[b.status || 'not_started'] ?? 5)
      }
      case 'progress': {
        const pa = a.totalSteps ? (a.completedSteps || 0) / a.totalSteps : 0
        const pb = b.totalSteps ? (b.completedSteps || 0) / b.totalSteps : 0
        return pb - pa
      }
      default:
        return new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime()
    }
  })

  return result
})

function clearFilters() {
  filterPdk.value = ''
  filterStatus.value = ''
  searchQuery.value = ''
}

const goBack = () => router.push('/')

const handleOpen = async (project: Project) => {
  const success = await openProject(project)
  if (success) router.push('/workspace')
}

const handleRemove = async (projectId: string) => {
  await removeRecentProject(projectId)
}

function statusBadgeClass(status?: ProjectStatus): string {
  if (!status) return 'bg-gray-500/15 text-gray-400'
  const map: Record<ProjectStatus, string> = {
    success: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    running: 'bg-blue-500/15 text-blue-400',
    in_progress: 'bg-amber-500/15 text-amber-400',
    not_started: 'bg-gray-500/15 text-gray-400',
  }
  return map[status]
}

function statusLabel(status?: ProjectStatus): string {
  if (!status) return 'Unknown'
  const map: Record<ProjectStatus, string> = {
    success: 'Success',
    failed: 'Failed',
    running: 'Running',
    in_progress: 'In Progress',
    not_started: 'Not Started',
  }
  return map[status]
}

function statusIcon(status?: ProjectStatus): string {
  if (!status) return 'ri-question-line'
  const map: Record<ProjectStatus, string> = {
    success: 'ri-check-line',
    failed: 'ri-close-line',
    running: 'ri-loader-4-line',
    in_progress: 'ri-time-line',
    not_started: 'ri-subtract-line',
  }
  return map[status]
}

function statusIconBgClass(status?: ProjectStatus): string {
  if (!status) return 'bg-gray-500/10'
  const map: Record<ProjectStatus, string> = {
    success: 'bg-emerald-500/10',
    failed: 'bg-red-500/10',
    running: 'bg-blue-500/10',
    in_progress: 'bg-amber-500/10',
    not_started: 'bg-gray-500/10',
  }
  return map[status]
}

function statusIconColorClass(status?: ProjectStatus): string {
  if (!status) return 'text-gray-400'
  const map: Record<ProjectStatus, string> = {
    success: 'text-emerald-400',
    failed: 'text-red-400',
    running: 'text-blue-400',
    in_progress: 'text-amber-400',
    not_started: 'text-gray-400',
  }
  return map[status]
}

function progressBarColor(status?: ProjectStatus): string {
  if (!status) return 'bg-gray-500'
  const map: Record<ProjectStatus, string> = {
    success: 'bg-emerald-500',
    failed: 'bg-red-500',
    running: 'bg-blue-500',
    in_progress: 'bg-amber-500',
    not_started: 'bg-gray-500',
  }
  return map[status]
}

function formatDate(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(date).toLocaleDateString('en-US')
}
</script>

<style scoped>
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
