import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  applyFrontendProjectManifestMutation,
  parseProjectManifest,
  recordReplacementBackupInManifest,
  registerWorkspaceInManifest,
  serializeProjectManifest,
  type ProjectManifest,
  type ProjectManifestMutation,
  type WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'
import type {
  ProjectManifestReplacementProvider,
  ProjectManifestScopeProvider,
} from './projectManifestService'

const MAX_MANIFEST_BYTES = 512 * 1024

export class FrontendProjectManifestService {
  constructor(
    private readonly scope: ProjectManifestScopeProvider,
    private readonly replacements?: ProjectManifestReplacementProvider,
  ) {}

  async load(projectRoot: string): Promise<ProjectManifest | null> {
    const root = await this.scope.resolveProjectRoot(projectRoot)
    const content = await readOptionalManifest(join(root, 'project.json'))
    if (content === null) return null
    const header: unknown = JSON.parse(content)
    if (
      typeof header !== 'object' ||
      header === null ||
      !('project_type' in header) ||
      header.project_type !== 'frontend'
    )
      return null
    const manifest = parseProjectManifest(content)
    if (relative(resolve(manifest.root_path), root) !== '') {
      throw new Error('Project manifest root_path does not match its directory.')
    }
    return manifest
  }

  async discover(directory: string): Promise<ProjectManifest | null> {
    const candidate = await this.scope.resolveProjectRoot(directory)
    for (const root of [candidate, dirname(candidate)]) {
      const manifest = await this.load(root)
      if (
        manifest &&
        (candidate === root ||
          manifest.workspaces.some(
            (workspace) => resolve(root, workspace.workspace_path) === candidate,
          ))
      )
        return manifest
    }
    return null
  }

  async importWorkspace(
    projectRoot: string,
    workspacePath: string,
    workspaceId: string,
  ): Promise<ProjectManifest> {
    const root = await this.scope.resolveProjectRoot(projectRoot)
    const canonicalWorkspace = await realpath(workspacePath)
    if (!(await stat(canonicalWorkspace)).isDirectory()) {
      throw new Error('Frontend workspace path must be a directory.')
    }
    if (basename(canonicalWorkspace) !== workspaceId) {
      throw new Error('Frontend workspace ID does not match its directory.')
    }
    const flow = await readOptionalManifest(join(canonicalWorkspace, 'home/flow.json'))
    const parameters = await readOptionalManifest(
      join(canonicalWorkspace, 'home/parameters.json'),
    )
    if (!flow || !parameters) {
      throw new Error('Frontend workspace must contain flow.json and parameters.json.')
    }
    const flowData: unknown = JSON.parse(flow)
    const configData: unknown = JSON.parse(parameters)
    if (
      typeof flowData !== 'object' ||
      flowData === null ||
      !('steps' in flowData) ||
      !Array.isArray(flowData.steps) ||
      typeof configData !== 'object' ||
      configData === null ||
      !('Design Tool' in configData) ||
      configData['Design Tool'] !== 'frontend'
    )
      throw new Error('The selected workspace does not have a frontend configuration.')
    const manifest = await this.load(root)
    if (!manifest) throw new Error('Frontend project manifest does not exist.')
    if (manifest.workspaces.some((workspace) => workspace.workspace_id === workspaceId)) {
      throw new Error(`Workspace ID ${workspaceId} is already registered.`)
    }
    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot: root,
      workspacePath: canonicalWorkspace,
      config: { parameters: configData as Record<string, unknown> },
    })
    await writeManifestAtomically(
      join(root, 'project.json'),
      serializeProjectManifest(updated),
    )
    return updated
  }

  async mutate(
    projectRoot: string,
    mutation: ProjectManifestMutation,
  ): Promise<{ manifest: ProjectManifest; cleanupPending?: boolean }> {
    const root = await this.scope.resolveProjectRoot(projectRoot)
    const path = join(root, 'project.json')
    const existingContent = await readOptionalManifest(path)
    const existing = existingContent ? parseProjectManifest(existingContent) : null
    if (existing && existing.project_type !== 'frontend') {
      throw new Error('Backend project manifests are owned by ECC.')
    }
    if (mutation.type === 'create' && existingContent !== null) {
      throw new Error('Project manifest already exists.')
    }
    if (mutation.type !== 'create' && !existing) {
      throw new Error('Frontend project manifest does not exist.')
    }
    if (mutation.type === 'create' && mutation.projectType !== 'frontend') {
      throw new Error('Frontend project creation requires project_type frontend.')
    }
    if (mutation.type === 'select-qor-baseline') {
      throw new Error('Frontend QoR baselines are not supported.')
    }
    if (mutation.type === 'import-workspace') {
      throw new Error('Frontend workspace import requires scoped path validation.')
    }
    let directoryReplacement: WorkspaceDirectoryReplacement | null = null
    if (mutation.type === 'delete-workspace' && mutation.deleteDirectory) {
      const workspace = existing?.workspaces.find(
        (candidate) => candidate.workspace_id === mutation.workspaceId,
      )
      if (workspace) {
        if (!this.replacements) {
          throw new Error('Workspace directory deletion is unavailable.')
        }
        const workspacePath = resolve(root, workspace.workspace_path)
        if (!isPathWithinRoot(workspacePath, root) || workspacePath === root) {
          throw new Error('Cannot delete a workspace directory outside the project.')
        }
        directoryReplacement =
          await this.replacements.prepareManagedProjectWorkspaceDirectoryReplacement(
            root,
            workspace.workspace_id,
            workspacePath,
          )
      }
    }
    let updated: ProjectManifest
    if (mutation.type === 'record-replacement-backup') {
      const replacement = this.replacements?.getProjectDirectoryReplacement(
        mutation.input.replacementId,
      )
      if (
        !replacement ||
        replacement.projectRoot !== root ||
        !isPathWithinRoot(replacement.backupPath, root) ||
        !isPathWithinRoot(replacement.targetPath, root)
      )
        throw new Error('Workspace replacement does not belong to this project.')
      updated = recordReplacementBackupInManifest(existing!, {
        backupPath: replacement.backupPath,
        targetPath: replacement.targetPath,
        fallbackStartStep: mutation.input.fallbackStartStep,
        fallbackEndStep: mutation.input.fallbackEndStep,
      })
      await this.replacements!.setProjectDirectoryReplacementRecoveryMode(
        mutation.input.replacementId,
        'retain',
      )
    } else {
      updated = applyFrontendProjectManifestMutation(existing, root, mutation)
    }
    if (updated.project_type !== 'frontend') {
      throw new Error('Frontend project mutation changed the project type.')
    }
    try {
      if (directoryReplacement) {
        await this.replacements!.setProjectDirectoryReplacementRecoveryMode(
          directoryReplacement.id,
          'delete',
        )
      }
      await writeManifestAtomically(path, serializeProjectManifest(updated))
    } catch (error) {
      if (directoryReplacement) {
        await this.replacements!.restoreProjectDirectoryReplacement(
          directoryReplacement.id,
        ).catch(() => undefined)
      }
      throw error
    }
    try {
      if (directoryReplacement) {
        await this.replacements!.finalizeProjectDirectoryReplacement(
          directoryReplacement.id,
        )
      }
      if (mutation.type === 'record-replacement-backup') {
        await this.replacements!.retainProjectDirectoryReplacement(
          mutation.input.replacementId,
        )
      }
    } catch {
      return { manifest: updated, cleanupPending: true }
    }
    return { manifest: updated }
  }
}

async function readOptionalManifest(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null
    throw error
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) {
      throw new Error('Project manifest must be a bounded regular file.')
    }
    return await handle.readFile({ encoding: 'utf8' })
  } finally {
    await handle.close()
  }
}

async function writeManifestAtomically(path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > MAX_MANIFEST_BYTES) {
    throw new Error('Project manifest exceeds the size limit.')
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    try {
      await handle.writeFile(content, { encoding: 'utf8' })
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}
