import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ManualPdkConfiguration } from '@ecos-studio/shared'

export async function assertManualPdkConfiguration(
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

function requiredText(value: string, label: string): string {
  const text = value.trim()
  if (!text) throw new Error(`${label} is required`)
  return text
}
