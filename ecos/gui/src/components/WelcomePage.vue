<template>
  <div
    class="flex flex-col items-center justify-center h-screen w-screen bg-(--bg-primary) text-(--text-primary) relative overflow-hidden">
    <!-- 装饰性背景渐变 -->
    <div class="absolute inset-0 opacity-5 pointer-events-none welcome-gradient"></div>

    <!-- 装饰性网格背景 -->
    <div class="absolute inset-0 opacity-[0.02] pointer-events-none"
      style="background-image: linear-gradient(var(--text-primary) 1px, transparent 1px), linear-gradient(90deg, var(--text-primary) 1px, transparent 1px); background-size: 50px 50px;">
    </div>

    <div class="relative z-10 flex flex-col items-center w-full">
      <!-- Logo 和标题 -->
      <div class="flex items-center justify-center mb-12">
        <div class="relative">
          <div class="absolute -inset-4 bg-(--accent-color)/10 rounded-full blur-xl"></div>
          <i class="ri-cpu-line text-6xl text-(--accent-color) relative"></i>
        </div>
        <div class="flex flex-col ml-5">
          <h1 class="text-4xl font-bold text-(--text-primary) tracking-tight">ECOS Studio</h1>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-5 mb-16">
        <button @click="$emit('open-project')"
          class="group flex flex-col items-center gap-3 px-8 py-6 bg-(--bg-secondary) hover:bg-(--bg-sidebar) rounded-xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 border border-(--border-color) hover:border-(--accent-color) min-w-[180px] cursor-pointer shadow-sm hover:shadow-lg hover:shadow-(--accent-color)/5">
          <div
            class="w-14 h-14 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors">
            <i
              class="ri-book-open-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">Open Workspace</span>
        </button>

        <button @click="showWizard = true"
          class="group flex flex-col items-center gap-3 px-8 py-6 bg-(--bg-secondary) hover:bg-(--bg-sidebar) rounded-xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 border border-(--border-color) hover:border-(--accent-color) min-w-[180px] cursor-pointer shadow-sm hover:shadow-lg hover:shadow-(--accent-color)/5">
          <div
            class="w-14 h-14 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors">
            <i
              class="ri-folder-open-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">New Workspace</span>
        </button>

        <button @click="handleImportPdk"
          class="group flex flex-col items-center gap-3 px-8 py-6 bg-(--bg-secondary) hover:bg-(--bg-sidebar) rounded-xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 border border-(--border-color) hover:border-(--accent-color) min-w-[180px] cursor-pointer shadow-sm hover:shadow-lg hover:shadow-(--accent-color)/5">
          <div
            class="w-14 h-14 rounded-xl bg-(--bg-primary) flex items-center justify-center group-hover:bg-(--accent-color)/10 transition-colors">
            <i
              class="ri-database-2-line text-2xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors"></i>
          </div>
          <span class="text-sm font-medium text-(--text-primary)">Import PDK</span>
        </button>
      </div>

      <!-- 最近项目 -->
      <div class="w-full max-w-3xl px-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-(--text-primary) flex items-center gap-2">
            <i class="ri-time-line text-(--text-secondary)"></i>
            Recent Workspaces
          </h2>
          <button v-if="recentProjects.length > 3" @click="showAllProjects = !showAllProjects"
            class="text-sm text-(--accent-color) hover:opacity-80 transition-opacity cursor-pointer flex items-center gap-1">
            <template v-if="showAllProjects">
              Collapse
              <i class="ri-arrow-up-s-line"></i>
            </template>
            <template v-else>
              View All ({{ recentProjects.length }})
              <i class="ri-arrow-right-s-line"></i>
            </template>
          </button>
        </div>

        <div v-if="recentProjects.length === 0"
          class="text-center py-16 text-(--text-secondary) bg-(--bg-secondary)/50 rounded-xl border border-dashed border-(--border-color)">
          <i class="ri-folder-2-line text-5xl mb-4 opacity-30 block"></i>
          <p class="text-sm">No recent workspaces</p>
          <p class="text-xs mt-2 opacity-60">Click "New Workspace" to start your chip design journey</p>
        </div>

        <div v-else class="space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin">
          <div v-for="project in displayedProjects" :key="project.id"
            class="w-full flex items-center justify-between px-5 py-4 bg-(--bg-secondary) rounded-xl transition-all duration-200 border text-left group"
            :class="project.pathExists === false
              ? 'border-(--border-color) opacity-55 cursor-default'
              : 'border-(--border-color) hover:border-(--accent-color) hover:bg-(--bg-sidebar) cursor-pointer hover:shadow-md'"
            @click="project.pathExists !== false && $emit('open-recent', project)">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center transition-colors" :class="project.pathExists === false
                ? 'bg-red-500/10'
                : 'bg-(--accent-color)/10 group-hover:bg-(--accent-color)/20'">
                <i :class="project.pathExists === false
                  ? 'ri-folder-warning-line text-lg text-red-400'
                  : 'ri-folder-line text-lg text-(--accent-color)'"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium truncate"
                  :class="project.pathExists === false ? 'text-(--text-secondary)' : 'text-(--text-primary)'">
                  {{ project.name }}
                </p>
                <div class="flex items-center gap-2 mt-0.5">
                  <p class="text-xs text-(--text-secondary) truncate">{{ project.path }}</p>
                  <span v-if="project.pathExists === false"
                    class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                    Path not reachable
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs text-(--text-secondary) group-hover:text-(--text-primary) transition-colors whitespace-nowrap">
                {{ formatDate(project.lastOpened) }}
              </span>
              <!-- 删除按钮 -->
              <button @click.stop="$emit('remove-recent', project.id)"
                class="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer"
                title="Remove from list">
                <i class="ri-close-line text-sm text-(--text-secondary) hover:text-red-500"></i>
              </button>
              <i v-if="project.pathExists !== false"
                class="ri-arrow-right-s-line text-(--text-secondary) opacity-0 group-hover:opacity-100 transition-opacity"></i>
            </div>
          </div>
        </div>
      </div>

      <!-- 已导入的 PDK -->
      <div v-if="importedPdks.length > 0" class="w-full max-w-3xl px-4 mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-(--text-primary) flex items-center gap-2">
            <i class="ri-database-2-line text-(--text-secondary)"></i>
            Imported PDKS
          </h2>
        </div>
        <div class="flex flex-wrap gap-3 max-h-[120px] overflow-y-auto scrollbar-thin">
          <div v-for="pdk in importedPdks" :key="pdk.id"
            class="flex items-center gap-3 px-4 py-3 bg-(--bg-secondary) rounded-xl border border-(--border-color) group shrink-0">
            <div class="w-8 h-8 rounded-lg bg-(--accent-color)/10 flex items-center justify-center shrink-0">
              <i class="ri-cpu-line text-(--accent-color)"></i>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-medium text-(--text-primary) text-sm">{{ pdk.name }}</p>
                <span v-if="pdk.techNode"
                  class="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-color)/10 text-(--accent-color) font-medium">
                  {{ pdk.techNode }}
                </span>
              </div>
              <p class="text-[11px] text-(--text-secondary) truncate mt-0.5 max-w-[240px] font-mono opacity-60">{{
                pdk.path }}</p>
            </div>
            <button @click.stop="handleRemovePdk(pdk.id)"
              class="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer ml-2"
              title="Remove this PDK">
              <i class="ri-close-line text-sm text-(--text-secondary) hover:text-red-500"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- New Project Wizard Modal -->
    <NewProjectWizard v-if="showWizard" @close="showWizard = false" @create="handleWizardCreate" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Project, WorkspaceConfig } from '../types'
import NewProjectWizard from './NewProjectWizard.vue'
import { usePdkManager } from '../composables/usePdkManager'

interface Props {
  recentProjects?: Project[]
}

interface Emits {
  (e: 'open-project'): void
  (e: 'new-project', config?: WorkspaceConfig): void
  (e: 'import-project'): void
  (e: 'open-recent', project: Project): void
  (e: 'remove-recent', projectId: string): void
}

const emit = defineEmits<Emits>()

const showWizard = ref(false)
const showAllProjects = ref(false)

const props = withDefaults(defineProps<Props>(), {
  recentProjects: () => []
})

const displayedProjects = computed(() => {
  return showAllProjects.value ? props.recentProjects : props.recentProjects.slice(0, 3)
})

// PDK 管理
const { importedPdks, loadPdks, importPdk, removePdk } = usePdkManager()

onMounted(async () => {
  await loadPdks()
})

const handleImportPdk = async () => {
  await importPdk()
}

const handleRemovePdk = async (id: string) => {
  await removePdk(id)
}

const handleWizardCreate = (config: WorkspaceConfig) => {
  showWizard.value = false
  emit('new-project', config)
}

const formatDate = (date: Date) => {
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

<style scoped>
.welcome-gradient {
  background: radial-gradient(ellipse at 50% 30%, var(--accent-color) 0%, transparent 60%);
}
</style>
