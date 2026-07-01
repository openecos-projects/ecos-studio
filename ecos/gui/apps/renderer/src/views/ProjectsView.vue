<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden text-(--text-primary)">
    <div class="relative z-10 mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-6">
      <!-- Header -->
      <div class="mb-6 flex shrink-0 items-center justify-between">
        <div class="flex items-center gap-4">
          <button
            @click="goBack"
            class="flex cursor-pointer items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-3 py-2 text-sm text-(--text-secondary) transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color)"
          >
            <i class="ri-arrow-left-line"></i>
            <span>ECOS</span>
          </button>
          <h1 class="text-xl font-semibold">Project Management</h1>
          <span class="text-sm text-(--text-secondary)"
            >{{ filteredProjects.length }} projects</span
          >
        </div>
      </div>

      <!-- Filter & Sort bar -->
      <div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <!-- PDK filter -->
        <select
          v-model="filterPdk"
          class="cursor-pointer rounded-lg border border-(--border-color) bg-(--bg-secondary) px-3 py-2 text-sm text-(--text-primary) transition-colors focus:border-(--accent-color) focus:outline-none"
        >
          <option value="">All PDKs</option>
          <option v-for="pdk in availablePdks" :key="pdk" :value="pdk">{{ pdk }}</option>
        </select>

        <!-- Status filter -->
        <select
          v-model="filterStatus"
          class="cursor-pointer rounded-lg border border-(--border-color) bg-(--bg-secondary) px-3 py-2 text-sm text-(--text-primary) transition-colors focus:border-(--accent-color) focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="in_progress">In Progress</option>
          <option value="not_started">Not Started</option>
        </select>

        <!-- Search -->
        <div class="relative min-w-[200px] flex-1">
          <i
            class="ri-search-line absolute top-1/2 left-3 -translate-y-1/2 text-sm text-(--text-secondary)"
          ></i>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search projects..."
            class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary) py-2 pr-3 pl-9 text-sm text-(--text-primary) transition-colors placeholder:text-(--text-secondary)/50 focus:border-(--accent-color) focus:outline-none"
          />
        </div>

        <!-- Sort -->
        <select
          v-model="sortBy"
          class="cursor-pointer rounded-lg border border-(--border-color) bg-(--bg-secondary) px-3 py-2 text-sm text-(--text-primary) transition-colors focus:border-(--accent-color) focus:outline-none"
        >
          <option value="lastModified">Last Modified</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
          <option value="progress">Progress</option>
        </select>
      </div>

      <!-- Project list -->
      <div
        class="scrollbar-thin flex-1 space-y-3 overflow-y-auto pb-4"
        v-if="filteredProjects.length > 0"
      >
        <div
          v-for="project in filteredProjects"
          :key="project.id"
          class="group flex items-start gap-4 rounded-xl border bg-(--bg-secondary) px-5 py-4 transition-all duration-200"
          :class="
            project.workspaceRecognized === false
              ? 'cursor-default border-(--border-color) opacity-50'
              : 'cursor-pointer border-(--border-color) hover:border-(--accent-color) hover:shadow-md'
          "
          @click="project.workspaceRecognized !== false && handleOpen(project)"
        >
          <!-- Status icon -->
          <div
            class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            :class="statusIconBgClass(project.status)"
          >
            <i
              :class="[
                statusIcon(project.status),
                statusIconColorClass(project.status),
                'text-lg',
              ]"
              :style="
                project.status === 'running' ? 'animation: spin 2s linear infinite' : ''
              "
            ></i>
          </div>

          <!-- Project info -->
          <div class="min-w-0 flex-1">
            <!-- Row 1: Name + badges -->
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate font-medium text-(--text-primary)">{{
                project.name
              }}</span>
              <span
                v-if="project.status"
                :class="statusBadgeClass(project.status)"
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              >
                {{ statusLabel(project.status) }}
              </span>
              <span
                v-if="project.pdk"
                class="shrink-0 rounded bg-(--accent-color)/10 px-1.5 py-0.5 text-[10px] font-medium text-(--accent-color)"
              >
                {{ project.pdk }}
              </span>
              <span
                v-if="project.workspaceRecognized === false"
                class="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
              >
                Workspace not recognized
              </span>
            </div>

            <!-- Row 2: Parameters -->
            <div class="mt-1.5 flex items-center gap-4 text-xs text-(--text-secondary)">
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
            <div class="mt-2 flex items-center gap-3">
              <div
                v-if="project.totalSteps && project.totalSteps > 0"
                class="flex min-w-0 flex-1 items-center gap-2"
              >
                <div
                  class="h-1.5 max-w-[200px] flex-1 overflow-hidden rounded-full bg-(--bg-primary)"
                >
                  <div
                    class="h-full rounded-full transition-all duration-300"
                    :class="progressBarColor(project.status)"
                    :style="{
                      width: `${((project.completedSteps || 0) / project.totalSteps) * 100}%`,
                    }"
                  ></div>
                </div>
                <span class="shrink-0 text-[11px] text-(--text-secondary)">
                  {{ project.completedSteps || 0 }}/{{ project.totalSteps }}
                </span>
              </div>
              <span class="truncate font-mono text-[11px] text-(--text-secondary)">{{
                project.path
              }}</span>
            </div>
          </div>

          <!-- Right: time + actions -->
          <div class="mt-1 flex shrink-0 items-center gap-2">
            <span class="text-xs whitespace-nowrap text-(--text-secondary)">{{
              formatDate(project.lastOpened)
            }}</span>
            <button
              @click.stop="handleRemove(project.id)"
              class="cursor-pointer rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10"
              title="Remove from list"
            >
              <i
                class="ri-close-line text-sm text-(--text-secondary) hover:text-red-500"
              ></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-1 flex-col items-center justify-center text-center">
        <i class="ri-folder-2-line mb-4 text-6xl text-(--text-secondary) opacity-20"></i>
        <p class="mb-2 text-lg font-medium text-(--text-primary)">
          {{ recentProjects.length === 0 ? 'No projects yet' : 'No matching projects' }}
        </p>
        <p class="mb-6 text-sm text-(--text-secondary)">
          {{
            recentProjects.length === 0
              ? 'Create your first project from the Backend Design tool'
              : 'Try adjusting your filters or search query'
          }}
        </p>
        <button
          v-if="recentProjects.length === 0"
          @click="router.push('/ecc')"
          class="flex cursor-pointer items-center gap-2 rounded-lg bg-(--accent-color)/10 px-5 py-2.5 text-sm font-medium text-(--accent-color) transition-colors hover:bg-(--accent-color)/20"
        >
          <i class="ri-cpu-line"></i>
          Go to Backend Design
        </button>
        <button
          v-else
          @click="clearFilters"
          class="flex cursor-pointer items-center gap-2 rounded-lg bg-(--bg-secondary) px-5 py-2.5 text-sm text-(--text-secondary) transition-colors hover:text-(--text-primary)"
        >
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
const { recentProjects, openProject, removeRecentProject, loadRecentProjects } =
  useWorkspace()

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
    result = result.filter((p) => p.pdk === filterPdk.value)
  }
  if (filterStatus.value) {
    result = result.filter((p) => p.status === filterStatus.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        (p.topModule && p.topModule.toLowerCase().includes(q)),
    )
  }

  result.sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'status': {
        const order: Record<string, number> = {
          success: 0,
          running: 1,
          in_progress: 2,
          failed: 3,
          not_started: 4,
        }
        return (
          (order[a.status || 'not_started'] ?? 5) -
          (order[b.status || 'not_started'] ?? 5)
        )
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
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
