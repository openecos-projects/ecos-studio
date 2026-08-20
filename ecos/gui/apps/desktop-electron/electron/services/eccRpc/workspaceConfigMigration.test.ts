import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateWorkspaceConfigFilenames } from './workspaceConfigMigration'

const temporaryDirectories: string[] = []

const filenameMigrations = [
  ['flow_config.json', 'flow_ecc.json'],
  ['db_default_config.json', 'db_ecc.json'],
  ['cts_default_config.json', 'cts_ecc.json'],
  ['drc_default_config.json', 'drc_ecc.json'],
  ['fp_default_config.json', 'floorplan_ecc.json'],
  ['no_default_config_fixfanout.json', 'fixfanout_ecc.json'],
  ['rt_default_config.json', 'route_ecc.json'],
  ['pl_default_config.json', 'filler_ecc.json'],
  ['rcx.json', 'rcx_ecc.json'],
  ['sta.json', 'sta_ecc.json'],
  ['dreamplace.json', 'dreamplace_ecc.json'],
] as const

function createWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ecos-workspace-config-migration-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'config'))
  return directory
}

describe('migrateWorkspaceConfigFilenames', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('renames legacy config files and rewrites flow ConfigPath values', async () => {
    const directory = createWorkspace()
    const configDirectory = join(directory, 'config')
    const configPaths = Object.fromEntries(
      filenameMigrations.map(([legacy]) => [legacy, join(configDirectory, legacy)]),
    )

    writeFileSync(
      join(configDirectory, 'flow_config.json'),
      JSON.stringify({ ConfigPath: configPaths }),
    )
    for (const [legacy] of filenameMigrations.slice(1)) {
      writeFileSync(join(configDirectory, legacy), '{}')
    }

    await migrateWorkspaceConfigFilenames(directory)

    for (const [legacy, canonical] of filenameMigrations) {
      expect(existsSync(join(configDirectory, legacy))).toBe(false)
      expect(existsSync(join(configDirectory, canonical))).toBe(true)
    }
    const migratedFlow = JSON.parse(
      readFileSync(join(configDirectory, 'flow_ecc.json'), 'utf8'),
    ) as { ConfigPath: Record<string, string> }
    for (const [legacy, canonical] of filenameMigrations) {
      expect(migratedFlow.ConfigPath[legacy]).toBe(join(configDirectory, canonical))
    }
  })
})
