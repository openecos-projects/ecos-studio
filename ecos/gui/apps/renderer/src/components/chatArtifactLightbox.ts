import { sanitizeHtml } from '@/utils/sanitizeHtml'
import type { Message } from '../types'

export type ChatArtifactLightboxMode = 'html' | 'text' | 'json' | 'image'

export interface ChatArtifactLightboxView {
  title: string
  mode: ChatArtifactLightboxMode
  body: string
}

function coerceReportBody(content: unknown): string {
  return typeof content === 'string' ? content : String(content ?? '')
}

function formatJsonForLightbox(content: unknown): string {
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return coerceReportBody(content)
  }
}

export function chatArtifactLightboxFromMessage(
  message: Message,
  imageUrl?: string,
): ChatArtifactLightboxView | null {
  const resolvedImage = imageUrl || message.mapData?.imageUrl
  if (message.type === 'map' && resolvedImage) {
    return {
      title: message.mapData?.title || 'Layout preview',
      mode: 'image',
      body: resolvedImage,
    }
  }

  const items = message.infoData?.items
  if (!items?.length) return null

  const htmlItem = items.find((item) => item.format === 'html')
  if (htmlItem) {
    return {
      title: htmlItem.label || message.infoData?.title || 'Report',
      mode: 'html',
      body: sanitizeHtml(coerceReportBody(htmlItem.content)),
    }
  }
  const jsonItem = items.find((item) => item.format === 'json')
  if (jsonItem) {
    return {
      title: jsonItem.label || message.infoData?.title || 'Report',
      mode: 'json',
      body: formatJsonForLightbox(jsonItem.content),
    }
  }
  const textItem = items.find((item) => item.format === 'text')
  if (textItem) {
    return {
      title: textItem.label || message.infoData?.title || 'Report',
      mode: 'text',
      body: coerceReportBody(textItem.content),
    }
  }
  return null
}
