import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { homedir } from 'node:os'
import { mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  PdkBindRequest,
  PdkBinding,
  PdkImportRequest,
  PdkInstallationRecord,
  PdkInstallationSnapshot,
  PdkLocateRequest,
  PdkResolveBindingRequest,
  PdkWorkspaceValidationRequest,
} from '@ecos-studio/shared'
import {
  migrateLegacyPdkInventory,
  resumeLegacyPdkMigration,
  writeJsonAtomic,
  type PdkInventoryFile,
  type PdkInventoryBinding,
} from './pdkInventoryMigration'
import { withPdkInventoryLock } from './pdkInventoryLock'
import { assertManualPdkConfiguration } from './pdkManualConfiguration'
import type { PdkConfigurationService } from './pdkConfigurationService'
import { ResourceMetadataRestoreError } from './resourceInstallErrors'
import { snapshotInstallation, configurationIdentity } from './pdkInstallationSnapshot'

export interface PdkInventoryServiceOptions {
  inventoryPath?: string
  legacyManifestPath?: string
  managedRoot?: string
  jsonWriter?: typeof writeJsonAtomic
  legacyCleaner?: () => Promise<void>
}

export interface ManagedPdkInstallationRequest extends PdkImportRequest {
  id: string
  registrySha256: string
  version: string
}

export class PdkInventoryService {
  private configurationService?: Pick<PdkConfigurationService, 'configure'>

  setConfigurationService(service: Pick<PdkConfigurationService, 'configure'>): void {
    this.configurationService = service
  }

  private operation: Promise<void> = Promise.resolve()
  private legacyCleanupComplete = false
  private readonly options: Required<Omit<PdkInventoryServiceOptions, 'legacyCleaner'>> &
    Pick<PdkInventoryServiceOptions, 'legacyCleaner'>

  constructor(options: PdkInventoryServiceOptions = {}) {
    const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
    const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
    const resourcesRoot = join(stateRoot, 'ecos-studio', 'resources')
    const inventoryPath =
      options.inventoryPath ??
      process.env.ECC_PDK_INVENTORY ??
      join(resourcesRoot, 'pdk-inventory.json')
    this.options = {
      inventoryPath,
      legacyManifestPath:
        options.legacyManifestPath ?? join(dirname(inventoryPath), 'manifest.json'),
      managedRoot: options.managedRoot ?? join(dataRoot, 'ecos-studio', 'pdks'),
      jsonWriter: options.jsonWriter ?? writeJsonAtomic,
      legacyCleaner: options.legacyCleaner,
    }
  }

  async importInstallation(request: PdkImportRequest): Promise<PdkInstallationSnapshot> {
    return await this.withLock(async () => {
      const root = await canonicalDirectory(request.root)
      if (this.configurationService) {
        const adopted = await this.configurationService.configure({
          action: 'adopt',
          root,
        })
        if (adopted.error) throw new Error(JSON.stringify(adopted.error))
      }
      const inventory = await this.readInventory()
      const existing = inventory.installations.find(
        (installation) => installation.root === root,
      )
      if (existing) {
        const snapshot = await this.snapshot(existing)
        if (snapshot.readiness === 'ready' && snapshot.contentDigest) {
          Object.assign(existing, configurationIdentity(snapshot))
          await this.writeInventory(inventory)
        }
        return snapshot
      }

      const installation: PdkInstallationRecord = {
        id: localInstallationId(request.familyId, root),
        familyId: requiredText(request.familyId, 'PDK Family ID'),
        displayName: requiredText(request.displayName, 'PDK display name'),
        version: request.version?.trim() || null,
        root,
        ownership: 'imported',
        registrySha256: null,
      }
      const snapshot = await this.snapshot(installation)
      if (snapshot.contentDigest)
        Object.assign(installation, configurationIdentity(snapshot))
      inventory.installations.push(installation)
      await this.writeInventory(inventory)
      return snapshot
    })
  }

  async registerManagedInstallation(
    request: ManagedPdkInstallationRequest,
    signal?: AbortSignal,
  ): Promise<PdkInstallationSnapshot> {
    return await this.withLock(async () => {
      throwIfAborted(signal)
      const root = await canonicalDirectory(request.root)
      throwIfAborted(signal)
      await mkdir(this.options.managedRoot, { recursive: true })
      const managedRoot = await realpath(resolve(this.options.managedRoot))
      throwIfAborted(signal)
      const relativePath = relative(managedRoot, root)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Managed PDK Installation is outside the managed root')
      }
      if (this.configurationService) {
        const adopted = await this.configurationService.configure({
          action: 'adopt',
          root,
        })
        if (adopted.error) throw new Error(JSON.stringify(adopted.error))
      }
      const inventory = await this.readInventory()
      throwIfAborted(signal)
      const originalInventory = structuredClone(inventory)
      let installation = inventory.installations.find(
        (candidate) => candidate.id === request.id || candidate.root === root,
      )
      if (installation) {
        installation.familyId = requiredText(request.familyId, 'PDK Family ID')
        installation.displayName = requiredText(request.displayName, 'PDK display name')
        installation.version = request.version.trim() || null
        installation.root = root
        installation.ownership = 'managed'
        installation.registrySha256 = requiredText(
          request.registrySha256,
          'PDK registry SHA256',
        ).toLowerCase()
      } else {
        installation = {
          id: requiredText(request.id, 'PDK Installation ID'),
          familyId: requiredText(request.familyId, 'PDK Family ID'),
          displayName: requiredText(request.displayName, 'PDK display name'),
          version: request.version.trim() || null,
          root,
          ownership: 'managed',
          registrySha256: requiredText(
            request.registrySha256,
            'PDK registry SHA256',
          ).toLowerCase(),
        }
        inventory.installations.push(installation)
      }
      throwIfAborted(signal)
      await this.writeInventory(inventory)
      try {
        throwIfAborted(signal)
        const result = await this.snapshot(installation)
        throwIfAborted(signal)
        if (result.readiness === 'ready' && result.contentDigest) {
          Object.assign(installation, configurationIdentity(result))
          await this.writeInventory(inventory)
          throwIfAborted(signal)
        }
        return result
      } catch (error) {
        if (!signal?.aborted) throw error
        try {
          await this.writeInventory(originalInventory)
        } catch (rollbackError) {
          throw new ResourceMetadataRestoreError(
            [error, rollbackError],
            'PDK installation was cancelled but its inventory could not be restored',
          )
        }
        throw error
      }
    })
  }

  async listInstallations(): Promise<PdkInstallationSnapshot[]> {
    return await this.withLock(async () => {
      const inventory = await this.readInventory()
      return await Promise.all(
        inventory.installations.map((installation) => this.snapshot(installation)),
      )
    })
  }

  async listBindings(): Promise<PdkBinding[]> {
    return await this.withLock(async () => {
      const inventory = await this.readInventory()
      return inventory.bindings
        .filter((binding) => binding.installationId !== null)
        .map(publicBinding)
    })
  }

  async resolveBinding(request: PdkResolveBindingRequest): Promise<PdkBinding | null> {
    return await this.withLock(async () => {
      const projectRoot = await normalizedProjectRoot(request.projectRoot)
      const projectId = requiredText(request.projectId, 'Project ID')
      const inventory = await this.readInventory()
      const existing = inventory.bindings.find(
        (binding) =>
          binding.projectId === projectId && binding.projectRoot === projectRoot,
      )
      if (existing?.installationId) {
        if (isDeepStrictEqual(existing.requirement, request.requirement)) {
          return publicBinding(existing)
        }
        const bound = inventory.installations.find(
          (candidate) => candidate.id === existing.installationId,
        )
        if (bound && installationSatisfiesRequirement(bound, request.requirement)) {
          // The Requirement drifted but the bound Installation still satisfies
          // it; sync the stored Requirement instead of failing validation later.
          existing.requirement = request.requirement
          await this.writeInventory(inventory)
          return publicBinding(existing)
        }
        // The bound Installation no longer satisfies the Requirement; fall
        // through and try to re-resolve a unique replacement. The stale
        // Binding is replaced only when exactly one match exists.
      } else if (
        existing &&
        isDeepStrictEqual(existing.requirement, request.requirement)
      ) {
        return null
      }

      const matching: PdkInstallationRecord[] = []
      for (const installation of inventory.installations) {
        if (!installationSatisfiesRequirement(installation, request.requirement)) {
          continue
        }
        const readiness = (await this.snapshot(installation)).readiness
        if (readiness === 'ready' || readiness === 'unverified') {
          matching.push(installation)
        }
      }
      if (matching.length !== 1) return null

      if (existing) {
        inventory.bindings = inventory.bindings.filter(
          (candidate) => candidate !== existing,
        )
      }
      const binding: PdkInventoryBinding = {
        projectId,
        projectRoot,
        installationId: matching[0].id,
        requirement: request.requirement,
      }
      inventory.bindings.push(binding)
      await this.writeInventory(inventory)
      return publicBinding(binding)
    })
  }

  async bindInstallation(request: PdkBindRequest): Promise<PdkBinding> {
    return await this.withLock(async () => {
      const projectRoot = await normalizedProjectRoot(request.projectRoot)
      const projectId = requiredText(request.projectId, 'Project ID')
      const inventory = await this.readInventory()
      const installation = inventory.installations.find(
        (candidate) => candidate.id === request.installationId,
      )
      if (!installation) throw new Error('PDK Installation was not found')
      if (!installationSatisfiesRequirement(installation, request.requirement)) {
        throw new Error(
          `PDK Installation does not satisfy the Project Requirement (${describeRequirementMismatch(installation, request.requirement)})`,
        )
      }
      const readiness = (await this.snapshot(installation)).readiness
      if (readiness !== 'ready' && readiness !== 'unverified') {
        throw new Error('PDK Installation is not eligible for Binding')
      }
      const binding: PdkInventoryBinding = {
        projectId,
        projectRoot,
        installationId: installation.id,
        requirement: request.requirement,
      }
      inventory.bindings = inventory.bindings.filter(
        (candidate) =>
          candidate.projectId !== projectId || candidate.projectRoot !== projectRoot,
      )
      inventory.bindings.push(binding)
      await this.writeInventory(inventory)
      return publicBinding(binding)
    })
  }

  async validateWorkspace(
    request: PdkWorkspaceValidationRequest,
  ): Promise<PdkInstallationSnapshot> {
    return await this.withLock(async () => {
      const projectRoot = await normalizedProjectRoot(request.projectRoot)
      const inventory = await this.readInventory()
      const binding = inventory.bindings.find(
        (candidate) =>
          candidate.projectId === request.projectId.trim() &&
          candidate.projectRoot === projectRoot,
      )
      if (!binding?.installationId) throw new Error('Project PDK Requirement is unbound')
      const installation = inventory.installations.find(
        (candidate) => candidate.id === binding.installationId,
      )
      if (!installation) throw new Error('Bound PDK Installation was not found')
      if (!installationSatisfiesRequirement(installation, request.requirement)) {
        throw new Error(
          `Bound PDK Installation does not satisfy the Project Requirement (${describeRequirementMismatch(installation, request.requirement)})`,
        )
      }
      const snapshot = await this.snapshot(installation)
      if (snapshot.readiness === 'missing' || snapshot.readiness === 'invalid') {
        throw new Error(snapshot.reason ?? 'Bound PDK Installation is not usable')
      }
      if (snapshot.readiness === 'unverified' && !request.requirement.manualConfig) {
        throw new Error('Manual PDK Configuration is required')
      }
      if (request.requirement.manualConfig) {
        await assertManualPdkConfiguration(
          installation.root,
          request.requirement.manualConfig,
        )
      }
      return snapshot
    })
  }

  async locateInstallation(request: PdkLocateRequest): Promise<PdkInstallationSnapshot> {
    if (this.configurationService) {
      await this.withLock(async () => {
        const inventory = await this.readInventory()
        const installation = inventory.installations.find(
          (item) => item.id === request.installationId,
        )
        if (!installation) throw new Error('PDK Installation was not found')
        if ((await this.snapshot(installation)).readiness !== 'missing') {
          throw new Error('Only a Missing PDK Installation can be located')
        }
      })
      // ECC owns the configuration relocation and acquires the shared inventory
      // lock itself; do not hold Studio's lock across this subprocess call.
      const result = await this.configurationService.configure({
        action: 'library-locate',
        installationId: request.installationId,
        root: await canonicalDirectory(request.root),
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      return await this.withLock(async () => {
        const inventory = await this.readInventory()
        const installation = inventory.installations.find(
          (item) => item.id === request.installationId,
        )
        if (!installation) throw new Error('Relocated PDK Installation was not found')
        return await this.snapshot(installation)
      })
    }
    return await this.withLock(async () => {
      const inventory = await this.readInventory()
      const installation = inventory.installations.find(
        (candidate) => candidate.id === request.installationId,
      )
      if (!installation) throw new Error('PDK Installation was not found')
      if ((await this.snapshot(installation)).readiness !== 'missing') {
        throw new Error('Only a Missing PDK Installation can be located')
      }
      const root = await canonicalDirectory(request.root)
      if (installation.contentDigest) {
        const relocated = await this.snapshot({ ...installation, root })
        if (relocated.readiness !== 'ready')
          throw new Error(relocated.reason ?? 'PDK relocation requires identical content')
      }
      const existing = inventory.installations.find(
        (candidate) => candidate.id !== installation.id && candidate.root === root,
      )
      if (existing) {
        if (
          existing.familyId !== installation.familyId ||
          existing.version !== installation.version
        ) {
          throw new Error('Located PDK Installation does not match Family and version')
        }
        inventory.bindings = inventory.bindings.map((binding) =>
          binding.installationId === installation.id
            ? { ...binding, installationId: existing.id }
            : binding,
        )
        inventory.installations = inventory.installations.filter(
          (candidate) => candidate.id !== installation.id,
        )
        await this.writeInventory(inventory)
        return await this.snapshot(existing)
      }
      installation.root = root
      await this.writeInventory(inventory)
      return await this.snapshot(installation)
    })
  }

  async removeInstallation(
    installationId: string,
  ): Promise<{ unboundProjectIds: string[] }> {
    return await this.withLock(async () => {
      const inventory = await this.readInventory()
      const installation = inventory.installations.find(
        (candidate) => candidate.id === installationId,
      )
      if (!installation) throw new Error('PDK Installation was not found')
      const removedBindings = inventory.bindings.filter(
        (binding) => binding.installationId === installation.id,
      )
      inventory.bindings = inventory.bindings.filter(
        (binding) => binding.installationId !== installation.id,
      )
      inventory.bindings.push(
        ...removedBindings.map(({ projectId, projectRoot, requirement }) => ({
          projectId,
          projectRoot,
          installationId: null,
          requirement: requirement ?? {
            familyId: installation.familyId,
            version: installation.version,
            manualConfig: null,
          },
        })),
      )
      inventory.installations = inventory.installations.filter(
        (candidate) => candidate.id !== installation.id,
      )

      let stagedManagedRoot: string | null = null
      if (installation.ownership === 'managed') {
        const managedRoot = resolve(this.options.managedRoot)
        const installationRoot = resolve(installation.root)
        const relativePath = relative(managedRoot, installationRoot)
        if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
          throw new Error('Managed PDK Installation is outside the managed root')
        }
        if (await stat(installationRoot).catch(() => null)) {
          stagedManagedRoot = join(managedRoot, `.remove-${randomUUID()}`)
          await rename(installationRoot, stagedManagedRoot)
        }
      }

      try {
        await this.writeInventory(inventory)
      } catch (error) {
        if (stagedManagedRoot) await rename(stagedManagedRoot, installation.root)
        throw error
      }
      if (stagedManagedRoot) {
        await rm(stagedManagedRoot, { force: true, recursive: true })
      }
      return {
        unboundProjectIds: [
          ...new Set(removedBindings.map((binding) => binding.projectId)),
        ],
      }
    })
  }

  async validateRoot(root: string): Promise<PdkInstallationSnapshot> {
    return await this.snapshot({
      id: '',
      root,
      familyId: '',
      displayName: '',
      version: null,
      ownership: 'imported',
      registrySha256: null,
    })
  }

  private async snapshot(
    installation: PdkInstallationRecord,
  ): Promise<PdkInstallationSnapshot> {
    return snapshotInstallation(installation, this.configurationService)
  }

  private async readInventory(): Promise<PdkInventoryFile> {
    try {
      const value = JSON.parse(
        await readFile(this.options.inventoryPath, 'utf8'),
      ) as Partial<PdkInventoryFile>
      if (
        value.schemaVersion !== 1 ||
        !Array.isArray(value.installations) ||
        !Array.isArray(value.bindings)
      ) {
        throw new Error('Invalid PDK Inventory')
      }
      if (!this.legacyCleanupComplete) {
        await resumeLegacyPdkMigration(this.options)
        this.legacyCleanupComplete = true
      }
      return value as PdkInventoryFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const inventory = await migrateLegacyPdkInventory(this.options)
        this.legacyCleanupComplete = true
        return inventory
      }
      throw error
    }
  }

  private async writeInventory(inventory: PdkInventoryFile): Promise<void> {
    await this.options.jsonWriter(this.options.inventoryPath, inventory)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation
    let release!: () => void
    this.operation = new Promise<void>((resolvePromise) => {
      release = resolvePromise
    })
    await previous.catch(() => undefined)
    try {
      return await withPdkInventoryLock(this.options.inventoryPath, operation)
    } finally {
      release()
    }
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  const root = await realpath(resolve(requiredText(path, 'PDK root')))
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${path}`)
  return root
}

function requiredText(value: string, label: string): string {
  const text = value.trim()
  if (!text) throw new Error(`${label} is required`)
  return text
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException('The operation was aborted.', 'AbortError')
}

async function normalizedProjectRoot(path: string): Promise<string> {
  const root = resolve(requiredText(path, 'Project root'))
  return await realpath(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return root
    throw error
  })
}

function publicBinding(binding: PdkInventoryBinding): PdkBinding {
  return {
    projectId: binding.projectId,
    projectRoot: binding.projectRoot,
    installationId: requiredText(binding.installationId ?? '', 'PDK Installation ID'),
  }
}

function installationSatisfiesRequirement(
  installation: PdkInstallationRecord,
  requirement: PdkResolveBindingRequest['requirement'],
): boolean {
  return (
    installation.familyId === requiredText(requirement.familyId, 'PDK Family ID') &&
    (!requirement.version || installation.version === requirement.version)
  )
}

function describeRequirementMismatch(
  installation: PdkInstallationRecord,
  requirement: PdkResolveBindingRequest['requirement'],
): string {
  const installed = `${installation.familyId}@${installation.version ?? 'unknown'}`
  const required = `${requirement.familyId}@${requirement.version ?? 'any'}`
  return `installation: ${installed}, required: ${required}`
}

function localInstallationId(familyId: string, root: string): string {
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 12)
  return `pdk:${requiredText(familyId, 'PDK Family ID')}:local:${digest}`
}
