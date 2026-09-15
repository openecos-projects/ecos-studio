import type { ProjectManifestMutation } from '@ecos-studio/shared'

export function validateProjectManifestMutation(
  mutation: unknown,
): asserts mutation is ProjectManifestMutation {
  if (!isRecord(mutation) || typeof mutation.type !== 'string') {
    throw new Error('Project manifest mutation is required')
  }

  switch (mutation.type) {
    case 'create':
      requireString(mutation.name, 'Project manifest create mutation name')
      requireString(mutation.designName, 'Project manifest create mutation designName')
      validateProjectManifestMpc(mutation.mpc)
      return
    case 'register-workspace': {
      const input = requireRecord(
        mutation.input,
        'Project manifest workspace registration input',
      )
      requireString(input.projectRoot, 'Project manifest workspace projectRoot')
      requireString(input.workspacePath, 'Project manifest workspace path')
      requireOptionalString(input.projectName, 'Project manifest workspace projectName')
      requireOptionalString(
        input.sourceWorkspaceId,
        'Project manifest source workspace id',
      )
      requireOptionalString(input.sourceStep, 'Project manifest source step')
      requireOptionalString(input.sourceOutputPath, 'Project manifest source output path')
      requireOptionalString(input.sourceOutputType, 'Project manifest source output type')
      requireOptionalString(input.startStep, 'Project manifest start step')
      requireOptionalString(input.endStep, 'Project manifest end step')
      if (input.config !== undefined) validateWorkspaceConfig(input.config)
      return
    }
    case 'archive-workspace':
    case 'delete-workspace':
      requireString(mutation.workspaceId, 'Project manifest workspace id')
      if (
        mutation.type === 'delete-workspace' &&
        mutation.deleteDirectory !== undefined &&
        typeof mutation.deleteDirectory !== 'boolean'
      ) {
        throw new Error(
          'Project manifest deleteDirectory must be a boolean when provided',
        )
      }
      return
    case 'select-qor-baseline':
      requireString(mutation.workspaceId, 'Project manifest QoR baseline workspace id')
      requireOptionalString(mutation.reason, 'Project manifest QoR baseline reason')
      return
    case 'record-replacement-backup': {
      const input = requireRecord(
        mutation.input,
        'Project manifest replacement backup input',
      )
      requireString(input.replacementId, 'Workspace replacement id')
      requireOptionalString(
        input.fallbackStartStep,
        'Project manifest fallback start step',
      )
      requireOptionalString(input.fallbackEndStep, 'Project manifest fallback end step')
      return
    }
    default:
      throw new Error('Unsupported project manifest mutation')
  }
}

function validateWorkspaceConfig(value: unknown): void {
  const config = requireRecord(value, 'Project manifest workspace config')
  for (const key of ['pdk', 'pdk_root', 'origin_verilog', 'origin_def']) {
    requireOptionalString(config[key], `Project manifest workspace config ${key}`)
  }
  if (
    config.rtl_list !== undefined &&
    (!Array.isArray(config.rtl_list) ||
      config.rtl_list.some((item) => typeof item !== 'string'))
  ) {
    throw new Error(
      'Project manifest workspace config rtl_list must be an array of strings',
    )
  }
  if (config.parameters !== undefined && !isRecord(config.parameters)) {
    throw new Error('Project manifest workspace config parameters must be an object')
  }
}

function validateProjectManifestMpc(value: unknown): void {
  if (value === undefined || value === null) return
  const mpc = requireRecord(value, 'Project manifest MPC')
  const resourceId = requireString(mpc.resource_id, 'Project manifest MPC resource_id')
  if (!resourceId.startsWith('mpc:') || resourceId.length === 4) {
    throw new Error('Project manifest MPC resource_id must be an MPC resource id')
  }
  requireString(mpc.display_name, 'Project manifest MPC display_name')
  requireString(mpc.installed_version, 'Project manifest MPC installed_version')
  const mpcPath = normalizeMpcPath(requireString(mpc.path, 'Project manifest MPC path'))
  const specPath = normalizeMpcPath(
    requireString(mpc.spec_path, 'Project manifest MPC spec_path'),
  )
  if (specPath !== `${mpcPath}/spec/spec.json.in`) {
    throw new Error(
      'Project manifest MPC spec_path must reference spec/spec.json.in below MPC path',
    )
  }
  const design = requireRecord(mpc.design, 'Project manifest MPC design')
  if (!Number.isInteger(design.index) || (design.index as number) < 0) {
    throw new Error('Project manifest MPC design index must be a non-negative integer')
  }
  requireString(design.design_name, 'Project manifest MPC design design_name')
  requireOptionalString(design.directory, 'Project manifest MPC design directory')
  requireRecord(mpc.core_template, 'Project manifest MPC core_template')
}

function normalizeMpcPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.length <= 1 ? normalized : normalized.replace(/\/+$/g, '')
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function requireOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${name} must be a string when provided`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
