import type { WorkspaceDirectoryReplacement } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { mutateProjectManifest } from '@/api/projectManifest'
import { waitForDesktopApi } from '@/platform/desktop'

interface WorkspaceReplacementToast {
  severity: 'warn'
  summary: string
  detail: string
  life: number
}

type Notify = (message: WorkspaceReplacementToast) => void

function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

export function workspaceParentPath(path: string): string {
  const normalized = normalizePath(path)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return normalized.startsWith('/') ? '/' : ''
  const parent = parts.slice(0, -1).join('/')
  return normalized.startsWith('/') ? `/${parent}` : parent
}

function rewriteReplacementPath(
  value: string | undefined,
  targetPath: string,
  backupPath: string,
): string | undefined {
  if (!value) return value
  const normalizedValue = normalizePath(value)
  const normalizedTarget = normalizePath(targetPath)
  if (normalizedValue === normalizedTarget) return normalizePath(backupPath)
  if (normalizedValue.startsWith(`${normalizedTarget}/`)) {
    return `${normalizePath(backupPath)}/${normalizedValue.slice(normalizedTarget.length + 1)}`
  }
  return value
}

function rewriteReplacementPathList(
  values: string[] | undefined,
  targetPath: string,
  backupPath: string,
): string[] | undefined {
  return values?.map(
    (value) => rewriteReplacementPath(value, targetPath, backupPath) ?? value,
  )
}

export function rewriteWorkspaceConfigPathsForReplacement(
  config: WorkspaceConfig,
  targetPath: string,
  backupPath: string,
): WorkspaceConfig {
  return {
    ...config,
    origin_def: rewriteReplacementPath(config.origin_def, targetPath, backupPath) ?? '',
    origin_verilog:
      rewriteReplacementPath(config.origin_verilog, targetPath, backupPath) ?? '',
    rtl_list: rewriteReplacementPathList(config.rtl_list, targetPath, backupPath) ?? [],
    filelist: rewriteReplacementPath(config.filelist, targetPath, backupPath),
    sdc: rewriteReplacementPath(config.sdc, targetPath, backupPath),
    pdk_json: rewriteReplacementPath(config.pdk_json, targetPath, backupPath),
  }
}

export async function recordWorkspaceReplacementBackup(
  replacement: WorkspaceDirectoryReplacement,
  config: WorkspaceConfig,
  notify: Notify,
): Promise<void> {
  const projectRoot = normalizePath(config.project_context?.project_root ?? '')

  if (!projectRoot) {
    const desktopApi = await waitForDesktopApi()
    await desktopApi.workspace.retainProjectDirectoryReplacement(replacement.id)
    return
  }

  try {
    await mutateProjectManifest(projectRoot, {
      type: 'record-replacement-backup',
      input: {
        replacementId: replacement.id,
        fallbackStartStep: config.flow_config?.start_step,
        fallbackEndStep: config.flow_config?.end_step,
      },
    })
  } catch (error) {
    console.warn('Failed to record workspace replacement backup:', error)
    try {
      const desktopApi = await waitForDesktopApi()
      await desktopApi.workspace.retainProjectDirectoryReplacement(replacement.id)
    } catch (retainError) {
      console.error('Failed to release workspace replacement backup:', retainError)
      const error = new Error('Failed to retain the workspace replacement backup.')
      Object.assign(error, { cause: retainError })
      throw error
    }
    notify({
      severity: 'warn',
      summary: 'Backup manifest not updated',
      detail:
        'The original workspace backup was kept, but project.json could not be updated.',
      life: 5000,
    })
  }
}
