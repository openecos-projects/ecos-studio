import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  activatePdkApi,
  installResourceApi,
  listResourcesApi,
  removePdkReferenceApi,
  refreshRegistryApi,
  resourceListToTools,
  subscribeResourceProgress,
  uninstallResourceApi,
  updateResourceApi,
  validatePdkApi,
} from '@/api/plugin'
import type { InstallProgress, ResourceItem, ToolInfo } from '@/api/plugin'

export const usePluginStore = defineStore('plugin', () => {
  const resources = ref<ResourceItem[]>([])
  const tools = ref<ToolInfo[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const error = ref<string | null>(null)
  /** Per-tool install/uninstall errors so one failure does not block the rest of the list */
  const toolErrors = ref<Record<string, string>>({})
  const installProgress = ref<Record<string, InstallProgress>>({})
  const resourceErrors = ref<Record<string, string>>({})
  const resourceProgress = ref<Record<string, InstallProgress>>({})

  const _sseConnections = new Map<string, { close: () => void }>()

  const categories = computed(() => {
    const cats = new Set(tools.value.map((t) => t.category))
    return Array.from(cats).sort()
  })

  function _toolResourceId(toolName: string): string {
    return `tool:${toolName}`
  }

  function _resourceName(resourceId: string): string {
    const resource = resources.value.find((item) => item.id === resourceId)
    if (resource) {
      return resource.name
    }
    return resourceId.replace(/^(tool|pdk):/, '')
  }

  function _toolNameForResourceId(resourceId: string): string | null {
    const resource = resources.value.find((item) => item.id === resourceId)
    if (resource?.type === 'tool') {
      return resource.name
    }
    if (resourceId.startsWith('tool:')) {
      return resourceId.slice('tool:'.length)
    }
    return null
  }

  function _syncLegacyTools(): void {
    tools.value = resourceListToTools({ resources: resources.value, diagnostics: [] })
  }

  function _syncLegacyToolError(resourceId: string, message?: string): void {
    const toolName = _toolNameForResourceId(resourceId)
    if (!toolName) {
      return
    }
    if (message) {
      toolErrors.value[toolName] = message
      return
    }
    delete toolErrors.value[toolName]
  }

  function _syncLegacyToolProgress(resourceId: string, progress?: InstallProgress): void {
    const toolName = _toolNameForResourceId(resourceId)
    if (!toolName) {
      return
    }
    if (progress) {
      installProgress.value[toolName] = progress
      return
    }
    delete installProgress.value[toolName]
  }

  function _setResourceStatus(resourceId: string, status: ResourceItem['status']): void {
    const resource = resources.value.find((item) => item.id === resourceId)
    if (!resource) {
      return
    }
    resource.status = status
    if (status !== 'error') {
      resource.error = null
    }
    _syncLegacyTools()
  }

  function _setResourceError(resourceId: string, message: string): void {
    resourceErrors.value[resourceId] = message
    _syncLegacyToolError(resourceId, message)

    const resource = resources.value.find((item) => item.id === resourceId)
    if (!resource) {
      return
    }
    resource.status = 'error'
    resource.error = message
    _syncLegacyTools()
  }

  async function fetchTools(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent === true
    if (!silent) {
      loading.value = true
    }
    error.value = null
    try {
      const nextResources = await listResourcesApi()
      resources.value = nextResources
      _syncLegacyTools()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tools'
    } finally {
      if (!silent) {
        loading.value = false
      }
    }
  }

  function _subscribeResourceProgress(resourceId: string): void {
    _sseConnections.get(resourceId)?.close()

    const conn = subscribeResourceProgress(
      resourceId,
      (progress) => {
        resourceProgress.value[progress.resourceId] = progress
        _syncLegacyToolProgress(progress.resourceId, progress)

        if (progress.phase === 'done' || progress.phase === 'error') {
          conn.close()
          _sseConnections.delete(resourceId)
          delete resourceProgress.value[progress.resourceId]
          _syncLegacyToolProgress(progress.resourceId)
          if (progress.phase === 'done') {
            delete resourceErrors.value[progress.resourceId]
            _syncLegacyToolError(progress.resourceId)
          } else {
            _setResourceError(progress.resourceId, progress.message || 'Installation failed')
          }
          void fetchTools({ silent: true })
        }
      },
      () => {
        _sseConnections.delete(resourceId)
      },
    )
    _sseConnections.set(resourceId, conn)
  }

  async function installResource(resourceId: string, version?: string): Promise<void> {
    delete resourceErrors.value[resourceId]
    _syncLegacyToolError(resourceId)
    _setResourceStatus(resourceId, 'installing')
    _subscribeResourceProgress(resourceId)
    try {
      await installResourceApi(resourceId, version)
    } catch (e) {
      _sseConnections.get(resourceId)?.close()
      _sseConnections.delete(resourceId)
      delete resourceProgress.value[resourceId]
      _syncLegacyToolProgress(resourceId)
      _setResourceError(
        resourceId,
        e instanceof Error ? e.message : `Failed to install ${_resourceName(resourceId)}`,
      )
    }
  }

  async function updateResource(resourceId: string): Promise<void> {
    delete resourceErrors.value[resourceId]
    _syncLegacyToolError(resourceId)
    _setResourceStatus(resourceId, 'installing')
    _subscribeResourceProgress(resourceId)
    try {
      await updateResourceApi(resourceId)
    } catch (e) {
      _sseConnections.get(resourceId)?.close()
      _sseConnections.delete(resourceId)
      delete resourceProgress.value[resourceId]
      _syncLegacyToolProgress(resourceId)
      _setResourceError(
        resourceId,
        e instanceof Error ? e.message : `Failed to update ${_resourceName(resourceId)}`,
      )
    }
  }

  async function uninstallResource(resourceId: string): Promise<void> {
    delete resourceErrors.value[resourceId]
    _syncLegacyToolError(resourceId)
    const resource = resources.value.find((item) => item.id === resourceId)
    const prevStatus = resource?.status
    const prevError = resource?.error ?? null
    try {
      await uninstallResourceApi(resourceId)
      if (resource) {
        resource.status = resource.type === 'tool' ? 'uninstalling' : 'removing'
        resource.error = null
        _syncLegacyTools()
      }
      await fetchTools({ silent: true })
    } catch (e) {
      _setResourceError(
        resourceId,
        e instanceof Error ? e.message : `Failed to uninstall ${_resourceName(resourceId)}`,
      )
      if (resource && prevStatus) {
        resource.status = prevStatus
        resource.error = prevError
        _syncLegacyTools()
      }
      await fetchTools({ silent: true })
    }
  }

  async function install(name: string, version?: string): Promise<void> {
    await installResource(_toolResourceId(name), version)
  }

  async function uninstall(name: string): Promise<void> {
    await uninstallResource(_toolResourceId(name))
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
    resourceErrors,
    resourceProgress,
    categories,
    fetchTools,
    installResource,
    updateResource,
    uninstallResource,
    install,
    uninstall,
    activatePdk,
    validatePdk,
    removePdkReference,
    refresh,
    cleanup,
  }
})
