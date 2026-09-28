import { computed, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { backgroundTaskIdentityLabel } from '@/components/backgroundTaskIdentity'
import { discoverProjectForWorkspace } from '@/utils/projectManagementRead'

// Top bar title, identical to the Background Tasks identity label
// ("{project} / {workspace}"). Resolved synchronously from the route query so
// the title does not depend on asynchronously restored workspace state; the
// project manifest owner (design_name) upgrades it once discovered. Routes
// outside the workspace shell show no title, so a stale workspace name never
// leaks into home pages such as Backend Design.
export function useWorkspaceTitle(options: {
  workspacePath: Ref<string | null | undefined>
  fallbackName: Ref<string | null | undefined>
}): Ref<string> {
  const route = useRoute()
  const manifestOwner = ref('')
  let resolutionToken = 0

  watch(
    () => normalizePath(options.workspacePath.value ?? ''),
    (workspacePath) => {
      const token = ++resolutionToken
      manifestOwner.value = ''
      if (!workspacePath) return
      void resolveManifestOwner(workspacePath).then((owner) => {
        if (token === resolutionToken) manifestOwner.value = owner
      })
    },
    { immediate: true },
  )

  return computed(() => {
    if (!route.path.startsWith('/workspace')) return ''
    const projectRoot = queryString(route.query.projectRoot)
    const projectName = queryString(route.query.projectName)
    const workspaceId = queryString(route.query.workspaceId)
    const identityPath = normalizePath(options.workspacePath.value ?? '') || workspaceId
    if (!identityPath) return projectName || options.fallbackName.value || ''
    return backgroundTaskIdentityLabel({
      owner: manifestOwner.value || projectName,
      projectRoot,
      workspacePath: identityPath,
    })
  })
}

async function resolveManifestOwner(workspacePath: string): Promise<string> {
  try {
    const manifest = await discoverProjectForWorkspace(workspacePath)
    const listed = manifest?.workspaces.some(
      (workspace) => normalizePath(workspace.workspace_path) === workspacePath,
    )
    return listed ? (manifest?.design_name || manifest?.name || '').trim() : ''
  } catch {
    return ''
  }
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}
