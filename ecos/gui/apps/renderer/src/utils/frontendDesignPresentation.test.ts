import { describe, expect, it } from 'vitest'
import { preparedFrontendSourceItems } from './frontendDesignPresentation'

describe('preparedFrontendSourceItems', () => {
  it('exposes prepared generic RTL when the report has no generated artifacts', () => {
    const detail = {
      artifacts: [],
      prepare: {
        inputs: {
          design_rtl_files: 1,
          rtl_sources: [
            {
              path: '/ecos-test/simple_counter.v',
              ownership: 'design',
              source: 'input_filelist',
            },
          ],
        },
      },
    }
    expect(preparedFrontendSourceItems(detail.prepare, 'generic_rtl')).toEqual([
      { label: 'simple_counter.v', path: '/ecos-test/simple_counter.v' },
    ])
  })

  it('keeps design sources separate from CPU and harness sources', () => {
    const report = {
      inputs: {
        rtl_sources: [
          { path: '/rtl/design.sv', ownership: 'design' },
          { path: '/rtl/defs.svh', ownership: 'design' },
          { path: '/rtl/cpu.v', ownership: 'cpu' },
          { path: '/rtl/harness.sv', ownership: 'soc' },
        ],
      },
    }
    expect(
      preparedFrontendSourceItems(report, 'generic_rtl').map((item) => item.path),
    ).toEqual(['/rtl/design.sv', '/rtl/defs.svh'])
    expect(
      preparedFrontendSourceItems(report, 'cpu_core').map((item) => item.path),
    ).toEqual(['/rtl/cpu.v'])
  })

  it('handles unavailable Prepare data and ignores incomplete or non-RTL entries', () => {
    expect(preparedFrontendSourceItems(null, 'generic_rtl')).toEqual([])
    expect(preparedFrontendSourceItems({}, 'generic_rtl')).toEqual([])
    expect(
      preparedFrontendSourceItems(
        {
          inputs: {
            rtl_sources: [
              { ownership: 'design' },
              { path: '', ownership: 'design' },
              { path: '/rtl/report.json', ownership: 'design' },
            ],
          },
        },
        'generic_rtl',
      ),
    ).toEqual([])
  })
})
