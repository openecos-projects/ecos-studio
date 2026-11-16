import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute } from 'node:path'
import type { PdkConfigureRequest } from '@ecos-studio/shared'

const execute = promisify(execFile)

export interface PdkConfigurationOptions {
  resolveCommand: () => string | null | Promise<string | null>
  envProvider: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>
}

/** ECC is the only parser/writer of the PDK description. */
export class PdkConfigurationService {
  constructor(private readonly options: PdkConfigurationOptions) {}

  async configure(request: PdkConfigureRequest): Promise<Record<string, unknown>> {
    const actions = [
      'schema',
      'init',
      'adopt',
      'discover',
      'show',
      'set',
      'validate',
      'resolve',
      'library-list',
      'library-default',
      'library-locate',
    ]
    if (!request || !actions.includes(request.action)) {
      throw new Error('Unknown PDK configuration action')
    }
    const libraryAction = request.action.startsWith('library-')
    const args = libraryAction
      ? ['pdk', 'library', request.action.slice('library-'.length)]
      : ['pdk', 'configure', request.action]
    if (request.action === 'library-default') {
      if (
        !request.installationId?.trim() ||
        !['ecc', 'studio'].includes(request.client ?? '')
      ) {
        throw new Error('PDK default requires an installation and a client')
      }
      args.push('--installation', request.installationId, '--client', request.client!)
    }
    if (request.action === 'library-locate') {
      if (!request.installationId?.trim() || !request.root || !isAbsolute(request.root)) {
        throw new Error('PDK relocation requires an installation and absolute root')
      }
      args.push('--installation', request.installationId, '--root', request.root)
    }
    if (request.action !== 'schema' && !libraryAction) {
      if (typeof request.root !== 'string' || !isAbsolute(request.root)) {
        throw new Error('PDK root must be an absolute directory path')
      }
      args.push('--root', request.root)
      if (request.descriptionPath !== undefined) {
        if (!isAbsolute(request.descriptionPath)) {
          throw new Error('PDK description path must be absolute')
        }
        if (['discover', 'adopt'].includes(request.action)) {
          throw new Error('This action does not accept a configuration path')
        }
        args.push('--output', request.descriptionPath)
      }
    }
    if (request.action === 'init') {
      if (!request.familyId?.trim()) throw new Error('PDK family is required')
      args.push('--family', request.familyId)
    }
    if (request.action === 'set') {
      if (!request.field || !request.expectedRevision || request.value === undefined) {
        throw new Error('PDK edit requires field, value and expected revision')
      }
      args.push('--field', request.field, '--value-json', JSON.stringify(request.value))
      args.push('--expected-revision', request.expectedRevision)
    }
    const command = await this.options.resolveCommand()
    if (!command) throw new Error('ECC runtime is unavailable')
    const env = await this.options.envProvider()
    let stdout: string
    try {
      const result = await execute(command, args, {
        env,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
      })
      stdout = result.stdout
    } catch (error) {
      const output = (error as { stdout?: unknown }).stdout
      if (typeof output !== 'string' || !output.trim()) throw error
      const result: unknown = JSON.parse(output)
      if (typeof result !== 'object' || result === null || Array.isArray(result))
        throw error
      const response = result as Record<string, unknown>
      if (
        !response.error &&
        !(Array.isArray(response.diagnostics) && response.diagnostics.length)
      ) {
        throw new Error('ECC PDK configuration command failed without a diagnostic')
      }
      return response
    }
    const result: unknown = JSON.parse(stdout)
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('Invalid ECC PDK configuration response')
    }
    return result as Record<string, unknown>
  }
}
