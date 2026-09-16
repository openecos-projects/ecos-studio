import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { chatArtifactLightboxFromMessage } from './chatArtifactLightbox'

describe('chatArtifactLightboxFromMessage', () => {
  it('opens a report as maximized text', () => {
    const message: Message = {
      id: 'r1',
      role: 'assistant',
      content: 'place.rpt',
      type: 'info',
      infoData: {
        title: 'place.rpt',
        step: 'Placement',
        items: [{ label: 'place.rpt', content: 'WNS 0.12', format: 'text' }],
      },
    }
    expect(chatArtifactLightboxFromMessage(message)).toEqual({
      title: 'place.rpt',
      mode: 'text',
      body: 'WNS 0.12',
    })
  })

  it('opens a layout preview as a maximized image', () => {
    const message: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Layout preview',
      type: 'map',
      mapData: {
        title: 'Layout preview',
        step: 'Placement',
        imageUrl: 'blob:layout',
        localPath: '/tmp/layout.png',
        info: [],
      },
    }
    expect(chatArtifactLightboxFromMessage(message)).toEqual({
      title: 'Layout preview',
      mode: 'image',
      body: 'blob:layout',
    })
  })
})
