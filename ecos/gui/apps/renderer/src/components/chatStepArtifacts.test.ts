import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { chatStepArtifactOptions, chatStepArtifactSummary } from './chatStepArtifacts'

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
      items: [{ label: title, content: 'body', format: 'text' }],
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
      imageUrl: 'blob:layout',
      localPath: '/tmp/layout.png',
      info: [],
    },
  }
}

describe('chatStepArtifacts', () => {
  it('summarizes reports and layouts for a collapsed step group', () => {
    const messages = [report('r1', 'place.rpt'), report('r2', 'cong.rpt'), layout('m1')]
    expect(chatStepArtifactSummary(messages)).toBe('2 reports · 1 layout')
    expect(chatStepArtifactOptions(messages).map((option) => option.label)).toEqual([
      'place.rpt',
      'cong.rpt',
      'Layout preview',
    ])
  })
})
