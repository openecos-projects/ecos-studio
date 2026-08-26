import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  locateWorkspaceParametersFile,
  mergePayloadIntoTomlDocument,
  mergeTomlSections,
  readWorkspaceParameters,
  writeWorkspaceParameters,
} from './workspaceParametersFile'

const temporaryDirectories: string[] = []

function createWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ecos-workspace-parameters-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'home'), { recursive: true })
  return directory
}

function writeHomeFile(root: string, name: string, content: string): void {
  writeFileSync(join(root, 'home', name), content)
}

const ECC_TOML = `
[design]
name = "gcd"
top = "gcd"
clock_port = "clk"
frequency_mhz = 100.0

[pdk]
name = "ics55"
root = "/pdk/ics55"

[flow]
preset = "rtl2gds"

[params]
pdk = "ics55"
design = "gcd"
top_module = "gcd"
clock = "clk"
frequency_max = 100.0
max_fanout = 20
target_density = 0.2
pdk_root = "/pdk/ics55"
pdk_config = "home/pdk.json"

[params.core]
utilitization = 0.2
margin = [ 2, 2 ]
`

const LEGACY_PARAMETERS = JSON.stringify(
  {
    PDK: 'ICS55',
    Design: 'gcd',
    'Top module': 'gcd',
    'Frequency max [MHz]': 100,
  },
  null,
  4,
)

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('locateWorkspaceParametersFile', () => {
  it('prefers home/ecc.toml over home/parameters.json', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    const location = await locateWorkspaceParametersFile(root)
    expect(location?.format).toBe('toml')
    expect(location?.path).toBe(join(root, 'home', 'ecc.toml'))
  })

  it('falls back to legacy parameters.json', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    const location = await locateWorkspaceParametersFile(root)
    expect(location?.format).toBe('json')
    expect(location?.path).toBe(join(root, 'home', 'parameters.json'))
  })

  it('returns null when neither file exists', async () => {
    const root = createWorkspace()
    expect(await locateWorkspaceParametersFile(root)).toBeNull()
  })
})

describe('mergeTomlSections', () => {
  it('flattens [params] with [design]/[pdk] mirrors overriding mapped keys', () => {
    const document = {
      design: { name: 'gcd', top: 'gcd', clock_port: 'clk', frequency_mhz: 100.0 },
      pdk: { name: 'ics55', root: '/pdk/ics55' },
      params: { design: 'stale', frequency_max: 50, max_fanout: 20 },
    }
    expect(mergeTomlSections(document, '/ws')).toEqual({
      design: 'gcd',
      top_module: 'gcd',
      clock: 'clk',
      frequency_max: 100.0,
      pdk: 'ics55',
      pdk_root: '/pdk/ics55',
      max_fanout: 20,
    })
  })

  it('keeps [params] values when section mirrors are empty', () => {
    const document = {
      design: { name: '' },
      params: { design: 'gcd', frequency_max: 100 },
    }
    const merged = mergeTomlSections(document, '/ws')
    expect(merged.design).toBe('gcd')
    expect(merged.frequency_max).toBe(100)
  })

  it('resolves workspace-relative pdk_config against the workspace root', () => {
    const document = { params: { pdk_config: 'home/pdk.json' } }
    const merged = mergeTomlSections(document, '/ws')
    expect(merged.pdk_config).toBe(join('/ws', 'home/pdk.json'))
  })

  it('keeps absolute pdk_config unchanged', () => {
    const document = { params: { pdk_config: '/elsewhere/pdk.json' } }
    const merged = mergeTomlSections(document, '/ws')
    expect(merged.pdk_config).toBe('/elsewhere/pdk.json')
  })

  it('ignores the [flow] section', () => {
    const document = { flow: { preset: 'rtl2gds' }, params: { design: 'gcd' } }
    const merged = mergeTomlSections(document, '/ws')
    expect(merged).toEqual({ design: 'gcd' })
  })
})

describe('readWorkspaceParameters', () => {
  it('reads and flattens home/ecc.toml', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    const parameters = await readWorkspaceParameters(root)
    expect(parameters).toMatchObject({
      design: 'gcd',
      top_module: 'gcd',
      clock: 'clk',
      frequency_max: 100.0,
      max_fanout: 20,
      target_density: 0.2,
      pdk: 'ics55',
      pdk_root: '/pdk/ics55',
      core: { utilitization: 0.2, margin: [2, 2] },
    })
    expect(parameters?.pdk_config).toBe(join(root, 'home/pdk.json'))
  })

  it('reads legacy parameters.json unchanged', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    const parameters = await readWorkspaceParameters(root)
    expect(parameters).toEqual({
      PDK: 'ICS55',
      Design: 'gcd',
      'Top module': 'gcd',
      'Frequency max [MHz]': 100,
    })
  })

  it('returns null when neither file exists', async () => {
    const root = createWorkspace()
    expect(await readWorkspaceParameters(root)).toBeNull()
  })

  it('throws on malformed TOML instead of falling back', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', '[design\nname = ')
    await expect(readWorkspaceParameters(root)).rejects.toThrow(/toml/i)
  })

  it('throws on malformed JSON instead of falling back', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', '{not json')
    await expect(readWorkspaceParameters(root)).rejects.toThrow(/json/i)
  })
})

describe('mergePayloadIntoTomlDocument', () => {
  it('merges display-key payload into [params] and re-syncs mirrors', () => {
    const document = {
      design: { name: 'gcd', top: 'gcd', clock_port: 'clk', frequency_mhz: 100.0 },
      pdk: { name: 'ics55', root: '/pdk/ics55' },
      flow: { preset: 'rtl2gds' },
      params: {
        design: 'gcd',
        top_module: 'gcd',
        clock: 'clk',
        frequency_max: 100.0,
        max_fanout: 20,
        sta_max_paths: 1000,
      },
    }
    const merged = mergePayloadIntoTomlDocument(
      document,
      { 'Frequency max [MHz]': 200, 'Max fanout': 32 },
      '/ws',
    )
    expect(merged.params).toMatchObject({ frequency_max: 200, max_fanout: 32 })
    expect(merged.params.sta_max_paths).toBe(1000)
    expect(merged.design).toMatchObject({ frequency_mhz: 200 })
    expect(merged.flow).toEqual({ preset: 'rtl2gds' })
  })

  it('replaces die/core subtrees wholesale and keeps [flow] untouched', () => {
    const document = {
      params: { core: { utilitization: 0.2, margin: [2, 2] }, design: 'gcd' },
      flow: { preset: 'syn_sta' },
    }
    const merged = mergePayloadIntoTomlDocument(
      document,
      { Core: { Utilitization: 0.45, Margin: [3, 3] } },
      '/ws',
    )
    expect(merged.params.core).toEqual({ utilitization: 0.45, margin: [3, 3] })
    expect(merged.flow).toEqual({ preset: 'syn_sta' })
  })

  it('stores pdk_config relative when it points inside the workspace', () => {
    const document = { params: { design: 'gcd' } }
    const merged = mergePayloadIntoTomlDocument(
      document,
      { pdk_config: '/ws/home/pdk.json' },
      '/ws',
    )
    expect(merged.params.pdk_config).toBe('home/pdk.json')
  })

  it('keeps outside pdk_config absolute', () => {
    const document = { params: { design: 'gcd' } }
    const merged = mergePayloadIntoTomlDocument(
      document,
      { pdk_config: '/elsewhere/pdk.json' },
      '/ws',
    )
    expect(merged.params.pdk_config).toBe('/elsewhere/pdk.json')
  })
})

describe('writeWorkspaceParameters', () => {
  it('round-trips a TOML write: edit survives, other sections preserved', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    const location = await writeWorkspaceParameters(root, {
      'Frequency max [MHz]': 250,
      'Max fanout': 24,
    })
    expect(location.format).toBe('toml')

    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.frequency_max).toBe(250)
    expect(parameters?.max_fanout).toBe(24)
    expect(parameters?.design).toBe('gcd')
    expect(parameters?.sta_max_paths).toBeUndefined()

    const text = readFileSync(join(root, 'home', 'ecc.toml'), 'utf8')
    expect(text).toContain('[flow]')
    expect(text).toContain('preset = "rtl2gds"')
    expect(text).toContain('frequency_mhz = 250')
    expect(text).not.toContain('parameters.json')
  })

  it('writes legacy parameters.json as formatted JSON', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    const location = await writeWorkspaceParameters(root, {
      PDK: 'ICS55',
      Design: 'gcd',
      'Max fanout': 48,
    })
    expect(location.format).toBe('json')
    const written = JSON.parse(
      readFileSync(join(root, 'home', 'parameters.json'), 'utf8'),
    )
    expect(written).toEqual({ PDK: 'ICS55', Design: 'gcd', 'Max fanout': 48 })
  })

  it('throws when no parameters file exists', async () => {
    const root = createWorkspace()
    await expect(writeWorkspaceParameters(root, { design: 'gcd' })).rejects.toThrow(
      /not found/i,
    )
  })
})
