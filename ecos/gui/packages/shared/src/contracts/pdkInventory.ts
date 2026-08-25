export type PdkReadiness = 'ready' | 'missing' | 'invalid' | 'unverified'
export type PdkOwnership = 'managed' | 'imported'

export interface PdkInstallationRecord {
  id: string
  familyId: string
  displayName: string
  version: string | null
  root: string
  ownership: PdkOwnership
}

export interface PdkInstallationSnapshot extends PdkInstallationRecord {
  readiness: PdkReadiness
  reason: string | null
  supportsEccDefaults: boolean
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
  familyId: string
}

export interface PdkResolveBindingRequest extends PdkProjectRequest {
  requirement: PdkRequirement
}

export interface PdkWorkspaceValidationRequest extends PdkProjectRequest {
  requirement: PdkRequirement
}
