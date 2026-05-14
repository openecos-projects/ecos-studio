<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** embedded: home sidebar card; page: full route, scroll fills viewport */
    layout?: 'embedded' | 'page'
  }>(),
  { layout: 'embedded' },
)
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { usePluginStore } from '@/stores/pluginStore'
import type { InstallProgress, ToolInfo } from '@/api/plugin'

const pluginStore = usePluginStore()

const searchQuery = ref('')
const selectedCategory = ref<string | null>(null)

const filteredTools = computed(() => {
  let result = pluginStore.tools
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.display_name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    )
  }
  if (selectedCategory.value) {
    result = result.filter((t) => t.category === selectedCategory.value)
  }
  return result
})

function statusSeverity(status: string): 'success' | 'warn' | 'info' | 'danger' | 'secondary' {
  switch (status) {
    case 'installed':
      return 'success'
    case 'installing':
    case 'uninstalling':
      return 'warn'
    case 'update_available':
      return 'info'
    case 'error':
      return 'danger'
    default:
      return 'secondary'
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function getProgress(tool: ToolInfo): InstallProgress | undefined {
  return pluginStore.installProgress[tool.name]
}

function toolError(tool: ToolInfo): string | undefined {
  return pluginStore.toolErrors[tool.name]
}

async function handleInstall(tool: ToolInfo): Promise<void> {
  await pluginStore.install(tool.name)
}

async function handleUninstall(tool: ToolInfo): Promise<void> {
  await pluginStore.uninstall(tool.name)
}

onMounted(() => {
  void pluginStore.fetchTools()
})

onUnmounted(() => {
  pluginStore.cleanup()
})
</script>

<template>
  <div
    :class="[
      'bg-(--bg-secondary) rounded-xl border border-(--border-color) overflow-hidden transition-colors duration-200',
      props.layout === 'page' ? 'flex flex-col flex-1 min-h-0 h-full' : '',
    ]"
  >
    <div class="flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2 min-w-0">
        <i class="ri-tools-line text-lg text-(--text-secondary) shrink-0" aria-hidden="true" />
        <span class="text-sm font-medium text-(--text-primary) truncate">EDA Tools</span>
      </div>
      <button
        type="button"
        :disabled="pluginStore.refreshing"
        class="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-(--accent-color) hover:bg-(--accent-color)/10 transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        @click="pluginStore.refresh()"
      >
        <i
          :class="[
            'text-sm',
            pluginStore.refreshing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line',
          ]"
          aria-hidden="true"
        />
        Refresh
      </button>
    </div>

    <div
      :class="[
        'px-4 pb-3 space-y-3 border-t border-(--border-color) pt-3',
        props.layout === 'page' ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : '',
      ]"
    >
      <InputText
        v-model="searchQuery"
        placeholder="Search tools..."
        class="w-full text-sm"
        size="small"
      />

      <div class="flex flex-wrap gap-1">
        <Button
          :severity="selectedCategory === null ? 'primary' : 'secondary'"
          label="All"
          size="small"
          class="cursor-pointer transition-colors duration-200"
          @click="selectedCategory = null"
        />
        <Button
          v-for="cat in pluginStore.categories"
          :key="cat"
          :severity="selectedCategory === cat ? 'primary' : 'secondary'"
          :label="cat"
          size="small"
          class="cursor-pointer transition-colors duration-200"
          @click="selectedCategory = cat"
        />
      </div>

      <div v-if="pluginStore.loading" class="flex justify-center py-6">
        <i class="ri-loader-4-line animate-spin text-2xl text-(--accent-color)" aria-hidden="true" />
      </div>

      <p v-else-if="pluginStore.error" class="text-sm text-red-400 text-center py-2">
        {{ pluginStore.error }}
      </p>

      <div
        v-else
        :class="[
          'grid grid-cols-1 gap-3 overflow-y-auto pr-1 items-start content-start',
          props.layout === 'page'
            ? 'flex-1 min-h-0 max-h-none'
            : 'max-h-[min(420px,50vh)]',
        ]"
      >
        <div
          v-for="tool in filteredTools"
          :key="tool.name"
          class="rounded-lg border border-(--border-color) bg-(--bg-primary)/40 p-3 flex flex-col gap-2 transition-colors duration-200 w-full self-start"
        >
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h4 class="text-sm font-medium text-(--text-primary)">{{ tool.display_name }}</h4>
              <p class="text-xs text-(--text-secondary) mt-0.5 line-clamp-2">{{ tool.description }}</p>
            </div>
            <!-- 状态 + 操作在同一列，避免整行宽按钮被撑到面板底部、看起来像「全局安装」 -->
            <div class="flex flex-row sm:flex-col items-center sm:items-end gap-2 shrink-0">
              <Tag
                :value="statusLabel(tool.status)"
                :severity="statusSeverity(tool.status)"
                class="text-xs"
              />
              <Button
                v-if="tool.status === 'available'"
                size="small"
                class="cursor-pointer transition-colors duration-200 whitespace-nowrap"
                @click="handleInstall(tool)"
              >
                <span class="inline-flex items-center justify-center gap-1.5">
                  <i class="ri-download-line" aria-hidden="true" />
                  Install
                </span>
              </Button>
              <Button
                v-else-if="tool.status === 'installed'"
                severity="danger"
                variant="outlined"
                size="small"
                class="cursor-pointer transition-colors duration-200 whitespace-nowrap"
                @click="handleUninstall(tool)"
              >
                <span class="inline-flex items-center justify-center gap-1.5">
                  <i class="ri-delete-bin-line" aria-hidden="true" />
                  Uninstall
                </span>
              </Button>
              <Button
                v-else-if="tool.status === 'update_available'"
                severity="info"
                size="small"
                class="cursor-pointer transition-colors duration-200 whitespace-nowrap"
                @click="handleInstall(tool)"
              >
                <span class="inline-flex items-center justify-center gap-1.5">
                  <i class="ri-refresh-line" aria-hidden="true" />
                  Update
                </span>
              </Button>
              <Button
                v-else-if="tool.status === 'installing'"
                severity="warn"
                size="small"
                disabled
                class="whitespace-nowrap"
              >
                <span class="inline-flex items-center justify-center gap-1.5">
                  <i class="ri-loader-4-line animate-spin" aria-hidden="true" />
                  Installing
                </span>
              </Button>
              <Button
                v-else-if="tool.status === 'uninstalling'"
                severity="warn"
                size="small"
                disabled
                class="whitespace-nowrap"
              >
                <span class="inline-flex items-center justify-center gap-1.5">
                  <i class="ri-loader-4-line animate-spin" aria-hidden="true" />
                  Uninstalling
                </span>
              </Button>
              <Button
                v-else-if="tool.status === 'error'"
                severity="danger"
                size="small"
                class="cursor-pointer transition-colors duration-200 whitespace-nowrap"
                @click="handleInstall(tool)"
              >
                <span class="inline-flex items-center justify-center gap-1.5">
                  <i class="ri-restart-line" aria-hidden="true" />
                  Retry
                </span>
              </Button>
            </div>
          </div>

          <div class="flex items-center gap-2 text-[11px] text-(--text-secondary)">
            <Tag :value="tool.category" severity="secondary" class="text-[10px]" />
            <span v-if="tool.installed_version">v{{ tool.installed_version }}</span>
            <span v-else-if="tool.available_versions.length">Latest: v{{ tool.available_versions[0] }}</span>
          </div>

          <div v-if="getProgress(tool)" class="flex flex-col gap-1">
            <ProgressBar
              :value="Math.round((getProgress(tool)!.progress || 0) * 100)"
              :show-value="true"
              class="h-1.5"
            />
            <span class="text-[11px] text-(--text-secondary)">{{ getProgress(tool)!.message }}</span>
          </div>

          <p v-if="toolError(tool)" class="text-[11px] text-red-400/90 leading-snug">
            {{ toolError(tool) }}
          </p>
        </div>
      </div>

      <p
        v-if="!pluginStore.loading && !pluginStore.error && filteredTools.length === 0"
        class="text-center text-xs text-(--text-secondary) opacity-70 py-4"
      >
        No tools found.
      </p>
    </div>
  </div>
</template>
