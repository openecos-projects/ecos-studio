import { describe, expect, it } from 'vitest'
import { engineeringSnapshotMetricStep } from './engineeringMetricStep.ts'

describe('engineeringSnapshotMetricStep', () => {
  it('maps the fixed ECC signoff/final scopes to their steps', () => {
    expect(engineeringSnapshotMetricStep({ id: 'die_area', scope: 'final_route' })).toBe(
      'Route',
    )
    expect(engineeringSnapshotMetricStep({ id: 'drc_count', scope: 'final_drc' })).toBe(
      'DRC',
    )
    expect(engineeringSnapshotMetricStep({ id: 'lvs_count', scope: 'final_lvs' })).toBe(
      'LVS',
    )
    expect(
      engineeringSnapshotMetricStep({ id: 'rcx_spef_file_count', scope: 'signoff_rcx' }),
    ).toBe('RCX')
    expect(
      engineeringSnapshotMetricStep({
        id: 'sta_setup_wns',
        scope: 'all_configured_corners',
      }),
    ).toBe('STA')
    expect(
      engineeringSnapshotMetricStep({ id: 'instance_count', scope: 'final_delivery' }),
    ).toBe('Harden')
  })

  it('attributes runtime records through the execution scope suffix', () => {
    expect(
      engineeringSnapshotMetricStep({
        id: 'runtime_seconds',
        scope: 'synthesis_execution',
        analysis_group: 'runtime',
      }),
    ).toBe('Synth')
    expect(
      engineeringSnapshotMetricStep({
        id: 'peak_memory_mb',
        scope: 'sta_execution',
        analysis_group: 'runtime',
      }),
    ).toBe('STA')
  })

  it('derives layout steps from the generic lowercase scope', () => {
    expect(
      engineeringSnapshotMetricStep({ id: 'instance_count', scope: 'placement' }),
    ).toBe('Place')
    expect(engineeringSnapshotMetricStep({ id: 'die_area', scope: 'floorplan' })).toBe(
      'Floor',
    )
    expect(
      engineeringSnapshotMetricStep({ id: 'instance_count', scope: 'legalization' }),
    ).toBe('Legal')
  })

  it('lets the producer-assigned step scope outrank the id prefix', () => {
    // db metrics such as clock_count are re-emitted at every step under that
    // step's scope; only the CTS-owned clock_wirelength id implies CTS alone.
    expect(engineeringSnapshotMetricStep({ id: 'clock_count', scope: 'synthesis' })).toBe(
      'Synth',
    )
    expect(engineeringSnapshotMetricStep({ id: 'clock_count', scope: 'cts' })).toBe('CTS')
  })

  it('falls back to the step-namespaced metric id prefix', () => {
    expect(
      engineeringSnapshotMetricStep({
        id: 'sta_wns_ns',
        scope: 'workspace',
        analysis_group: 'fixture_metrics',
      }),
    ).toBe('STA')
    expect(
      engineeringSnapshotMetricStep({
        id: 'synthesis_cell_area',
        scope: 'workspace',
        analysis_group: 'fixture_metrics',
      }),
    ).toBe('Synth')
    expect(
      engineeringSnapshotMetricStep({ id: 'clock_wirelength', scope: 'workspace' }),
    ).toBe('CTS')
  })

  it('falls back to the default per-step analysis group', () => {
    expect(
      engineeringSnapshotMetricStep({
        id: 'custom_density',
        scope: 'workspace',
        analysis_group: 'harden_metrics',
      }),
    ).toBe('Harden')
  })

  it('leaves unattributable records without a step instead of guessing', () => {
    expect(
      engineeringSnapshotMetricStep({
        id: 'fixture_misc',
        scope: 'workspace',
        analysis_group: 'fixture_metrics',
      }),
    ).toBeNull()
    expect(engineeringSnapshotMetricStep({ id: 'die_area' })).toBeNull()
    expect(engineeringSnapshotMetricStep({ id: 'sta_setup_wns', scope: '  ' })).toBe(
      'STA',
    )
  })
})
