export type PdkReadiness = 'ready' | 'missing' | 'invalid' | 'unverified'
export type PdkOwnership = 'managed' | 'imported'

export interface PdkInstallationRecord {
  id: string
  familyId: string
  displayName: string
  version: string | null
  root: string
  ownership: PdkOwnership
  registrySha256: string | null
  contentDigest?: string
  pdkDigest?: string
  adaptationDigest?: string
  configurationPath?: string
}

export interface PdkInstallationSnapshot extends PdkInstallationRecord {
  readiness: PdkReadiness
  reason: string | null
  supportsEccDefaults: boolean
  /** Present only when the selected description's resource files have passed validation. */
  defaultResources?: ManualPdkConfiguration
}

export interface ManualPdkConfiguration {
  techLef: string
  cellLefs: string[]
  liberty: string[]
}

export interface PdkRequirement {
  familyId: string
  version: string | null
  manualConfig: ManualPdkConfiguration | null
}

export interface PdkBinding {
  projectId: string
  projectRoot: string
  installationId: string
}

export interface PdkImportRequest {
  root: string
  familyId: string
  displayName: string
  version?: string | null
}

export interface PdkLocateRequest {
  installationId: string
  root: string
}

export interface PdkProjectRequest {
  projectId: string
  projectRoot: string
}

export interface PdkBindRequest extends PdkProjectRequest {
  installationId: string
  requirement: PdkRequirement
}

export interface PdkResolveBindingRequest extends PdkProjectRequest {
  requirement: PdkRequirement
}

export interface PdkWorkspaceValidationRequest extends PdkProjectRequest {
  requirement: PdkRequirement
}

export interface PdkConfigureRequest {
  action:
    | 'schema'
    | 'init'
    | 'adopt'
    | 'discover'
    | 'show'
    | 'set'
    | 'validate'
    | 'resolve'
    | 'library-list'
    | 'library-default'
    | 'library-locate'
  root?: string
  descriptionPath?: string
  familyId?: string
  field?: string
  value?: unknown
  expectedRevision?: string
  installationId?: string
  client?: 'ecc' | 'studio'
}
