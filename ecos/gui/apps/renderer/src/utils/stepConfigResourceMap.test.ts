import { describe, expect, it } from 'vitest'
import { projectManagementWorkspaceReadablePaths } from '@ecos-studio/shared'
import {
  baselineStepConfigReadPaths,
  pickConfigText,
  resolveStepConfigResource,
} from './stepConfigResourceMap'

describe('resolveStepConfigResource', () => {
  it('maps ecc steps by lowercased step name (route, not routing)', () => {
    expect(resolveStepConfigResource({ name: 'Floorplan', tool: 'ecc' })).toEqual({
      kind: 'config',
      path: 'config/floorplan_ecc.json',
      legacyPaths: ['config/fp_default_config.json'],
    })
    expect(resolveStepConfigResource({ name: 'route', tool: 'ECC' })).toEqual({
      kind: 'config',
      path: 'config/route_ecc.json',
      legacyPaths: ['config/rt_default_config.json'],
    })
    expect(resolveStepConfigResource({ name: 'fixFanout', tool: 'ecc' })).toEqual({
      kind: 'config',
      path: 'config/fixfanout_ecc.json',
      legacyPaths: ['config/no_default_config_fixfanout.json'],
    })
    expect(resolveStepConfigResource({ name: 'CTS', tool: 'ecc' })).toMatchObject({
      path: 'config/cts_ecc.json',
    })
    expect(resolveStepConfigResource({ name: 'RCX', tool: 'ecc' })).toMatchObject({
      path: 'config/rcx_ecc.json',
      legacyPaths: ['config/rcx.json'],
    })
  })

  it('maps dreamplace regardless of step name', () => {
    expect(resolveStepConfigResource({ name: 'place', tool: 'dreamplace' })).toEqual({
      kind: 'config',
      path: 'config/dreamplace_ecc.json',
      legacyPaths: ['config/dreamplace.json'],
    })
    expect(resolveStepConfigResource({ name: 'legalization', tool: 'DreamPlace' })).toMatchObject({
      path: 'config/dreamplace_ecc.json',
    })
  })

  it('returns none for yosys and unmapped ecc step names', () => {
    expect(resolveStepConfigResource({ name: 'Synthesis', tool: 'yosys' })).toEqual({
      kind: 'none',
    })
    expect(resolveStepConfigResource({ name: 'GDS', tool: 'ecc' })).toEqual({ kind: 'none' })
    expect(resolveStepConfigResource({ name: 'Init', tool: 'unknown' })).toEqual({ kind: 'none' })
  })

  it('describes frontend tool configs (not statically allowlistable)', () => {
    expect(resolveStepConfigResource({ name: 'Lint', tool: 'verilator' })).toEqual({
      kind: 'frontend',
      directoryName: 'Lint_verilator',
      path: 'Lint_verilator/config/flow_config.json',
    })
    expect(resolveStepConfigResource({ name: 'Elab', tool: 'sland' })).toEqual({ kind: 'none' })
  })
})

describe('baselineStepConfigReadPaths', () => {
  it('requests flow.json plus every allowlisted config file within the read limit', () => {
    expect(baselineStepConfigReadPaths[0]).toBe('home/flow.json')
    expect(new Set(baselineStepConfigReadPaths).size).toBe(baselineStepConfigReadPaths.length)
    for (const path of baselineStepConfigReadPaths) {
      expect(projectManagementWorkspaceReadablePaths).toContain(path)
    }
    expect(baselineStepConfigReadPaths.length).toBeLessThanOrEqual(
      projectManagementWorkspaceReadablePaths.length,
    )
  })
})

describe('pickConfigText', () => {
  const resource = {
    kind: 'config' as const,
    path: 'config/cts_ecc.json',
    legacyPaths: ['config/cts_default_config.json'],
  }

  it('prefers the canonical file when present', () => {
    expect(
      pickConfigText(
        { 'config/cts_ecc.json': '{"a":1}', 'config/cts_default_config.json': '{"a":2}' },
        resource,
      ),
    ).toEqual({ path: 'config/cts_ecc.json', text: '{"a":1}' })
  })

  it('falls back to the legacy filename', () => {
    expect(pickConfigText({ 'config/cts_default_config.json': '{"a":2}' }, resource)).toEqual({
      path: 'config/cts_default_config.json',
      text: '{"a":2}',
    })
  })

  it('returns null when no candidate exists', () => {
    expect(pickConfigText({}, resource)).toBeNull()
    expect(
      pickConfigText({ 'config/cts_ecc.json': null, 'config/cts_default_config.json': null }, resource),
    ).toBeNull()
  })
})
