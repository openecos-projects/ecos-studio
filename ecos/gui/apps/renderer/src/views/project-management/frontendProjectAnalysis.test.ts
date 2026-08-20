import { describe, expect, it } from 'vitest'
import { buildFrontendProjectAnalysis } from './frontendProjectAnalysis'

describe('buildFrontendProjectAnalysis', () => {
  it('builds frontend health, comparison, and actionable findings from ECC-FE details', () => {
    const analysis = buildFrontendProjectAnalysis([
      {
        workspaceId: 'ws_0001',
        workspaceName: 'cpu',
        workspacePath: '/projects/cpu/ws_0001',
        status: 'success',
        steps: [
          { stage: 'prepare', status: 'success' },
          { stage: 'review', status: 'success' },
          { stage: 'elab', status: 'success' },
          { stage: 'lint', status: 'success' },
          { stage: 'sim', status: 'success' },
        ],
        detailTexts: {
          prepare: JSON.stringify({
            runtime: '00:00:01',
            summary: {
              inputs: { total_rtl_files: 8, defines: 2, incdirs: 1 },
              contracts: [],
            },
          }),
          review: JSON.stringify({
            summary: {
              rtl_review: {
                errors: 0,
                warnings: 1,
                actionable_warnings: 1,
                modules: 8,
                source_files: 8,
              },
            },
            review: {
              issues: [
                {
                  severity: 'warning',
                  title: 'Wide fanin',
                  detail: 'Review the decode cone.',
                  source: '/rtl/cpu.sv',
                  line: 10,
                },
              ],
            },
          }),
          elab: JSON.stringify({
            summary: {
              elab: { errors: 0, warnings: 0, modules: 116, unresolved_modules: 0 },
            },
            elab: { diagnostics: [] },
          }),
          lint: JSON.stringify({
            summary: {
              lint: { cpu_errors: 0, cpu_warnings: 1, warnings: 25, rules: 3 },
            },
            lint: {
              diagnostics: [
                {
                  severity: 'warning',
                  code: 'UNUSEDSIGNAL',
                  message: 'CPU signal is unused.',
                  ownership: 'cpu',
                  actionable: true,
                },
                {
                  severity: 'warning',
                  code: 'PINCONNECTEMPTY',
                  message: 'Harness pin is empty.',
                  ownership: 'soc',
                  actionable: false,
                },
              ],
            },
          }),
          sim: JSON.stringify({
            summary: { total_cases: 2, passed_cases: 2, failed_cases: 0 },
            cases: [
              { ok: true, metrics: { cycles: 100, difftest: { status: 'passed' } } },
              { ok: true, metrics: { cycles: 120, difftest: { status: 'passed' } } },
            ],
          }),
        },
      },
    ])

    expect(analysis).toMatchObject({
      workspaceCount: 1,
      completeWorkspaceCount: 1,
      completedSteps: 5,
      totalSteps: 5,
      progressPercent: 100,
      totalCases: 2,
      passedCases: 2,
      failedCases: 0,
      passRate: 1,
    })
    expect(analysis.workspaces[0]).toMatchObject({
      errors: 0,
      warnings: 26,
      actionableWarnings: 2,
      cycles: 220,
      difftestPassed: 2,
    })
    expect(analysis.findings.map((finding) => finding.title)).toEqual([
      'Wide fanin',
      'UNUSEDSIGNAL',
    ])
    expect(analysis.workspaces[0]?.steps.map((step) => step.label)).toEqual([
      'Prepare',
      'RTL Review',
      'Elaboration',
      'Lint',
      'Simulation',
    ])
  })
})
