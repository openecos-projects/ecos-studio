// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import ChatStepArtifactGroup from './ChatStepArtifactGroup.vue'

function report(id: string, title: string): Message {
  return {
    id,
    role: 'assistant',
    content: title,
    type: 'info',
    isGuiArtifact: true,
    status: 'done',
    infoData: {
      title,
      step: 'Placement',
      items: [{ label: title, content: `${title} body`, format: 'text' }],
    },
  }
}

function layout(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: 'Layout preview',
    type: 'map',
    isGuiArtifact: true,
    status: 'done',
    mapData: {
      title: 'Layout preview',
      step: 'Placement',
      imageUrl: `blob:${id}`,
      localPath: `/workspace/${id}.png`,
      info: [],
      showLegend: false,
    },
  }
}

describe('ChatStepArtifactGroup', () => {
  it('keeps step results collapsed until expanded, then renders each full result', async () => {
    const wrapper = mount(ChatStepArtifactGroup, {
      props: {
        step: 'Placement',
        messages: [report('r1', 'place.rpt'), report('r2', 'cong.rpt')],
      },
    })

    expect(wrapper.text()).toContain('Placement')
    expect(wrapper.text()).toContain('2 reports')
    expect(wrapper.text()).not.toContain('place.rpt body')

    await wrapper.get('.step-group__head').trigger('click')
    expect(wrapper.get('.step-group__head').attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('place.rpt body')
    expect(wrapper.text()).toContain('cong.rpt body')
  })

  it('mounts the layout image when the step group is expanded', async () => {
    const wrapper = mount(ChatStepArtifactGroup, {
      props: { step: 'Placement', messages: [layout('place')] },
    })

    expect(wrapper.find('img.map-image').exists()).toBe(false)
    await wrapper.get('.step-group__head').trigger('click')
    expect(wrapper.find('img.map-image').attributes('src')).toBe('blob:place')
  })
})
