import { describe, expect, it } from 'vitest'
import {
  flowStepCanonicalIds,
  flowStepDefinition,
  flowStepLabel,
  flowStepRegistry,
  isLayoutFlowStep,
  isObsoleteFlowStepName,
  normalizeFlowStepName,
  normalizeProjectManifestFlowStep,
  parseProjectManifestFlowStep,
  sameProjectManifestFlowStep,
} from './flowStepRegistry.ts'

describe('flow step registry', () => {
  it('defines every canonical step exactly once, in canonical order', () => {
    expect(flowStepRegistry.map((step) => step.id)).toEqual([...flowStepCanonicalIds])
  })

  it('gives every step a label, persisted names, and a default tool', () => {
    for (const step of flowStepRegistry) {
      expect(step.label.trim()).not.toBe('')
      expect(step.eccNames.length).toBeGreaterThan(0)
      expect(step.tool.trim()).not.toBe('')
    }
  })

  it('keeps normalized names unique across steps', () => {
    const owner = new Map<string, string>()
    for (const step of flowStepRegistry) {
      for (const name of [step.id, step.label, ...step.eccNames, ...step.aliases]) {
        const key = normalizeFlowStepName(name)
        if (!key) continue
        expect(owner.get(key) ?? step.id).toBe(step.id)
        owner.set(key, step.id)
      }
    }
  })

  it('keeps metric scopes and id prefixes unique across steps', () => {
    const scopes = new Map<string, string>()
    const prefixes = new Map<string, string>()
    for (const step of flowStepRegistry) {
      for (const scope of step.metricScopes) {
        expect(scopes.get(scope) ?? step.id).toBe(step.id)
        scopes.set(scope, step.id)
      }
      for (const prefix of step.metricIdPrefixes) {
        expect(prefixes.get(prefix) ?? step.id).toBe(step.id)
        prefixes.set(prefix, step.id)
      }
    }
  })

  it('pins the classification memberships', () => {
    const by = (
      flag: 'layout' | 'gate' | 'structural' | 'skippable' | 'flowStartDisabled',
    ) => flowStepRegistry.filter((step) => step[flag]).map((step) => step.id)
    expect(by('gate')).toEqual(['RCX', 'STA', 'LVS', 'DRC'])
    expect(by('structural')).toEqual(['Filler', 'RCX', 'Harden'])
    expect(by('skippable')).toEqual(['LEC', 'Timing Opt', 'Post-route LEC'])
    expect(by('flowStartDisabled')).toEqual(['LEC', 'Post-route LEC'])
    expect(by('layout')).toEqual([
      'Floor',
      'Place',
      'CTS',
      'Legal',
      'Timing Opt',
      'Route',
      'Filler',
      'RCX',
      'STA',
      'LVS',
      'DRC',
      'Harden',
    ])
  })

  it('pins the mirror of ECC persisted names and metric scopes', () => {
    expect(flowStepDefinition('Legal')).toMatchObject({
      eccNames: ['legalization'],
      label: 'Legalization',
      metricScopes: ['legalization'],
      tool: 'dreamplace',
    })
    expect(flowStepDefinition('Route').metricScopes).toEqual(['final_route'])
    expect(flowStepDefinition('STA').metricScopes).toEqual(['all_configured_corners'])
    expect(flowStepDefinition('RCX').metricScopes).toEqual(['signoff_rcx'])
    expect(flowStepDefinition('DRC').metricScopes).toEqual(['final_drc'])
    expect(flowStepDefinition('LVS').metricScopes).toEqual(['final_lvs'])
    expect(flowStepDefinition('Harden').metricScopes).toEqual(['final_delivery'])
    expect(flowStepDefinition('Floor').eccNames).toEqual([
      'preFloorplan',
      'macroPlacement',
      'postFloorplan',
    ])
  })
})

describe('parseProjectManifestFlowStep', () => {
  it('accepts canonical ids verbatim', () => {
    for (const id of flowStepCanonicalIds) {
      expect(parseProjectManifestFlowStep(id)).toBe(id)
    }
  })

  it('resolves ECC persisted names', () => {
    expect(parseProjectManifestFlowStep('Synthesis')).toBe('Synth')
    expect(parseProjectManifestFlowStep('legalization')).toBe('Legal')
    expect(parseProjectManifestFlowStep('Timing optimization')).toBe('Timing Opt')
    expect(parseProjectManifestFlowStep('powerAnalysis')).toBe('Power Analysis')
    expect(parseProjectManifestFlowStep('postRouteLec')).toBe('Post-route LEC')
  })

  it('resolves display labels and legacy aliases', () => {
    expect(parseProjectManifestFlowStep('Floorplan')).toBe('Floor')
    expect(parseProjectManifestFlowStep('Pre Floorplan')).toBe('Floor')
    expect(parseProjectManifestFlowStep('Macro Placement')).toBe('Floor')
    expect(parseProjectManifestFlowStep('Legalization')).toBe('Legal')
    expect(parseProjectManifestFlowStep('placement')).toBe('Place')
    expect(parseProjectManifestFlowStep('routing')).toBe('Route')
    expect(parseProjectManifestFlowStep('gds')).toBe('Harden')
    expect(parseProjectManifestFlowStep('signoff')).toBe('Harden')
    expect(parseProjectManifestFlowStep('postlec')).toBe('Post-route LEC')
  })

  it('resolves normalized spellings the diverged alias tables disagreed on', () => {
    expect(parseProjectManifestFlowStep('timing opt')).toBe('Timing Opt')
    expect(parseProjectManifestFlowStep('timingoptimization')).toBe('Timing Opt')
    expect(parseProjectManifestFlowStep('post-route lec')).toBe('Post-route LEC')
    expect(parseProjectManifestFlowStep('macro')).toBe('Floor')
    expect(parseProjectManifestFlowStep('macroplace')).toBe('Floor')
  })

  it('returns null for unknown input', () => {
    expect(parseProjectManifestFlowStep('')).toBeNull()
    expect(parseProjectManifestFlowStep('unknown')).toBeNull()
  })

  it('normalizes and compares step names', () => {
    expect(normalizeProjectManifestFlowStep('legalization')).toBe('Legal')
    expect(normalizeProjectManifestFlowStep('unknown')).toBe('Synth')
    expect(sameProjectManifestFlowStep('Legal', 'legalization')).toBe(true)
    expect(sameProjectManifestFlowStep('Legal', 'route')).toBe(false)
    expect(sameProjectManifestFlowStep('unknown', 'route')).toBe(false)
  })

  it('maps labels through flowStepLabel', () => {
    expect(flowStepLabel('Legal')).toBe('Legalization')
    expect(flowStepLabel('Timing Opt')).toBe('Timing Optimization')
  })
})

describe('obsolete and layout classification', () => {
  it('detects obsolete flow steps independent of spelling', () => {
    expect(isObsoleteFlowStepName('fixfanout')).toBe(true)
    expect(isObsoleteFlowStepName('FixFanout')).toBe(true)
    expect(isObsoleteFlowStepName('fix fanout')).toBe(true)
    expect(isObsoleteFlowStepName('place')).toBe(false)
  })

  it('classifies layout steps from any spelling', () => {
    expect(isLayoutFlowStep('legalization')).toBe(true)
    expect(isLayoutFlowStep('Floorplan')).toBe(true)
    expect(isLayoutFlowStep('sta')).toBe(true)
    expect(isLayoutFlowStep('Synthesis')).toBe(false)
    expect(isLayoutFlowStep('powerAnalysis')).toBe(false)
    expect(isLayoutFlowStep('unknown')).toBe(false)
  })
})
