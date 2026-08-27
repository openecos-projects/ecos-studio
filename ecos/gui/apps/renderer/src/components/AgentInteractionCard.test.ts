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

  it('does not present selection undo inside a form', () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        interaction: {
          canUndo: true,
          interaction: {
            fields: [{ id: 'name', kind: 'text', label: 'Workspace Name' }],
            kind: 'form',
          },
          kind: 'form',
          purpose: 'execution',
          requestId: 'workspace-name',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'Workspace Name',
        },
      },
    })

    expect(wrapper.find('button[aria-label="Undo last selection"]').exists()).toBe(false)
  })

  it('renders parameter values and offers an explicit no-change action', async () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        interaction: {
          description: [
            'Parameters available for this stage:',
            '| Parameter | Current value |',
            '| --- | --- |',
            '| floorplan.aspect_ratio | 0.996 |',
            '| floorplan.die_height | 53.0 |',
            'Describe the parameter change and value.',
          ].join('\n'),
          interaction: {
            fields: [
              {
                id: 'value',
                kind: 'text',
                label: 'Parameter changes',
                required: false,
              },
            ],
            kind: 'form',
          },
          kind: 'form',
          purpose: 'execution',
          requestId: 'parameters',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'Parameter changes',
        },
      },
    })

    expect(wrapper.findAll('.interaction-card__parameter-list div').map((row) => row.text())).toEqual([
      'floorplan.aspect_ratio0.996',
      'floorplan.die_height53.0',
    ])
    expect(wrapper.find('.interaction-card__parameter-summary').text()).not.toContain('| --- |')
    expect(wrapper.text().split('Parameter changes')).toHaveLength(2)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    await wrapper.get('button[type="button"]').trigger('click')
    expect(wrapper.emitted('answer')).toEqual([[{ values: { value: '' } }]])
  })

  it('requests an RTL file and applies it to the path field', async () => {
    const wrapper = mount(AgentInteractionCard, {
      props: {
        interaction: {
          interaction: {
            fields: [
              {
                extensions: ['v', 'sv'],
                id: 'value',
                kind: 'path',
                label: 'RTL path',
                required: true,
              },
            ],
            kind: 'form',
          },
          kind: 'form',
          purpose: 'execution',
          requestId: 'rtl-path',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'RTL path',
        },
      },
    })

    await wrapper.get('button[aria-label="Choose RTL file"]').trigger('click')
    expect(wrapper.emitted('browseRtl')).toHaveLength(1)
    wrapper.vm.setFieldValue('value', '/design/gcd.v')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('answer')).toEqual([[{ values: { value: '/design/gcd.v' } }]])
  })
})
