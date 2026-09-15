import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  normalizeProjectManifestFlowStep,
  type DesktopProjectManagementWorkspaceImportFailureCode,
  type DesktopProjectManagementWorkspaceImportResult,
  type ProjectManifest,
  type ProjectManifestMutationRequest,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'
import { parseWorkspaceParametersText } from './workspaceParametersFile'

const MAX_IMPORT_FILE_BYTES = 512 * 1024

export class ProjectWorkspaceImportError extends Error {
  constructor(
    readonly code: DesktopProjectManagementWorkspaceImportFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectWorkspaceImportError'
  }
}

export interface ProjectWorkspaceManifestGateway {
  load(projectRoot: string): Promise<ProjectManifest>
  mutate(request: ProjectManifestMutationRequest): Promise<{ manifest: ProjectManifest }>
}

export type ProjectWorkspaceImportSuccess = Extract<
  DesktopProjectManagementWorkspaceImportResult,
  { status: 'imported' | 'already_registered' }
>

export class ProjectWorkspaceImportService {
  constructor(private readonly manifestGateway: ProjectWorkspaceManifestGateway) {}

  async importWorkspace(
    requestedProjectRoot: string,
    requestedWorkspacePath: string,
  ): Promise<ProjectWorkspaceImportSuccess> {
    const projectRoot = await canonicalizeDirectory(
      requestedProjectRoot,
      'project_invalid',
      'Project folder',
    )
    const workspacePath = await canonicalizeDirectory(
      requestedWorkspacePath,
      'workspace_not_importable',
      'Workspace folder',
    )
    validateWorkspaceRoot(projectRoot, workspacePath)

    const manifest = await this.loadProjectManifest(projectRoot)
    const flowRange = await inspectWorkspace(workspacePath, manifest)
    const basenameWorkspaceId = basename(workspacePath)
    if (
      !basenameWorkspaceId ||
      basenameWorkspaceId === '.' ||
      basenameWorkspaceId === '..'
    ) {
      throw new ProjectWorkspaceImportError(
        'workspace_not_importable',
        'The selected workspace directory does not have a valid basename.',
      )
    }

    const existing = await findExistingRegistration(
      manifest,
      projectRoot,
      basenameWorkspaceId,
      workspacePath,
    )
    if (existing.alreadyRegistered) {
      return {
        status: 'already_registered',
        manifest,
        workspaceId: existing.workspaceId,
        workspacePath,
      }
    }
    const result = await this.mutateThroughManifestService(
      projectRoot,
      manifest,
      workspacePath,
      flowRange,
    )
    return {
      status: 'imported',
      manifest: result.manifest,
      workspaceId: existing.workspaceId,
      workspacePath,
    }
  }

  private async loadProjectManifest(projectRoot: string): Promise<ProjectManifest> {
    try {
      return await this.manifestGateway.load(projectRoot)
    } catch (error) {
      throw new ProjectWorkspaceImportError(
        'project_invalid',
        `The selected project is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private async mutateThroughManifestService(
    projectRoot: string,
    manifest: ProjectManifest,
    workspacePath: string,
    flowRange: { startStep: string; endStep: string },
  ): Promise<{ manifest: ProjectManifest }> {
    try {
      return await this.manifestGateway.mutate({
        projectRoot,
        mutation: {
          type: 'register-workspace',
          input: {
            projectRoot,
            projectName: manifest.name,
            workspacePath,
            startStep: flowRange.startStep,
            endStep: flowRange.endStep,
          },
        },
      })
    } catch (error) {
      throw translateManifestMutationError(error)
    }
  }
}

export function projectWorkspaceImportFailure(
  error: unknown,
): Extract<DesktopProjectManagementWorkspaceImportResult, { status: 'failed' }> {
  if (error instanceof ProjectWorkspaceImportError) {
    return { status: 'failed', code: error.code, message: error.message }
  }
  return translateManifestMutationError(error)
}

function translateManifestMutationError(
  error: unknown,
): Extract<DesktopProjectManagementWorkspaceImportResult, { status: 'failed' }> {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Workspace registration conflicts with')) {
    return {
      status: 'failed',
      code: 'workspace_id_conflict',
      message,
    }
  }
  if (message.includes('must be inside the Project root')) {
    return {
      status: 'failed',
      code: 'workspace_not_importable',
      message,
    }
  }
  return {
    status: 'failed',
    code: 'project_invalid',
    message: message || 'Workspace import failed.',
  }
}

async function canonicalizeDirectory(
  path: string,
  code: DesktopProjectManagementWorkspaceImportFailureCode,
  label: string,
): Promise<string> {
  try {
    const canonicalPath = await realpath(path)
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error(`${label} is not a directory.`)
    }
    return canonicalPath
  } catch (error) {
    throw new ProjectWorkspaceImportError(
      code,
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validateWorkspaceRoot(projectRoot: string, workspacePath: string): void {
  if (
    workspacePath === projectRoot ||
    isPathWithinRoot(projectRoot, workspacePath) ||
    workspacePath === resolve(projectRoot, 'runs')
  ) {
    throw new ProjectWorkspaceImportError(
      'workspace_not_importable',
      'The selected workspace path is a protected project directory or its ancestor.',
    )
  }
}

async function inspectWorkspace(
  workspacePath: string,
  manifest: ProjectManifest,
): Promise<{ startStep: string; endStep: string }> {
  try {
    await assertRegularDirectory(join(workspacePath, 'home'), workspacePath)
    const flowText = await readBoundedRegularFile(
      join(workspacePath, 'home', 'flow.json'),
      workspacePath,
    )
    const parametersText = await readBoundedRegularFile(
      join(workspacePath, 'home', 'params.toml'),
      workspacePath,
    )
    const parameters = parseWorkspaceParametersText(parametersText, 'toml', workspacePath)

    const flow = parseWorkspaceFlow(flowText)
    const startStep = normalizeImportedStep(flow.steps[0]!.name)
    const endStep = normalizeImportedStep(flow.steps.at(-1)!.name)
    const design = optionalString(parameters.design)
    if (design && design !== manifest.design_name) {
      throw new Error(
        `Workspace design ${JSON.stringify(design)} does not match project design ${JSON.stringify(manifest.design_name)}.`,
      )
    }
    const pdk = optionalString(parameters.pdk)
    if (pdk && manifest.base_design.pdk && pdk !== manifest.base_design.pdk) {
      throw new Error(
        `Workspace PDK ${JSON.stringify(pdk)} does not match project PDK ${JSON.stringify(manifest.base_design.pdk)}.`,
      )
    }

    return { startStep, endStep }
  } catch (error) {
    if (error instanceof ProjectWorkspaceImportError) throw error
    throw new ProjectWorkspaceImportError(
      'workspace_not_importable',
      `The selected directory is not an importable ECC workspace: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function findExistingRegistration(
  manifest: ProjectManifest,
  projectRoot: string,
  workspaceId: string,
  workspacePath: string,
): Promise<{ alreadyRegistered: boolean; workspaceId: string }> {
  let matchingIdPath: string | null = null
  let matchingPathId: string | null = null
  for (const workspace of manifest.workspaces) {
    if (workspace.status === 'archived') continue
    const registeredPath = await canonicalizeManifestWorkspacePath(
      workspace.workspace_path,
      projectRoot,
    )
    if (workspace.workspace_id === workspaceId) matchingIdPath = registeredPath
    if (registeredPath === workspacePath) matchingPathId = workspace.workspace_id
  }
  if (matchingPathId) {
    return { alreadyRegistered: true, workspaceId: matchingPathId }
  }
  if (matchingIdPath) {
    throw new ProjectWorkspaceImportError(
      'workspace_id_conflict',
      `Workspace ID ${workspaceId} is already registered at ${matchingIdPath}.`,
    )
  }
  return { alreadyRegistered: false, workspaceId }
}

async function canonicalizeManifestWorkspacePath(
  workspacePath: string,
  projectRoot: string,
): Promise<string> {
  const candidate = isAbsolute(workspacePath)
    ? resolve(workspacePath)
    : resolve(projectRoot, workspacePath)
  if (!isAbsolute(workspacePath) && !isPathWithinRoot(candidate, projectRoot)) {
    throw new ProjectWorkspaceImportError(
      'project_invalid',
      `Relative workspace path escapes the project root: ${workspacePath}.`,
    )
  }
  try {
    return await realpath(candidate)
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return candidate
    throw error
  }
}

async function assertRegularDirectory(path: string, root: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${path} must be a regular directory.`)
  }
  const canonicalPath = await realpath(path)
  if (!isPathWithinRoot(canonicalPath, root)) {
    throw new Error(`${path} resolves outside the workspace.`)
  }
}

async function readBoundedRegularFile(path: string, root: string): Promise<string> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${path} must be a regular file.`)
  }
  const canonicalParent = await realpath(dirname(path))
  if (!isPathWithinRoot(canonicalParent, root)) {
    throw new Error(`${path} resolves outside its authorized root.`)
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`${path} is not a bounded regular file.`)
    }
    const buffer = Buffer.allocUnsafe(MAX_IMPORT_FILE_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read({
        buffer,
        length: buffer.length - total,
        offset: total,
        position: total,
      })
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`${path} exceeds ${MAX_IMPORT_FILE_BYTES} bytes.`)
    }
    if ((await realpath(dirname(path))) !== canonicalParent) {
      throw new Error(`${path} changed directories while it was being read.`)
    }
    return buffer.subarray(0, total).toString('utf8')
  } finally {
    await handle.close()
  }
}

function parseWorkspaceFlow(content: string): {
  steps: Array<{ name: string; state: string; tool: string }>
} {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('home/flow.json must contain at least one flow step.')
  }
  const steps = parsed.steps.map((value) => {
    if (
      !isRecord(value) ||
      !optionalString(value.name) ||
      !optionalString(value.state) ||
      !optionalString(value.tool)
    ) {
      throw new Error('home/flow.json contains an invalid flow step.')
    }
    return {
      name: optionalString(value.name),
      state: optionalString(value.state),
      tool: optionalString(value.tool),
    }
  })
  if (new Set(steps.map((step) => step.name)).size !== steps.length) {
    throw new Error('home/flow.json contains duplicate flow steps.')
  }
  return { steps }
}

function normalizeImportedStep(step: string): string {
  const normalized = normalizeProjectManifestFlowStep(step)
  const token = step.toLowerCase().replace(/[_\-\s]+/g, '')
  if (normalized === 'Synth' && token !== 'synth' && token !== 'synthesis') {
    throw new Error(`Unsupported workspace flow step: ${step}.`)
  }
  return normalized
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
