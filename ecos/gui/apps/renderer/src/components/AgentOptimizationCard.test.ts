// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DesktopAgentOptimizationPayload } from '@ecos-studio/shared'
import AgentOptimizationCard from './AgentOptimizationCard.vue'

const authorization: DesktopAgentOptimizationPayload = {
  schema_version: 'ecos.optimization_authorization.v2',
  episode_id: 'episode-1',
  original_primary_metric: 'route_wirelength',
  active_primary_metric: 'drc_count',
  recovery_stage: 'drc',
  violation_counts: {
    drc_count: 14,
    sta_setup_violation_count: 3,
    sta_hold_violation_count: 0,
  },
}

const turnOne: DesktopAgentOptimizationPayload = {
  schema_version: 'ecos.optimization_progress.v2',
  episode_id: 'episode-1',
  turn: 1,
  state: 'executing',
  active_primary_metric: 'drc_count',
  original_primary_metric: 'route_wirelength',
  recovery_stage: 'drc',
  action: { knob_id: 'place.cell_padding_x', direction: 'increase' },
  requested: { knob_id: 'place.cell_padding_x', value: 3 },
  proposal_decision: 'propose',
  proposal_reason: 'observation',
  incumbent_decision: 'candidate_better',
  decisive_metric: 'drc_count',
  violation_counts: {
    drc_count: 14,
    sta_setup_violation_count: 3,
    sta_hold_violation_count: 0,
  },
}

const proposal: DesktopAgentOptimizationPayload = {
  schema_version: 'ecos.optimization_turn_event.v1',
  episode_id: 'episode-1',
  kind: 'proposal',
  proposal_decision: 'propose',
  proposal_reason: 'observation',
  rationale_summary: 'Increase padding to absorb DRC hotspots.',
  action: { knob_id: 'place.cell_padding_x', direction: 'increase' },
  requested: { knob_id: 'place.cell_padding_x', value: 3 },
}

const turnTwo: DesktopAgentOptimizationPayload = {
  schema_version: 'ecos.optimization_progress.v2',
  episode_id: 'episode-1',
  turn: 2,
  state: 'awaiting_execution',
  active_primary_metric: 'drc_count',
  recovery_stage: 'original',
  recovery_transition: 'drc_to_original',
  incumbent_decision: 'candidate_better',
  violation_counts: {
    drc_count: 6,
    sta_setup_violation_count: 1,
    sta_hold_violation_count: 0,
  },
}

describe('AgentOptimizationCard', () => {
  it('shows a failed optimization and its reason even when collapsed', async () => {
    const failure: DesktopAgentOptimizationPayload = {
      ...turnOne,
      schema_version: 'ecos.optimization_status.v1',
      state: 'escalated',
      rejection_reason: 'proposal_repair_failed',
      rationale_summary:
        'Optimization stopped: model proposal validation and repair failed. Reason: proposal_repair_failed.',
      turn: undefined,
    }
    const wrapper = mount(AgentOptimizationCard, {
      props: { optimization: failure, timeline: [failure] },
    })

    expect(wrapper.attributes('data-state')).toBe('error')
    expect(wrapper.text()).toContain('Needs attention')
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'proposal validation and repair failed',
    )
    expect(wrapper.text()).toContain('proposal_repair_failed')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('[role="alert"]').isVisible()).toBe(true)
  })

  it('renders rejected proposal reasons as text, not HTML', () => {
    const rejected = { ...turnOne, rejection_reason: '<img src=x onerror=alert(1)>' }
    const wrapper = mount(AgentOptimizationCard, {
      props: { optimization: rejected, timeline: [rejected] },
    })
    expect(wrapper.text()).toContain(rejected.rejection_reason)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('renders a compact episode summary without duplicating Operation detail', () => {
    const wrapper = mount(AgentOptimizationCard, {
      props: {
        optimization: {
          ...turnTwo,
          in_flight: 2,
          phase: 'running',
          turn_count: 2,
        },
        timeline: [authorization, turnOne, proposal, turnTwo],
      },
    })

    const text = wrapper.text()
    expect(text).toContain('Turn 2')
    expect(text).toContain('2 in flight')
    expect(text).toContain('DRC 6')
    expect(text).toContain('candidate_better')
    expect(text).toContain('drc_to_original')
    expect(text).not.toContain('Authorized')
    expect(text).not.toContain('place.cell_padding_x')
  })

  it('emits explicit episode controls for running and paused states', async () => {
    const running = mount(AgentOptimizationCard, {
      props: {
        optimization: { ...turnOne, phase: 'running', state: 'running' },
        timeline: [turnOne],
      },
    })
    await running.get('[aria-label="Pause optimization"]').trigger('click')
    await running.get('[aria-label="Stop optimization"]').trigger('click')
    expect(running.emitted('control')).toEqual([['pause'], ['stop']])

    const paused = mount(AgentOptimizationCard, {
      props: {
        optimization: { ...turnOne, phase: 'paused', state: 'paused' },
        timeline: [turnOne],
      },
    })
    await paused.get('[aria-label="Resume optimization"]').trigger('click')
    expect(paused.emitted('control')).toEqual([['resume']])

    const interrupted = mount(AgentOptimizationCard, {
      props: {
        optimization: { ...turnOne, phase: 'interrupted', state: 'interrupted' },
        timeline: [turnOne],
      },
    })
    await interrupted.get('[aria-label="Resume optimization"]').trigger('click')
    await interrupted.get('[aria-label="Stop optimization"]').trigger('click')
    expect(interrupted.emitted('control')).toEqual([['resume'], ['stop']])

    const needsAttention = mount(AgentOptimizationCard, {
      props: {
        optimization: {
          ...turnOne,
          phase: 'needs_attention',
          state: 'needs_attention',
        },
        timeline: [turnOne],
      },
    })
    await needsAttention.get('[aria-label="Retry optimization"]').trigger('click')
    expect(needsAttention.emitted('control')).toEqual([['retry']])
  })

  it('renders the proposal rationale as plain text', () => {
    const wrapper = mount(AgentOptimizationCard, {
      props: { optimization: proposal, timeline: [proposal] },
    })

    expect(wrapper.text()).toContain('Increase padding to absorb DRC hotspots.')
    expect(wrapper.find('.optimization-card__summary').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('place.cell_padding_x')
  })
})
