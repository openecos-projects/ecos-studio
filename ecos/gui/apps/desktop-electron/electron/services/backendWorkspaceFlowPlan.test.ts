import { describe, expect, it } from 'vitest'
import type { FlowStepSummary } from '@ecos-studio/shared'
import { matchWorkspaceFlowPlan } from './backendWorkspaceFlowPlan'

const steps = ['filler', 'rcx', 'drc', 'sta'].map(
  (stepId, order): FlowStepSummary => ({
    stepId,
    order,
    name: stepId,
    toolId: 'ecc',
    state: 'not-started',
  }),
)
const plan = [
  { record: 'flow_status' },
  {
    record: 'flow_step',
    step: 'filler',
    tool: 'ecc',
    enabled: true,
    stage: 1,
    needs: { routed: null },
  },
  {
    record: 'flow_step',
    step: 'rcx',
    tool: 'ecc',
    enabled: true,
    stage: 2,
    needs: { filled: 'filler' },
  },
  {
    record: 'flow_step',
    step: 'drc',
    tool: 'ecc',
    enabled: true,
    stage: 2,
    needs: { filled: 'filler' },
  },
  {
    record: 'flow_step',
    step: 'sta',
    tool: 'ecc',
    enabled: true,
    stage: 3,
    needs: { parasitics: 'rcx' },
  },
]

describe('matchWorkspaceFlowPlan', () => {
  it('returns ECC stages and input producers for a matching ledger', () => {
    expect(matchWorkspaceFlowPlan(plan, steps)).toEqual([
      { stage: 1, inputProducers: { routed: null } },
      { stage: 2, inputProducers: { filled: 'filler' } },
      { stage: 2, inputProducers: { filled: 'filler' } },
      { stage: 3, inputProducers: { parasitics: 'rcx' } },
    ])
  })

  it('reads explicit design inputs from the selected workspace only', () => {
    const ledger = steps
      .slice(1)
      .map((step) => (step.stepId === 'sta' ? { ...step, inputStep: 'drc' } : step))
    const records = [
      { record: 'workspace_flow', workspace_id: 'trimmed' },
      { ...plan[2], stage: 1, needs: { filled: null }, design_source: null },
      { ...plan[3], stage: 1, needs: { filled: null }, design_source: null },
      { ...plan[4], stage: 2, design_source: 'drc' },
    ]
    expect(matchWorkspaceFlowPlan(records, ledger, 'trimmed')).toEqual([
      { stage: 1, inputProducers: { filled: null }, designSource: null },
      { stage: 1, inputProducers: { filled: null }, designSource: null },
      { stage: 2, inputProducers: { parasitics: 'rcx' }, designSource: 'drc' },
    ])
    expect(matchWorkspaceFlowPlan(records, ledger, 'other')).toBeUndefined()
    records[3] = { ...plan[4], stage: 2, design_source: 'rcx' }
    expect(matchWorkspaceFlowPlan(records, ledger, 'trimmed')).toBeUndefined()
  })

  it('rejects project plans that conflict with the workspace ledger', () => {
    expect(matchWorkspaceFlowPlan(plan, steps.slice(1))).toBeUndefined()
    expect(
      matchWorkspaceFlowPlan(
        plan,
        steps.map((step) =>
          step.stepId === 'rcx' ? { ...step, inputStep: 'filler' } : step,
        ),
      ),
    ).toBeUndefined()
    expect(
      matchWorkspaceFlowPlan(
        plan,
        steps.map((step) =>
          step.stepId === 'rcx' ? { ...step, toolId: 'other' } : step,
        ),
      ),
    ).toBeUndefined()
  })
})
