import { createHash } from 'node:crypto'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  parseEngineeringSnapshotJson,
  projectManagementWorkspaceReadablePaths,
} from '@ecos-studio/shared'
import type {
  DesktopProjectManagementWorkspaceTextsRequest,
  DesktopProjectManagementWorkspaceTextsResult,
  DesktopProjectManagementWorkspaceStepConfigurationRequest,
  DesktopProjectManagementWorkspaceStepConfigurationResult,
  EngineeringSnapshotValidationResult,
  ProjectManifest,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'
import { mapWithConcurrency } from './boundedConcurrency'

const PROJECT_MANIFEST_MAX_BYTES = 512 * 1024
const PROJECT_WORKSPACE_TEXT_MAX_BYTES = 256 * 1024
const PROJECT_WORKSPACE_READ_CONCURRENCY = 4
const PROJECT_WORKSPACE_READ_LIMIT = projectManagementWorkspaceReadablePaths.length
export const PROJECT_FINDINGS_ARTIFACT_MAX_BYTES = 1024 * 1024
export const PROJECT_BINARY_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024

const PROJECT_MANAGEMENT_WORKSPACE_PATHS = new Set(
  projectManagementWorkspaceReadablePaths,
)

class ProjectManagementWorkspacePathError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ProjectEngineeringSnapshotReadResult = EngineeringSnapshotValidationResult & {
  readBytes: number
  staleSnapshot?: Extract<EngineeringSnapshotValidationResult, { ok: true }>
}

export type VerifiedProjectArtifactsReadResult =
  | { ok: true; texts: Record<string, string> }
  | {
      ok: false
      code:
        | 'ARTIFACT_REVISION_MISMATCH'
        | 'FINDINGS_ARTIFACT_INVALID_JSON'
        | 'FINDINGS_ARTIFACT_TOO_LARGE'
        | 'ARTIFACT_REFERENCE_MISSING'
        | 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE'
        | 'FINDINGS_READ_FAILED'
      reference: string
    }

export type VerifiedProjectArtifactReadResult =
  | { ok: true; bytes: Uint8Array }
  | Exclude<VerifiedProjectArtifactsReadResult, { ok: true }>

export interface ProjectManifestReader {
  discover(directory: string): Promise<ProjectManifest | null>
  load(projectRoot: string): Promise<ProjectManifest>
}

export interface ProjectWorkspaceConfiguration {
  workspaceBindings: Record<string, unknown>
  workspaceSpec: Record<string, unknown>
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function inputPaths(
  configuration: ProjectWorkspaceConfiguration,
  role: string,
): string[] {
  const inputs = Array.isArray(configuration.workspaceSpec.inputs)
    ? configuration.workspaceSpec.inputs
    : []
  const bindings = isRecord(configuration.workspaceBindings.inputs)
    ? configuration.workspaceBindings.inputs
    : {}
  return inputs.flatMap((value) => {
    if (!isRecord(value) || value.role !== role) return []
    const path = stringValue(bindings[stringValue(value.inputId)])
    return path ? [path] : []
  })
}

function applyWorkspaceDesignDefaults(
  manifest: ProjectManifest,
  configuration: ProjectWorkspaceConfiguration,
): ProjectManifest {
  const design = isRecord(configuration.workspaceSpec.design)
    ? configuration.workspaceSpec.design
    : {}
  const rtlList = inputPaths(configuration, 'rtl')
  const filelist = inputPaths(configuration, 'filelist')[0]
  const sdc = inputPaths(configuration, 'sdc')[0]
  const originVerilog = inputPaths(configuration, 'netlist')[0]
  const originDef = inputPaths(configuration, 'def')[0]

  return {
    ...manifest,
    base_design: {
      ...manifest.base_design,
      ...(filelist ? { filelist } : {}),
      ...(originDef ? { origin_def: originDef } : {}),
      ...(originVerilog ? { origin_verilog: originVerilog } : {}),
      ...(rtlList.length ? { rtl_list: rtlList } : {}),
      ...(sdc ? { sdc } : {}),
      ...(stringValue(design.clockPort) ? { clock: stringValue(design.clockPort) } : {}),
      ...(stringValue(design.topModule)
        ? { top_module: stringValue(design.topModule) }
        : {}),
    },
  }
}

function pathsEqual(leftPath: string, rightPath: string): boolean {
  return relative(resolve(leftPath), resolve(rightPath)) === ''
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}

async function canonicalizeExistingDirectory(path: string): Promise<string> {
  const canonicalPath = await realpath(path)
  const pathStats = await stat(canonicalPath)
  if (!pathStats.isDirectory()) {
    throw Object.assign(
      new Error(`Project management path is not a directory: ${path}`),
      {
        code: 'ENOTDIR',
      },
    )
  }
  return canonicalPath
}

async function readOptionalBoundedTextFile(
  path: string,
  maxBytes: number,
): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxBytes) {
      throw new Error(`Project management file exceeds ${maxBytes} bytes: ${path}`)
    }
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null
    throw error
  } finally {
    await handle?.close()
  }
}

export class ProjectManagementReadService {
  constructor(
    private readonly projectManifestReader: ProjectManifestReader,
    private readonly readStepConfiguration?: (
      workspacePath: string,
      step: string,
    ) => Promise<DesktopProjectManagementWorkspaceStepConfigurationResult>,
    private readonly readWorkspaceConfiguration?: (
      workspacePath: string,
    ) => Promise<ProjectWorkspaceConfiguration>,
  ) {}

  async readManifest(projectRoot: string): Promise<ProjectManifest | null> {
    const root = await canonicalizeExistingDirectory(projectRoot)
    const content = await readOptionalBoundedTextFile(
      join(root, 'project.json'),
      PROJECT_MANIFEST_MAX_BYTES,
    )
    if (!content) return null
    const manifest = await this.projectManifestReader.load(root)
    if (!this.readWorkspaceConfiguration) return manifest

    const sourceWorkspace =
      manifest.workspaces.find(
        (workspace) =>
          workspace.workspace_id === manifest.qor_baseline?.workspace_id &&
          workspace.status !== 'archived',
      ) ?? manifest.workspaces.find((workspace) => workspace.status !== 'archived')
    if (!sourceWorkspace) return manifest
    const sourceWorkspacePath = resolve(root, sourceWorkspace.workspace_path)
    if (
      pathsEqual(sourceWorkspacePath, root) ||
      !isPathWithinRoot(sourceWorkspacePath, root)
    ) {
      return manifest
    }

    try {
      return applyWorkspaceDesignDefaults(
        manifest,
        await this.readWorkspaceConfiguration(sourceWorkspacePath),
      )
    } catch {
      return manifest
    }
  }

  async discoverProject(directory: string): Promise<ProjectManifest | null> {
    return await this.projectManifestReader.discover(
      await canonicalizeExistingDirectory(directory),
    )
  }

  async listProjectEntries(projectRoot: string): Promise<string[]> {
    const project = await this.loadProject(projectRoot)
    if (!project.manifest) {
      throw new Error('Project manifest does not exist.')
    }
    const entries = await readdir(project.root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }

  async readWorkspaceTexts(
    request: DesktopProjectManagementWorkspaceTextsRequest,
  ): Promise<DesktopProjectManagementWorkspaceTextsResult> {
    const paths = normalizeRequestedPaths(request.paths)
    const project = await this.loadProject(request.projectRoot)
    if (!project.manifest) {
      throw new Error('Project manifest does not exist.')
    }
    const workspacePath = await this.resolveDeclaredWorkspace(
      project.root,
      project.manifest.workspaces.map((workspace) => workspace.workspace_path),
      request.workspacePath,
    )
    const entries = await mapWithConcurrency(
      paths,
      PROJECT_WORKSPACE_READ_CONCURRENCY,
      async (path) => {
        try {
          return {
            path,
            text: await this.readWorkspaceTextFile(
              workspacePath,
              path,
              PROJECT_WORKSPACE_TEXT_MAX_BYTES,
            ),
            unavailable: false,
          }
        } catch (error) {
          if (error instanceof ProjectManagementWorkspacePathError) throw error
          return { path, text: null, unavailable: true }
        }
      },
    )
    return {
      texts: Object.fromEntries(entries.map(({ path, text }) => [path, text])),
      unavailablePaths: entries
        .filter(({ unavailable }) => unavailable)
        .map(({ path }) => path),
    }
  }

  async readWorkspaceStepConfiguration(
    request: DesktopProjectManagementWorkspaceStepConfigurationRequest,
  ): Promise<DesktopProjectManagementWorkspaceStepConfigurationResult> {
    if (
      !this.readStepConfiguration ||
      !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(request.step)
    ) {
      throw new Error('Workspace Step Configuration request is invalid.')
    }
    const project = await this.loadProject(request.projectRoot)
    if (!project.manifest) throw new Error('Project manifest does not exist.')
    const workspacePath = await this.resolveDeclaredWorkspace(
      project.root,
      project.manifest.workspaces.map((workspace) => workspace.workspace_path),
      request.workspacePath,
    )
    const result = await this.readStepConfiguration(workspacePath, request.step)
    if (!isRecord(result) || typeof result.status !== 'string') {
      throw new Error('ECC Step Configuration is unavailable.')
    }
    return result
  }

  async readEngineeringSnapshot(request: {
    projectRoot: string
    workspacePath: string
  }): Promise<ProjectEngineeringSnapshotReadResult> {
    let readBytes = 0
    try {
      const projectRoot = await canonicalizeExistingDirectory(request.projectRoot)
      const workspaceCandidate = resolve(request.workspacePath)
      if (
        pathsEqual(workspaceCandidate, projectRoot) ||
        !isPathWithinRoot(workspaceCandidate, projectRoot)
      ) {
        return snapshotFailure('WORKSPACE_PATH_OUTSIDE_PROJECT', readBytes)
      }
      const workspaceRoot = await canonicalizeExistingDirectory(workspaceCandidate)
      if (!isPathWithinRoot(workspaceRoot, projectRoot)) {
        return snapshotFailure('WORKSPACE_PATH_OUTSIDE_PROJECT', readBytes)
      }

      let snapshotPath: string
      try {
        snapshotPath = await realpath(
          join(workspaceRoot, 'home', 'engineering-snapshot.json'),
        )
      } catch (error) {
        if (isNodeErrorWithCode(error, 'ENOENT')) {
          return snapshotFailure('ENGINEERING_SNAPSHOT_MISSING', readBytes)
        }
        throw error
      }
      if (!isPathWithinRoot(snapshotPath, workspaceRoot)) {
        return snapshotFailure('WORKSPACE_PATH_OUTSIDE_PROJECT', readBytes)
      }

      const file = await readBoundedSnapshot(snapshotPath)
      readBytes = file.sizeBytes
      if (!file.bytes) {
        return {
          ok: false,
          readBytes,
          issue: {
            code: 'ENGINEERING_SNAPSHOT_TOO_LARGE',
            actualSizeBytes: readBytes,
            allowedSizeBytes: ENGINEERING_SNAPSHOT_MAX_BYTES,
          },
        }
      }
      const validated = parseEngineeringSnapshotJson(file.bytes)
      if (!validated.ok || !validated.snapshot.stalePredecessor) {
        return { ...validated, readBytes }
      }
      try {
        const stalePath = await realpath(
          join(workspaceRoot, 'home', 'engineering-snapshot.stale.json'),
        )
        if (!isPathWithinRoot(stalePath, workspaceRoot)) {
          return { ...validated, readBytes }
        }
        const staleFile = await readBoundedSnapshot(stalePath)
        if (!staleFile.bytes) return { ...validated, readBytes }
        const staleSnapshot = parseEngineeringSnapshotJson(staleFile.bytes)
        if (
          staleSnapshot.ok &&
          staleSnapshot.snapshot.workspaceId === validated.snapshot.workspaceId &&
          staleSnapshot.snapshot.workspaceRevision ===
            validated.snapshot.stalePredecessor.workspaceRevision
        ) {
          return { ...validated, readBytes, staleSnapshot }
        }
      } catch {
        // A missing or invalid predecessor must not hide the current Revision.
      }
      return { ...validated, readBytes }
    } catch {
      return snapshotFailure('ENGINEERING_SNAPSHOT_READ_FAILED', readBytes)
    }
  }

  async readVerifiedArtifacts(request: {
    projectRoot: string
    workspacePath: string
    artifacts: Array<{ reference: string; sha256: string; sizeBytes: number }>
  }): Promise<VerifiedProjectArtifactsReadResult> {
    if (
      request.artifacts.length < 1 ||
      request.artifacts.length > 4 ||
      new Set(request.artifacts.map((artifact) => artifact.reference)).size !==
        request.artifacts.length
    ) {
      return { ok: false, code: 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE', reference: '' }
    }
    try {
      const project = await this.loadProject(request.projectRoot)
      if (!project.manifest) {
        return { ok: false, code: 'FINDINGS_READ_FAILED', reference: '' }
      }
      const workspaceRoot = await this.resolveDeclaredWorkspace(
        project.root,
        project.manifest.workspaces.map((workspace) => workspace.workspace_path),
        request.workspacePath,
      )
      const texts: Record<string, string> = {}
      for (const artifact of request.artifacts) {
        const result = await readVerifiedArtifactBytes(
          workspaceRoot,
          artifact,
          PROJECT_FINDINGS_ARTIFACT_MAX_BYTES,
        )
        if (!result.ok) return result
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)
          JSON.parse(text)
        } catch {
          return {
            ok: false,
            code: 'FINDINGS_ARTIFACT_INVALID_JSON',
            reference: artifact.reference,
          }
        }
        texts[artifact.reference] = text
      }
      return { ok: true, texts }
    } catch {
      return { ok: false, code: 'FINDINGS_READ_FAILED', reference: '' }
    }
  }

  async readVerifiedArtifact(request: {
    projectRoot: string
    workspacePath: string
    artifact: { reference: string; sha256: string; sizeBytes: number }
  }): Promise<VerifiedProjectArtifactReadResult> {
    try {
      const project = await this.loadProject(request.projectRoot)
      if (!project.manifest) {
        return { ok: false, code: 'FINDINGS_READ_FAILED', reference: '' }
      }
      const workspaceRoot = await this.resolveDeclaredWorkspace(
        project.root,
        project.manifest.workspaces.map((workspace) => workspace.workspace_path),
        request.workspacePath,
      )
      const result = await readVerifiedArtifactBytes(
        workspaceRoot,
        request.artifact,
        PROJECT_BINARY_ARTIFACT_MAX_BYTES,
      )
      return result.ok ? { ok: true, bytes: Uint8Array.from(result.bytes) } : result
    } catch {
      return { ok: false, code: 'FINDINGS_READ_FAILED', reference: '' }
    }
  }

  private async loadProject(projectRoot: string) {
    const root = await canonicalizeExistingDirectory(projectRoot)
    const content = await readOptionalBoundedTextFile(
      join(root, 'project.json'),
      PROJECT_MANIFEST_MAX_BYTES,
    )
    if (!content) return { manifest: null, root }

    const manifest = await this.projectManifestReader.load(root)
    const manifestRoot = await canonicalizeExistingDirectory(manifest.root_path)
    if (!pathsEqual(root, manifestRoot)) {
      throw new Error(
        'Project manifest root_path does not match its containing directory.',
      )
    }
    for (const workspace of manifest.workspaces) {
      const candidate = resolve(workspace.workspace_path)
      if (!isPathWithinRoot(candidate, root)) {
        throw new Error('Project manifest contains a workspace outside the project root.')
      }
    }
    return { manifest, root }
  }

  private async resolveDeclaredWorkspace(
    projectRoot: string,
    declaredWorkspacePaths: string[],
    workspacePath: string,
  ): Promise<string> {
    if (!declaredWorkspacePaths.some((path) => pathsEqual(path, workspacePath))) {
      throw new Error('Workspace is not declared by the requested project.')
    }

    const candidatePath = resolve(workspacePath)
    if (!isPathWithinRoot(candidatePath, projectRoot)) {
      throw new Error('Workspace is outside the requested project.')
    }

    const canonicalPath = await canonicalizeExistingDirectory(candidatePath)
    if (!isPathWithinRoot(canonicalPath, projectRoot)) {
      throw new Error('Workspace resolves outside the requested project.')
    }
    return canonicalPath
  }

  private async readWorkspaceTextFile(
    workspaceRoot: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<string | null> {
    const requestedPath = join(workspaceRoot, relativePath)
    let canonicalPath: string
    try {
      canonicalPath = await realpath(requestedPath)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return null
      throw error
    }
    if (!isPathWithinRoot(canonicalPath, workspaceRoot)) {
      throw new ProjectManagementWorkspacePathError(
        'Project management workspace file resolves outside its workspace.',
      )
    }
    return await readOptionalBoundedTextFile(canonicalPath, maxBytes)
  }
}

async function readVerifiedArtifactBytes(
  workspaceRoot: string,
  artifact: { reference: string; sha256: string; sizeBytes: number },
  maxBytes: number,
): Promise<
  { ok: true; bytes: Buffer } | Exclude<VerifiedProjectArtifactsReadResult, { ok: true }>
> {
  const unsafe = (): Exclude<VerifiedProjectArtifactsReadResult, { ok: true }> => ({
    ok: false,
    code: 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE',
    reference: artifact.reference,
  })
  if (
    !artifact.reference ||
    isAbsolute(artifact.reference) ||
    !Number.isSafeInteger(artifact.sizeBytes) ||
    artifact.sizeBytes < 0 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  ) {
    return unsafe()
  }
  const candidate = resolve(workspaceRoot, artifact.reference)
  if (candidate === workspaceRoot || !isPathWithinRoot(candidate, workspaceRoot)) {
    return unsafe()
  }
  let canonicalPath: string
  try {
    canonicalPath = await realpath(candidate)
  } catch (error) {
    return isNodeErrorWithCode(error, 'ENOENT')
      ? { ok: false, code: 'ARTIFACT_REFERENCE_MISSING', reference: artifact.reference }
      : { ok: false, code: 'FINDINGS_READ_FAILED', reference: artifact.reference }
  }
  if (!isPathWithinRoot(canonicalPath, workspaceRoot)) return unsafe()

  const handle = await open(canonicalPath, 'r')
  try {
    const fileStats = await handle.stat()
    if (!fileStats.isFile()) {
      return {
        ok: false,
        code: 'ARTIFACT_REFERENCE_MISSING',
        reference: artifact.reference,
      }
    }
    if (fileStats.size > maxBytes || artifact.sizeBytes > maxBytes) {
      return {
        ok: false,
        code: 'FINDINGS_ARTIFACT_TOO_LARGE',
        reference: artifact.reference,
      }
    }
    if (fileStats.size !== artifact.sizeBytes) {
      return {
        ok: false,
        code: 'ARTIFACT_REVISION_MISMATCH',
        reference: artifact.reference,
      }
    }
    const buffer = Buffer.alloc(artifact.sizeBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > maxBytes) {
      return {
        ok: false,
        code: 'FINDINGS_ARTIFACT_TOO_LARGE',
        reference: artifact.reference,
      }
    }
    if (offset !== artifact.sizeBytes) {
      return {
        ok: false,
        code: 'ARTIFACT_REVISION_MISMATCH',
        reference: artifact.reference,
      }
    }
    const bytes = buffer.subarray(0, offset)
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
      return {
        ok: false,
        code: 'ARTIFACT_REVISION_MISMATCH',
        reference: artifact.reference,
      }
    }
    return { ok: true, bytes }
  } finally {
    await handle.close()
  }
}

function snapshotFailure(
  code: string,
  readBytes: number,
): ProjectEngineeringSnapshotReadResult {
  return { ok: false, readBytes, issue: { code } }
}

async function readBoundedSnapshot(
  path: string,
): Promise<{ bytes: Buffer | null; sizeBytes: number }> {
  const handle = await open(path, 'r')
  try {
    const initialSize = (await handle.stat()).size
    if (initialSize > ENGINEERING_SNAPSHOT_MAX_BYTES) {
      return { bytes: null, sizeBytes: initialSize }
    }
    const buffer = Buffer.alloc(ENGINEERING_SNAPSHOT_MAX_BYTES + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > ENGINEERING_SNAPSHOT_MAX_BYTES) {
      return { bytes: null, sizeBytes: Math.max(offset, (await handle.stat()).size) }
    }
    return { bytes: buffer.subarray(0, offset), sizeBytes: offset }
  } finally {
    await handle.close()
  }
}

function normalizeRequestedPaths(paths: string[]): string[] {
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0 || uniquePaths.length > PROJECT_WORKSPACE_READ_LIMIT) {
    throw new Error('Project management workspace read has an invalid path count.')
  }
  for (const path of uniquePaths) {
    if (!PROJECT_MANAGEMENT_WORKSPACE_PATHS.has(path)) {
      throw new Error(`Project management workspace path is not allowed: ${path}`)
    }
  }
  return uniquePaths
}
