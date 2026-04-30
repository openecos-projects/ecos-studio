<template>
  <div
    class="ecos-home-surface flex flex-col h-full w-full min-h-0 text-(--text-primary) relative overflow-y-auto overflow-x-hidden"
  >
    <div
      class="relative z-10 flex flex-col w-full min-h-fit px-6 pt-7 pb-10 sm:pt-8"
    >
      <div class="w-full max-w-6xl mx-auto flex flex-col">
      <!-- Hero -->
      <header class="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div class="flex flex-col sm:flex-row sm:items-center gap-5 text-center sm:text-left">
          <div class="relative shrink-0 mx-auto sm:mx-0">
            <div
              class="absolute -inset-3 bg-(--accent-color)/10 rounded-2xl blur-xl motion-reduce:blur-none"
              aria-hidden="true"
            />
            <div
              class="relative w-16 h-16 rounded-2xl bg-(--bg-secondary) border border-(--border-color) flex items-center justify-center shadow-lg shadow-black/10"
            >
              <i class="ri-cpu-line text-3xl text-(--accent-color)" aria-hidden="true" />
            </div>
          </div>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-widest text-(--text-secondary) mb-1">
              Welcome
            </p>
            <h1 class="text-3xl sm:text-4xl font-bold text-(--text-primary) tracking-tight">
              ECOS Studio
            </h1>
            <p class="text-sm text-(--text-secondary) mt-2 max-w-md">
              Chip design flows from RTL to GDS — open a project or pick a tool below.
            </p>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-4 py-2.5 mt-6 sm:mt-0 rounded-xl border border-(--border-color) bg-(--bg-secondary) text-sm font-medium text-(--text-primary) hover:border-(--accent-color) hover:shadow-md hover:shadow-(--accent-color)/5 transition-all duration-200 cursor-pointer shrink-0 w-full sm:w-auto"
          @click="navigateToProjects"
        >
          <i class="ri-folder-settings-line text-lg text-(--accent-color)" aria-hidden="true" />
          Project Management
          <i class="ri-arrow-right-s-line text-base text-(--text-secondary)" aria-hidden="true" />
        </button>
      </header>

      <!-- Bento: design tools -->
      <section class="mb-8" aria-labelledby="design-tools-heading">
        <h2
          id="design-tools-heading"
          class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider mb-4"
        >
          Design tools
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <article
            class="relative flex flex-col overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary) min-h-[130px]"
          >
            <div class="relative z-0 flex flex-col p-6 opacity-[0.38]">
              <div
                class="w-11 h-11 rounded-xl bg-(--bg-primary) border border-(--border-color) flex items-center justify-center mb-4"
              >
                <i class="ri-code-s-slash-line text-xl text-(--text-secondary)" aria-hidden="true" />
              </div>
              <h3 class="text-sm font-semibold text-(--text-primary)">Frontend Design</h3>
              <p class="text-xs text-(--text-secondary) mt-1">RTL / Verilog / SystemVerilog</p>
            </div>
            <div
              class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/15"
              aria-hidden="true"
            >
              <span
                class="rounded-full bg-zinc-800/95 px-3 py-1.5 text-xs font-medium text-zinc-400"
              >
                Coming Soon
              </span>
            </div>
          </article>

          <article
            class="relative flex flex-col overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary) min-h-[130px]"
          >
            <div class="relative z-0 flex flex-col p-6 opacity-[0.38]">
              <div
                class="w-11 h-11 rounded-xl bg-(--bg-primary) border border-(--border-color) flex items-center justify-center mb-4"
              >
                <i class="ri-cpu-line text-xl text-(--text-secondary)" aria-hidden="true" />
              </div>
              <h3 class="text-sm font-semibold text-(--text-primary)">SoC</h3>
              <p class="text-xs text-(--text-secondary) mt-1">RetroSoC</p>
            </div>
            <div
              class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/15"
              aria-hidden="true"
            >
              <span
                class="rounded-full bg-zinc-800/95 px-3 py-1.5 text-xs font-medium text-zinc-400"
              >
                Coming Soon
              </span>
            </div>
          </article>

          <button
            type="button"
            class="group flex flex-col rounded-2xl border border-(--border-color) bg-(--bg-secondary) p-6 min-h-[130px] text-left transition-all duration-200 cursor-pointer hover:border-(--accent-color) hover:shadow-lg hover:shadow-(--accent-color)/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)"
            @click="navigateToECC"
          >
            <div
              class="w-11 h-11 rounded-xl bg-(--accent-color)/10 border border-(--accent-color)/20 flex items-center justify-center mb-4 transition-colors duration-200 group-hover:bg-(--accent-color)/15"
            >
              <i class="ri-cpu-line text-xl text-(--accent-color)" aria-hidden="true" />
            </div>
            <h3 class="text-sm font-semibold text-(--text-primary)">Backend Design</h3>
            <p class="text-xs text-(--text-secondary) mt-1">Synthesis → P&amp;R → GDS</p>
            <span
              class="mt-auto pt-4 text-xs font-medium text-(--accent-color) inline-flex items-center gap-1"
            >
              Open flow
              <i class="ri-arrow-right-line text-sm transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </button>
        </div>
      </section>

      <!-- Resources + Explore -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <section aria-labelledby="resources-heading">
          <h2
            id="resources-heading"
            class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider mb-4"
          >
            Resources
          </h2>
          <div class="space-y-3">
            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-(--border-color) bg-(--bg-secondary) transition-colors duration-200 cursor-default text-left opacity-50"
              disabled
            >
              <i class="ri-puzzle-line text-lg text-(--text-secondary)" aria-hidden="true" />
              <span class="text-sm text-(--text-primary)">IP Catalog</span>
            </button>

            <!-- PDK Manager -->
            <div class="rounded-2xl border border-(--border-color) bg-(--bg-secondary) overflow-hidden">
              <div class="flex items-center justify-between px-4 py-3.5">
                <div class="flex items-center gap-2 min-w-0">
                  <i class="ri-database-2-line text-lg text-(--text-secondary) shrink-0" aria-hidden="true" />
                  <span class="text-sm font-medium text-(--text-primary) truncate">PDK Manager</span>
                  <span v-if="importedPdks.length > 0" class="text-[10px] text-(--text-secondary) shrink-0">
                    ({{ importedPdks.length }})
                  </span>
                </div>
                <button
                  type="button"
                  class="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-(--accent-color) hover:bg-(--accent-color)/10 transition-colors duration-200 cursor-pointer"
                  @click="handleImportPdk"
                >
                  <i class="ri-add-line text-sm" aria-hidden="true" />
                  Import
                </button>
              </div>
              <div v-if="importedPdks.length > 0" class="border-t border-(--border-color)">
                <div
                  v-for="pdk in importedPdks"
                  :key="pdk.id"
                  class="flex items-center gap-3 px-4 py-2.5 hover:bg-(--bg-primary)/50 transition-colors duration-200 group"
                >
                  <div
                    class="w-7 h-7 rounded-lg bg-(--accent-color)/10 flex items-center justify-center shrink-0"
                  >
                    <i class="ri-cpu-line text-xs text-(--accent-color)" aria-hidden="true" />
                  </div>
                  <span class="text-sm text-(--text-primary) truncate flex-1">{{ pdk.name }}</span>
                  <span
                    v-if="pdk.techNode"
                    class="text-[9px] px-1.5 py-0.5 rounded-md bg-(--accent-color)/10 text-(--accent-color) font-medium shrink-0"
                  >
                    {{ pdk.techNode }}
                  </span>
                  <button
                    type="button"
                    class="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all duration-200 cursor-pointer"
                    title="Remove this PDK"
                    @click.stop="handleRemovePdk(pdk.id)"
                  >
                    <i class="ri-close-line text-xs text-(--text-secondary) hover:text-red-400" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div v-else class="px-4 py-3 border-t border-(--border-color)">
                <p class="text-xs text-(--text-secondary) opacity-70">No PDKs imported yet</p>
              </div>
            </div>

            <!-- Resource Manager → dedicated route -->
            <button
              type="button"
              class="group w-full flex items-center gap-4 px-4 py-4 rounded-2xl border border-(--border-color) bg-(--bg-secondary) text-left transition-all duration-200 cursor-pointer hover:border-(--accent-color) hover:shadow-md hover:shadow-(--accent-color)/6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)"
              @click="navigateToTools"
            >
              <div
                class="w-12 h-12 rounded-xl bg-(--accent-color)/10 border border-(--accent-color)/15 flex items-center justify-center shrink-0"
              >
                <i class="ri-tools-line text-xl text-(--accent-color)" aria-hidden="true" />
              </div>
              <div class="flex-1 min-w-0">
                <span class="text-sm font-semibold text-(--text-primary) block">Resource Manager</span>
                <span class="text-xs text-(--text-secondary) line-clamp-2">
                  Discover, install, and manage EDA tools and PDKs
                </span>
              </div>
              <i
                class="ri-arrow-right-s-line text-xl text-(--text-secondary) group-hover:text-(--accent-color) transition-colors duration-200 shrink-0"
                aria-hidden="true"
              />
            </button>
          </div>
        </section>

        <section aria-labelledby="explore-heading">
          <h2
            id="explore-heading"
            class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider mb-4"
          >
            Explore
          </h2>
          <div class="space-y-3">
            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-(--border-color) bg-(--bg-secondary) transition-colors duration-200 cursor-default text-left opacity-50"
              disabled
            >
              <i class="ri-bar-chart-box-line text-lg text-(--text-secondary)" aria-hidden="true" />
              <span class="text-sm text-(--text-primary)">Benchmarks</span>
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-(--border-color) bg-(--bg-secondary) transition-colors duration-200 cursor-default text-left opacity-50"
              disabled
            >
              <i class="ri-book-open-line text-lg text-(--text-secondary)" aria-hidden="true" />
              <span class="text-sm text-(--text-primary)">Documentation</span>
            </button>
          </div>
        </section>
      </div>

      <!-- Recent project -->
      <div class="flex flex-col gap-4">
        <div v-if="lastProject">
          <button
            type="button"
            class="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-(--border-color) bg-(--bg-secondary) transition-all duration-200 text-left cursor-pointer group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)"
            :class="
              lastProject.workspaceRecognized === false
                ? 'opacity-50 pointer-events-none'
                : 'hover:border-(--accent-color) hover:shadow-lg hover:shadow-(--accent-color)/6'
            "
            @click="handleResume"
          >
            <div
              class="w-12 h-12 rounded-xl bg-(--accent-color)/10 flex items-center justify-center shrink-0 group-hover:bg-(--accent-color)/20 transition-colors duration-200"
            >
              <i class="ri-folder-line text-xl text-(--accent-color)" aria-hidden="true" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-(--text-primary) truncate">{{ lastProject.name }}</span>
                <span
                  v-if="lastProject.pdk"
                  class="text-[10px] px-1.5 py-0.5 rounded-md bg-(--accent-color)/10 text-(--accent-color) font-medium shrink-0"
                >
                  {{ lastProject.pdk }}
                </span>
                <span
                  v-if="lastProject.status"
                  :class="statusBadgeClass(lastProject.status)"
                  class="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
                >
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
            <div
              class="flex items-center gap-1 text-(--text-secondary) group-hover:text-(--accent-color) transition-colors duration-200 shrink-0 text-sm font-medium"
            >
              Resume
              <i class="ri-arrow-right-line" aria-hidden="true" />
            </div>
          </button>
        </div>

      </div>
      </div>
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
const navigateToTools = () => router.push('/tools')

const handleImportPdk = async () => {
  await importPdk()
}

const handleRemovePdk = async (id: string) => {
  await removePdk(id)
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

<style scoped>
.ecos-home-surface {
  background:
    radial-gradient(circle at 46% 16%, color-mix(in srgb, var(--accent-color) 10%, transparent) 0, transparent 32%),
    linear-gradient(color-mix(in srgb, var(--border-color) 45%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 45%, transparent) 1px, transparent 1px),
    var(--bg-primary);
  background-size: auto, 50px 50px, 50px 50px, auto;
  background-position: center top, -2px -2px, -2px -2px, center;
}

.ecos-home-surface::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 18%, transparent), transparent 28%),
    radial-gradient(circle at 50% 50%, transparent 0, color-mix(in srgb, var(--bg-primary) 72%, transparent) 72%);
}

:global(.dark) .ecos-home-surface {
  background:
    radial-gradient(circle at 46% 16%, color-mix(in srgb, var(--accent-color) 13%, transparent) 0, transparent 34%),
    linear-gradient(color-mix(in srgb, var(--border-color) 52%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 52%, transparent) 1px, transparent 1px),
    var(--bg-primary);
  background-size: auto, 50px 50px, 50px 50px, auto;
}
</style>
