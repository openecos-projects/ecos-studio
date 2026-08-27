import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  editWorkspaceParameters,
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

  it('merges die/core subtrees leaf-wise and keeps [flow] untouched', () => {
    const document = {
      params: {
        core: { utilitization: 0.2, margin: [2, 2], future_knob: 'keep' },
        design: 'gcd',
      },
      flow: { preset: 'syn_sta' },
    }
    const merged = mergePayloadIntoTomlDocument(
      document,
      { Core: { Utilitization: 0.45, Margin: [3, 3] } },
      '/ws',
    )
    // Known members update and unknown nested members survive the save;
    // arrays replace wholesale.
    expect(merged.params.core).toEqual({
      utilitization: 0.45,
      margin: [3, 3],
      future_knob: 'keep',
    })
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

  it('writes legacy parameters.json merging the payload into the existing document', async () => {
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
    // The payload overrides its own keys; keys the GUI does not display
    // (frontend extras, unrelated agent edits) survive the save.
    expect(written).toEqual({
      PDK: 'ICS55',
      Design: 'gcd',
      'Top module': 'gcd',
      'Frequency max [MHz]': 100,
      'Max fanout': 48,
    })
  })

  it('rejects a legacy parameters.json holding an unsafe integer instead of rounding it', async () => {
    const root = createWorkspace()
    writeHomeFile(
      root,
      'parameters.json',
      '{ "Design": "gcd", "Area": 17912481922736482372 }\n',
    )
    await expect(
      writeWorkspaceParameters(root, { Design: 'gcd', 'Max fanout': 48 }),
    ).rejects.toThrow(/MAX_SAFE_INTEGER/)
    // The file is left untouched.
    expect(readFileSync(join(root, 'home', 'parameters.json'), 'utf8')).toContain(
      '17912481922736482372',
    )
  })

  it('preserves unknown nested keys in legacy parameters.json saves', async () => {
    const root = createWorkspace()
    writeHomeFile(
      root,
      'parameters.json',
      '{ "Design": "gcd", "Core": { "Utilitization": 0.2, "Extra": "keep" } }\n',
    )
    await writeWorkspaceParameters(root, { Core: { Utilitization: 0.45 } })
    const written = JSON.parse(
      readFileSync(join(root, 'home', 'parameters.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>
    expect(written.Core).toEqual({ Utilitization: 0.45, Extra: 'keep' })
  })

  it('rejects a non-object JSON root on save instead of overwriting it', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', '[1, 2, 3]\n')
    await expect(writeWorkspaceParameters(root, { Design: 'gcd' })).rejects.toThrow(
      /JSON object/i,
    )
    expect(readFileSync(join(root, 'home', 'parameters.json'), 'utf8')).toBe(
      '[1, 2, 3]\n',
    )
  })

  it('rejects a non-table TOML section on save instead of replacing it', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', 'params = [1]\n')
    await expect(writeWorkspaceParameters(root, { design: 'gcd' })).rejects.toThrow(
      /must be a table/i,
    )
    expect(readFileSync(join(root, 'home', 'ecc.toml'), 'utf8')).toBe('params = [1]\n')
  })

  it('refuses a symlinked config inside the serialized write', async () => {
    const root = createWorkspace()
    const alias = join(root, 'home', 'other.toml')
    writeFileSync(alias, '[params]\ndesign = "gcd"\n')
    symlinkSync(alias, join(root, 'home', 'ecc.toml'))
    await expect(writeWorkspaceParameters(root, { design: 'gcd' })).rejects.toThrow(
      /symlink/i,
    )
    expect(readFileSync(alias, 'utf8')).toBe('[params]\ndesign = "gcd"\n')
  })

  it('refuses a symlinked config pointing outside the config directory', async () => {
    const root = createWorkspace()
    const outside = join(root, 'outside.toml')
    writeFileSync(outside, '[params]\ndesign = "gcd"\n')
    symlinkSync(outside, join(root, 'home', 'ecc.toml'))
    await expect(writeWorkspaceParameters(root, { design: 'gcd' })).rejects.toThrow(
      /no longer resolves/i,
    )
    expect(readFileSync(outside, 'utf8')).toBe('[params]\ndesign = "gcd"\n')
  })

  it('throws when no parameters file exists', async () => {
    const root = createWorkspace()
    await expect(writeWorkspaceParameters(root, { design: 'gcd' })).rejects.toThrow(
      /not found/i,
    )
  })
})

describe('mergePayloadIntoTomlDocument regressions', () => {
  it('deletes a mirror key when the corresponding parameter is emptied', () => {
    const document = {
      design: { name: 'gcd', top: 'gcd' },
      pdk: { root: '/pdk/ics55' },
      params: { design: '', top_module: 'gcd', pdk_root: '' },
    }
    const merged = mergePayloadIntoTomlDocument(
      document,
      { design: '', pdk_root: '' },
      '/ws',
    )
    expect('name' in merged.design).toBe(false)
    expect(merged.design.top).toBe('gcd')
    expect('root' in merged.pdk).toBe(false)
  })

  it('canonicalizes a hand-authored display key before merging so the edit wins', () => {
    const document = {
      params: { 'Target density': 0.45, design: 'gcd' },
    }
    const merged = mergePayloadIntoTomlDocument(document, { target_density: 0.55 }, '/ws')
    expect(merged.params.target_density).toBe(0.55)
    expect('Target density' in merged.params).toBe(false)
  })
})

describe('editWorkspaceParameters', () => {
  it('applies display-key paths to a TOML workspace after canonicalizing them', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    await editWorkspaceParameters(root, [
      { json_path: ['Target density'], value: 0.55 },
      { json_path: ['Core', 'Utilitization'], value: 0.45 },
    ])
    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.target_density).toBe(0.55)
    expect(parameters?.core).toMatchObject({ utilitization: 0.45, margin: [2, 2] })
  })

  it('applies flat paths to a TOML workspace unchanged', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    await editWorkspaceParameters(root, [{ json_path: ['max_fanout'], value: 64 }])
    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.max_fanout).toBe(64)
  })

  it('rejects edits to parameters that do not exist', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    await expect(
      editWorkspaceParameters(root, [{ json_path: ['nonexistent_knob'], value: 1 }]),
    ).rejects.toThrow(/does not exist/i)
  })

  it('applies display-key paths to a legacy parameters.json workspace', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    await editWorkspaceParameters(root, [
      { json_path: ['Frequency max [MHz]'], value: 200 },
    ])
    const written = JSON.parse(
      readFileSync(join(root, 'home', 'parameters.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written['Frequency max [MHz]']).toBe(200)
  })

  it('throws when no parameters file exists', async () => {
    const root = createWorkspace()
    await expect(
      editWorkspaceParameters(root, [{ json_path: ['design'], value: 'x' }]),
    ).rejects.toThrow(/not found/i)
  })

  it('rejects edits when the legacy file holds an unsafe integer', async () => {
    const root = createWorkspace()
    writeHomeFile(
      root,
      'parameters.json',
      '{ "Design": "gcd", "Area": 9007199254740993 }\n',
    )
    await expect(
      editWorkspaceParameters(root, [{ json_path: ['Design'], value: 'aes' }]),
    ).rejects.toThrow(/MAX_SAFE_INTEGER/)
    // The file is left untouched.
    expect(readFileSync(join(root, 'home', 'parameters.json'), 'utf8')).toContain(
      '9007199254740993',
    )
  })

  it('accepts integers up to Number.MAX_SAFE_INTEGER and digit runs inside strings', async () => {
    const root = createWorkspace()
    writeHomeFile(
      root,
      'parameters.json',
      '{ "Design": "gcd17912481922736482372x", "Area": 9007199254740991, "Ratio": 1.5 }\n',
    )
    await editWorkspaceParameters(root, [{ json_path: ['Design'], value: 'aes' }])
    const written = JSON.parse(
      readFileSync(join(root, 'home', 'parameters.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written.Design).toBe('aes')
    expect(written.Area).toBe(9007199254740991)
  })
})

describe('hand-authored display keys in TOML', () => {
  it('canonicalizes them on read and accepts edits against the canonical path', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', '[params]\n"Target density" = 0.45\ndesign = "gcd"\n')
    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.target_density).toBe(0.45)
    expect(parameters && 'Target density' in parameters).toBe(false)

    await editWorkspaceParameters(root, [{ json_path: ['target_density'], value: 0.55 }])
    const updated = await readWorkspaceParameters(root)
    expect(updated?.target_density).toBe(0.55)
  })
})

describe('malformed TOML sections', () => {
  it('rejects a non-table [params] section instead of treating it as empty', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', 'params = [1]\n')
    await expect(readWorkspaceParameters(root)).rejects.toThrow(/must be a table/i)
  })

  it('rejects a scalar [design] section', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', 'design = "gcd"\n[params]\ntop_module = "gcd"\n')
    await expect(readWorkspaceParameters(root)).rejects.toThrow(/must be a table/i)
  })
})

describe('editWorkspaceParameters with an authorized location', () => {
  it('operates on exactly the authorized file instead of re-locating', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    const authorized = join(root, 'home', 'ecc.toml')
    await editWorkspaceParameters(root, [{ json_path: ['max_fanout'], value: 48 }], {
      format: 'toml',
      path: authorized,
    })
    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.max_fanout).toBe(48)
  })
})

describe('json_path hardening', () => {
  it('rejects prototype-related segments instead of mutating Object.prototype', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    await expect(
      editWorkspaceParameters(root, [{ json_path: ['__proto__', 'toString'], value: 1 }]),
    ).rejects.toThrow(/not allowed/i)
    expect(({} as Record<string, unknown>).toString).toBe(Object.prototype.toString)
  })

  it('rejects a constructor segment on a legacy workspace', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'parameters.json', LEGACY_PARAMETERS)
    await expect(
      editWorkspaceParameters(root, [{ json_path: ['constructor'], value: {} }]),
    ).rejects.toThrow(/not allowed/i)
  })
})

describe('write hardening', () => {
  it('parses 64-bit TOML integers beyond the 53-bit safe range', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', '[params]\nseed = 9007199254740993\ndesign = "gcd"\n')
    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.seed).toBe(9007199254740993n)
    expect(parameters?.design).toBe('gcd')
  })

  it('writes atomically without reusing an existing temp file', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)
    const staleTemps = (await import('node:fs/promises')).readdir(join(root, 'home'))
    await writeWorkspaceParameters(root, { 'Frequency max [MHz]': 175 })
    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.frequency_max).toBe(175)
    expect((await staleTemps).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('parameter write serialization', () => {
  it('serializes overlapping save and edit operations so no update is lost', async () => {
    const root = createWorkspace()
    writeHomeFile(root, 'ecc.toml', ECC_TOML)

    const [saved] = await Promise.all([
      writeWorkspaceParameters(root, { 'Frequency max [MHz]': 175 }),
      editWorkspaceParameters(root, [{ json_path: ['max_fanout'], value: 48 }]),
    ])

    const parameters = await readWorkspaceParameters(root)
    expect(parameters?.frequency_max).toBe(175)
    expect(parameters?.max_fanout).toBe(48)
    expect(saved.format).toBe('toml')
  })
})
