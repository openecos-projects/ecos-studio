import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  activatePdkApi,
  installToolApi,
  listResourcesApi,
  removePdkReferenceApi,
  refreshRegistryApi,
  subscribePluginProgress,
  uninstallToolApi,
  validatePdkApi,
} from '@/api/plugin'
import type { InstallProgress, ResourceInfo, ToolInfo } from '@/api/plugin'

export const usePluginStore = defineStore('plugin', () => {
  const resources = ref<ResourceInfo[]>([])
  const tools = ref<ToolInfo[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const error = ref<string | null>(null)
  /** Per-tool install/uninstall errors so one failure does not block the rest of the list */
  const toolErrors = ref<Record<string, string>>({})
  const installProgress = ref<Record<string, InstallProgress>>({})

  const _sseConnections = new Map<string, { close: () => void }>()

  const categories = computed(() => {
    const cats = new Set(tools.value.map((t) => t.category))
    return Array.from(cats).sort()
  })

  async function fetchTools(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent === true
    if (!silent) {
      loading.value = true
    }
    error.value = null
    try {
      const nextResources = await listResourcesApi()
      resources.value = nextResources
      tools.value = nextResources
        .filter((resource) => resource.type === 'tool')
        .map((resource) => ({
          name: resource.name,
          display_name: resource.display_name,
          description: resource.description,
          category: resource.category,
          status: resource.status as ToolInfo['status'],
          installed_version: resource.installed_version,
          available_versions: resource.available_versions,
          install_path: resource.path,
        }))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tools'
    } finally {
      if (!silent) {
        loading.value = false
      }
    }
  }

  function _subscribeProgress(toolName: string): void {
    _sseConnections.get(toolName)?.close()

    const conn = subscribePluginProgress(
      toolName,
      (progress) => {
        installProgress.value[toolName] = progress

        if (progress.phase === 'done' || progress.phase === 'error') {
          conn.close()
          _sseConnections.delete(toolName)
          delete installProgress.value[toolName]
          if (progress.phase === 'done') {
            delete toolErrors.value[toolName]
          } else {
            toolErrors.value[toolName] = progress.message || 'Installation failed'
          }
          void fetchTools({ silent: true })
        }
      },
      () => {
        _sseConnections.delete(toolName)
      },
    )
    _sseConnections.set(toolName, conn)
  }

  async function install(name: string, version?: string): Promise<void> {
    delete toolErrors.value[name]
    try {
      await installToolApi(name, version)
      const tool = tools.value.find((t) => t.name === name)
      if (tool) {
        tool.status = 'installing'
      }
      _subscribeProgress(name)
    } catch (e) {
      toolErrors.value[name] = e instanceof Error ? e.message : `Failed to install ${name}`
    }
  }

  async function uninstall(name: string): Promise<void> {
    delete toolErrors.value[name]
    const tool = tools.value.find((t) => t.name === name)
    const prevStatus = tool?.status
    if (tool) {
      tool.status = 'uninstalling'
    }
    try {
      await uninstallToolApi(name)
      await fetchTools({ silent: true })
    } catch (e) {
      toolErrors.value[name] = e instanceof Error ? e.message : `Failed to uninstall ${name}`
      if (tool && prevStatus) {
        tool.status = prevStatus
      }
      await fetchTools({ silent: true })
    }
  }

  async function activatePdk(resourceId: string): Promise<void> {
    await activatePdkApi(resourceId)
    await fetchTools({ silent: true })
  }

  async function validatePdk(resourceId: string): Promise<void> {
    await validatePdkApi(resourceId)
    await fetchTools({ silent: true })
  }

  async function removePdkReference(resourceId: string): Promise<void> {
    await removePdkReferenceApi(resourceId)
    await fetchTools({ silent: true })
  }

  async function refresh(): Promise<void> {
    refreshing.value = true
    error.value = null
    try {
      await refreshRegistryApi()
      await fetchTools({ silent: true })
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to refresh registry'
    } finally {
      refreshing.value = false
    }
  }

  function cleanup(): void {
    for (const conn of _sseConnections.values()) {
      conn.close()
    }
    _sseConnections.clear()
  }

  return {
    resources,
    tools,
    loading,
    refreshing,
    error,
    toolErrors,
    installProgress,
    categories,
    fetchTools,
    install,
    uninstall,
    activatePdk,
    validatePdk,
    removePdkReference,
    refresh,
    cleanup,
  }
})
