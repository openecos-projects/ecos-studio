// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentInteractionCard from './AgentInteractionCard.vue'

describe('AgentInteractionCard', () => {
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
})
