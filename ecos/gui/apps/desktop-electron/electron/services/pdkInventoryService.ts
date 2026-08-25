import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ManualPdkConfiguration,
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
} from './pdkInventoryMigration'

export interface PdkInventoryServiceOptions {
  inventoryPath?: string
  legacyManifestPath?: string
  managedRoot?: string
  jsonWriter?: typeof writeJsonAtomic
  legacyCleaner?: () => Promise<void>
}

export interface ManagedPdkInstallationRequest extends PdkImportRequest {
  id: string
  version: string
}

const ICS55_MARKERS = [
  'prtech/techLEF/N551P6M_ecos.lef',
  'IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CR/lef/ics55_LLSC_H7CR_ecos.lef',
  'IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CL/lef/ics55_LLSC_H7CL_ecos.lef',
  'IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CR/liberty/ics55_LLSC_H7CR_ss_rcworst_1p08_125_nldm.lib',
  'IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CL/liberty/ics55_LLSC_H7CL_ss_rcworst_1p08_125_nldm.lib',
]

export class PdkInventoryService {
  private operation: Promise<void> = Promise.resolve()
  private legacyCleanupComplete = false
  private readonly options: Required<Omit<PdkInventoryServiceOptions, 'legacyCleaner'>> &
    Pick<PdkInventoryServiceOptions, 'legacyCleaner'>

  constructor(options: PdkInventoryServiceOptions = {}) {
    const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
    const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
    const resourcesRoot = join(stateRoot, 'ecos-studio', 'resources')
    const inventoryPath =
      options.inventoryPath ?? join(resourcesRoot, 'pdk-inventory.json')
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
      const inventory = await this.readInventory()
      const existing = inventory.installations.find(
        (installation) => installation.root === root,
      )
      if (existing) return await this.snapshot(existing)

      const installation: PdkInstallationRecord = {
        id: localInstallationId(request.familyId, root),
        familyId: requiredText(request.familyId, 'PDK Family ID'),
        displayName: requiredText(request.displayName, 'PDK display name'),
        version: request.version?.trim() || null,
        root,
        ownership: 'imported',
      }
      inventory.installations.push(installation)
      await this.writeInventory(inventory)
      return await this.snapshot(installation)
    })
  }

  async registerManagedInstallation(
    request: ManagedPdkInstallationRequest,
  ): Promise<PdkInstallationSnapshot> {
    return await this.withLock(async () => {
      const root = await canonicalDirectory(request.root)
      await mkdir(this.options.managedRoot, { recursive: true })
      const managedRoot = await realpath(resolve(this.options.managedRoot))
      const relativePath = relative(managedRoot, root)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Managed PDK Installation is outside the managed root')
      }
      const inventory = await this.readInventory()
      let installation = inventory.installations.find(
        (candidate) => candidate.id === request.id || candidate.root === root,
      )
      if (installation) {
        installation.familyId = requiredText(request.familyId, 'PDK Family ID')
        installation.displayName = requiredText(request.displayName, 'PDK display name')
        installation.version = request.version.trim() || null
        installation.root = root
        installation.ownership = 'managed'
      } else {
        installation = {
          id: requiredText(request.id, 'PDK Installation ID'),
          familyId: requiredText(request.familyId, 'PDK Family ID'),
          displayName: requiredText(request.displayName, 'PDK display name'),
          version: request.version.trim() || null,
          root,
          ownership: 'managed',
        }
        inventory.installations.push(installation)
      }
      await this.writeInventory(inventory)
      return await this.snapshot(installation)
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

  async resolveBinding(request: PdkResolveBindingRequest): Promise<PdkBinding | null> {
    return await this.withLock(async () => {
      const projectRoot = normalizedProjectRoot(request.projectRoot)
      const projectId = requiredText(request.projectId, 'Project ID')
      const inventory = await this.readInventory()
      const existing = inventory.bindings.find(
        (binding) =>
          binding.projectId === projectId && binding.projectRoot === projectRoot,
      )
      if (existing) return existing
      if (
        inventory.autoBindingBlocks.some(
          (blocked) =>
            blocked.projectId === projectId && blocked.projectRoot === projectRoot,
        )
      )
        return null

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

      const binding: PdkBinding = {
        projectId,
        projectRoot,
        installationId: matching[0].id,
      }
      inventory.bindings.push(binding)
      await this.writeInventory(inventory)
      return binding
    })
  }

  async bindInstallation(request: PdkBindRequest): Promise<PdkBinding> {
    return await this.withLock(async () => {
      const projectRoot = normalizedProjectRoot(request.projectRoot)
      const projectId = requiredText(request.projectId, 'Project ID')
      const inventory = await this.readInventory()
      const installation = inventory.installations.find(
        (candidate) => candidate.id === request.installationId,
      )
      if (!installation) throw new Error('PDK Installation was not found')
      if (!installationSatisfiesRequirement(installation, request.requirement)) {
        throw new Error('PDK Installation does not satisfy the Project Requirement')
      }
      const readiness = (await this.snapshot(installation)).readiness
      if (readiness !== 'ready' && readiness !== 'unverified') {
        throw new Error('PDK Installation is not eligible for Binding')
      }
      const binding: PdkBinding = {
        projectId,
        projectRoot,
        installationId: installation.id,
      }
      inventory.bindings = inventory.bindings.filter(
        (candidate) =>
          candidate.projectId !== projectId || candidate.projectRoot !== projectRoot,
      )
      inventory.autoBindingBlocks = inventory.autoBindingBlocks.filter(
        (blocked) =>
          blocked.projectId !== projectId || blocked.projectRoot !== projectRoot,
      )
      inventory.bindings.push(binding)
      await this.writeInventory(inventory)
      return binding
    })
  }

  async validateWorkspace(
    request: PdkWorkspaceValidationRequest,
  ): Promise<PdkInstallationSnapshot> {
    return await this.withLock(async () => {
      const projectRoot = normalizedProjectRoot(request.projectRoot)
      const inventory = await this.readInventory()
      const binding = inventory.bindings.find(
        (candidate) =>
          candidate.projectId === request.projectId.trim() &&
          candidate.projectRoot === projectRoot,
      )
      if (!binding) throw new Error('Project PDK Requirement is unbound')
      const installation = inventory.installations.find(
        (candidate) => candidate.id === binding.installationId,
      )
      if (!installation) throw new Error('Bound PDK Installation was not found')
      if (!installationSatisfiesRequirement(installation, request.requirement)) {
        throw new Error('Bound PDK Installation does not satisfy the Project Requirement')
      }
      const snapshot = await this.snapshot(installation)
      if (snapshot.readiness === 'missing' || snapshot.readiness === 'invalid') {
        throw new Error(snapshot.reason ?? 'Bound PDK Installation is not usable')
      }
      if (snapshot.readiness === 'unverified' && !request.requirement.manualConfig) {
        throw new Error('Manual PDK Configuration is required')
      }
      if (request.requirement.manualConfig) {
        await assertManualConfiguration(
          installation.root,
          request.requirement.manualConfig,
        )
      }
      return snapshot
    })
  }

  async locateInstallation(request: PdkLocateRequest): Promise<PdkInstallationSnapshot> {
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
      inventory.autoBindingBlocks.push(
        ...removedBindings.map(({ projectId, projectRoot }) => ({
          projectId,
          projectRoot,
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

  private async snapshot(
    installation: PdkInstallationRecord,
  ): Promise<PdkInstallationSnapshot> {
    try {
      const rootStats = await stat(installation.root)
      if (!rootStats.isDirectory()) {
        return {
          ...installation,
          readiness: 'missing',
          reason: 'PDK root is unavailable',
          supportsEccDefaults: installation.familyId === 'ics55',
        }
      }
      if (installation.familyId !== 'ics55') {
        return {
          ...installation,
          readiness: 'unverified',
          reason: null,
          supportsEccDefaults: false,
        }
      }
      const markers = await Promise.all(
        ICS55_MARKERS.map((marker) =>
          stat(resolve(installation.root, marker)).catch(() => null),
        ),
      )
      if (markers.some((marker) => !marker?.isFile())) {
        return {
          ...installation,
          readiness: 'invalid',
          reason: 'Required ICS55 PDK files are missing',
          supportsEccDefaults: true,
        }
      }
      return {
        ...installation,
        readiness: 'ready',
        reason: null,
        supportsEccDefaults: true,
      }
    } catch {
      return {
        ...installation,
        readiness: 'missing',
        reason: 'PDK root is unavailable',
        supportsEccDefaults: installation.familyId === 'ics55',
      }
    }
  }

  private async readInventory(): Promise<PdkInventoryFile> {
    try {
      const value = JSON.parse(
        await readFile(this.options.inventoryPath, 'utf8'),
      ) as Partial<PdkInventoryFile>
      if (
        value.schemaVersion !== 1 ||
        !Array.isArray(value.installations) ||
        !Array.isArray(value.bindings) ||
        (value.autoBindingBlocks !== undefined && !Array.isArray(value.autoBindingBlocks))
      ) {
        throw new Error('Invalid PDK Inventory')
      }
      if (!this.legacyCleanupComplete) {
        await resumeLegacyPdkMigration(this.options)
        this.legacyCleanupComplete = true
      }
      return {
        ...value,
        autoBindingBlocks: value.autoBindingBlocks ?? [],
      } as PdkInventoryFile
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
      return await operation()
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

function normalizedProjectRoot(path: string): string {
  return resolve(requiredText(path, 'Project root'))
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

function localInstallationId(familyId: string, root: string): string {
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 12)
  return `pdk:${requiredText(familyId, 'PDK Family ID')}:local:${digest}`
}

async function assertManualConfiguration(
  root: string,
  configuration: ManualPdkConfiguration,
): Promise<void> {
  const paths = [
    requiredText(configuration.techLef, 'Tech LEF'),
    ...configuration.cellLefs,
    ...configuration.liberty,
  ]
  if (configuration.cellLefs.length === 0 || configuration.liberty.length === 0) {
    throw new Error('Manual PDK Configuration is incomplete')
  }
  for (const path of paths) {
    if (isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)) {
      throw new Error(`Manual PDK resource path must be relative: ${path}`)
    }
    const candidate = await realpath(resolve(root, requiredText(path, 'PDK resource')))
    const relativePath = relative(root, candidate)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Manual PDK resource is outside the PDK root: ${path}`)
    }
    if (!(await stat(candidate)).isFile()) {
      throw new Error(`Manual PDK resource is not a file: ${path}`)
    }
  }
}
