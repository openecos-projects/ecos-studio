// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentInteractionCard from './AgentInteractionCard.vue'
import source from './AgentInteractionCard.vue?raw'

describe('AgentInteractionCard', () => {
  it('uses the same single-column option layout for confirms and choices', () => {
    expect(source).not.toContain('interaction-card__options--confirm')
  })

  it('renders options as bordered interactive surfaces', () => {
    const optionStyle = source.slice(
      source.indexOf('.interaction-card__option {'),
      source.indexOf('.interaction-card__option:hover'),
    )
    expect(source).toContain(
      'border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent)',
    )
    expect(source).toContain('.interaction-card__option:hover:not(:disabled)')
    expect(optionStyle).not.toContain('border: 1px solid transparent')
  })

  it('turns Other into an inline answer input', async () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        interaction: {
          interaction: {
            kind: 'choice',
            options: [
              { id: 'a', label: 'Use the recommendation' },
              { id: 'b', label: 'Keep the current value' },
            ],
            variant: 'list',
          },
          kind: 'choice',
          purpose: 'clarification',
          requestId: 'choice-1',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'Choose an answer',
        },
      },
    })

    expect(
      wrapper.findAll('.interaction-card__index').map((item) => item.text()),
    ).toEqual(['1', '2', '3'])
    await wrapper.get('.interaction-card__other').trigger('click')
    await wrapper.get('input[aria-label="Other answer"]').setValue('Use 72 percent')
    await wrapper.get('.interaction-card__custom-answer').trigger('submit')
    expect(wrapper.emitted('answer')).toEqual([[{ text: 'Use 72 percent' }]])
  })

  it('offers undo only when the backend marks the interaction reversible', async () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        interaction: {
          interaction: {
            kind: 'choice',
            options: [{ id: 'a', label: 'Use the recommendation' }],
            variant: 'list',
          },
          kind: 'choice',
          canUndo: true,
          purpose: 'execution',
          requestId: 'choice-exit',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'Choose an answer',
        },
      },
    })

    await wrapper.get('button[aria-label="Undo last selection"]').trigger('click')

    expect(wrapper.emitted('undo')).toHaveLength(1)
  })

  it('allows fractional values in numeric form fields', async () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        interaction: {
          interaction: {
            fields: [
              {
                defaultValue: 0.7,
                id: 'density',
                kind: 'number',
                label: 'Density',
                required: true,
              },
            ],
            kind: 'form',
          },
          kind: 'form',
          purpose: 'execution',
          requestId: 'form-1',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'Set density',
        },
      },
    })

    const input = wrapper.get('input[type="number"]')
    expect(input.attributes('step')).toBe('any')
    await input.setValue('0.35')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('answer')).toEqual([[{ values: { density: 0.35 } }]])
  })

  it('preselects the highest ranked indexed design and submits its paths', async () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        designCandidates: [
          {
            confidence: 0.8,
            designName: 'gcd',
            id: 'gcd-design',
            reasons: ['Matching SDC found nearby'],
            rtlPath: '/chips/gcd/gcd.v',
            sdcPath: '/chips/gcd/gcd.sdc',
            topModule: 'gcd',
          },
        ],
        designIndexStatus: { rootCount: 1, state: 'ready' },
        interaction: {
          interaction: {
            fields: [{ id: 'value', kind: 'path', label: 'RTL path', required: true }],
            kind: 'form',
          },
          kind: 'form',
          purpose: 'execution',
          requestId: 'rtl-form',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'RTL path',
        },
      },
    })

    expect(wrapper.get('input[type="radio"]').element).toMatchObject({ checked: true })
    await wrapper.get('button[aria-label="Use selected design"]').trigger('click')
    expect(wrapper.emitted('answer')).toEqual([
      [
        {
          designBundle: {
            rtlPath: '/chips/gcd/gcd.v',
            sdcPath: '/chips/gcd/gcd.sdc',
          },
        },
      ],
    ])
  })
})
