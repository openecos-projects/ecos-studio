<template>
  <aside
    v-if="open"
    class="user-guide-panel"
    role="complementary"
    aria-label="User Guide"
    :style="{ width: panelWidthStyle }"
    @click="handleContentClick"
  >
    <div class="user-guide-panel__header">
      <div class="user-guide-panel__title">
        <i class="ri-book-open-line" aria-hidden="true"></i>
        <span>User Guide</span>
      </div>
      <button
        type="button"
        class="user-guide-panel__close"
        title="Close user guide"
        aria-label="Close user guide"
        @click="closePanel"
      >
        <i class="ri-close-line" aria-hidden="true"></i>
      </button>
    </div>
    <div
      ref="contentRef"
      class="user-guide-panel__body markdown-body selectable"
      v-html="renderedGuide"
    ></div>
    <div
      class="user-guide-panel-resize-handle"
      title="Resize User Guide panel"
      aria-label="Resize User Guide panel"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="onResizePointerDown"
    ></div>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import MarkdownIt from 'markdown-it'
import userGuideSource from '../../../../../docs/user-guide.md?raw'
import { sanitizeHtml } from '@/utils/sanitizeHtml'
import { getDesktopApi } from '@/platform/desktop'
import { useUserGuideStore } from '@/stores/userGuideStore'
import { useUserGuidePanelResize } from '@/composables/useUserGuidePanelResize'

const userGuide = useUserGuideStore()
const { open } = storeToRefs(userGuide)
const { closePanel } = userGuide

/** True while the main process extended the window width for this panel. */
const windowExtended = ref(false)

async function syncWindowExtension(widthPx: number): Promise<void> {
  try {
    const applied = await getDesktopApi().window.setLeftPanelExtension(widthPx)
    windowExtended.value = applied > 0
    // Align with the applied width when growth was capped at the screen edge.
    if (widthPx > 0 && applied > 0 && applied !== widthPx) {
      userGuide.setPanelWidthPx(applied)
    }
  } catch {
    // Bridge unavailable (plain browser / tests): panel simply squeezes content.
    windowExtended.value = false
  }
}

/** Use viewport as the width budget for the left panel. */
const viewportRef = ref<HTMLElement | null>(
  typeof document !== 'undefined' ? document.documentElement : null,
)
const { panelWidthStyle, onResizePointerDown } = useUserGuidePanelResize(viewportRef, {
  onResizeEnd: (widthPx) => {
    if (open.value && windowExtended.value) void syncWindowExtension(widthPx)
  },
})

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]?.attrGet('href') ?? ''
  // In-page anchors scroll inside the panel instead of opening a new window.
  if (!href.startsWith('#')) {
    tokens[idx]?.attrSet('target', '_blank')
    tokens[idx]?.attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const renderedGuide = sanitizeHtml(md.render(userGuideSource))

const contentRef = ref<HTMLElement | null>(null)

/** GitHub-style heading slug so the guide's table of contents resolves. */
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/**
 * sanitizeHtml strips `id` attributes, so assign heading ids on the live DOM
 * after rendering instead of widening the sanitizer allow-list.
 */
function assignHeadingIds(): void {
  const root = contentRef.value
  if (!root) return
  const used = new Set<string>()
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (heading.id) {
      used.add(heading.id)
      continue
    }
    const base = slugifyHeading(heading.textContent ?? '') || 'section'
    let slug = base
    let suffix = 1
    while (used.has(slug)) {
      slug = `${base}-${suffix}`
      suffix += 1
    }
    used.add(slug)
    heading.id = slug
  }
}

function scrollToAnchor(id: string): void {
  if (!id) return
  const target = contentRef.value?.querySelector(`#${CSS.escape(id)}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleContentClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    event.preventDefault()
    scrollToAnchor(decodeURIComponent(href.slice(1)))
    return
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    try {
      const desktopApi = getDesktopApi()
      event.preventDefault()
      void desktopApi.system.openExternal(href)
    } catch {
      /* Bridge unavailable (plain browser): fall back to target=_blank. */
    }
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    // Opening recreates the panel DOM (v-if), so restore the heading ids and
    // grow the window to keep the app content width unchanged.
    await nextTick()
    assignHeadingIds()
    void syncWindowExtension(userGuide.panelWidthPx)
    return
  }
  if (windowExtended.value) {
    void syncWindowExtension(0)
  }
})
</script>

<style scoped>
.user-guide-panel {
  position: relative;
  display: flex;
  flex-shrink: 0;
  min-width: 280px;
  max-width: min(760px, 100vw);
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.user-guide-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.user-guide-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.user-guide-panel__title i {
  color: var(--accent-color);
  font-size: 15px;
}

.user-guide-panel__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 15px;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.user-guide-panel__close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.user-guide-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 20px 24px;
  font-size: 0.875rem;
  line-height: 1.7;
}

.user-guide-panel-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -3px;
  z-index: 2;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}

.user-guide-panel-resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 3px;
  width: 1px;
  background: transparent;
  transition:
    background-color 120ms ease,
    width 120ms ease,
    right 120ms ease;
}

.user-guide-panel-resize-handle:hover::before,
:global(body.user-guide-panel-resizing) .user-guide-panel-resize-handle::before {
  right: 2px;
  width: 2px;
  background: var(--accent-color);
}

.markdown-body {
  word-break: break-word;
  color: var(--text-primary);
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  scroll-margin-top: 8px;
}

.markdown-body :deep(h1) {
  margin: 0.5rem 0 0.75rem;
  padding-bottom: 0.375rem;
  font-size: 1.375rem;
  font-weight: 700;
  border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(h2) {
  margin: 1.5rem 0 0.5rem;
  padding-bottom: 0.25rem;
  font-size: 1.125rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(h3) {
  margin: 1.125rem 0 0.375rem;
  font-size: 1rem;
  font-weight: 600;
}

.markdown-body :deep(h4) {
  margin: 1rem 0 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.markdown-body :deep(p) {
  margin-bottom: 0.625rem;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(a) {
  color: var(--accent-color);
  text-decoration: underline;
}

.markdown-body :deep(code) {
  background-color: color-mix(in srgb, var(--border-color) 58%, transparent);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.8125rem;
}

.markdown-body :deep(pre) {
  background-color: var(--bg-secondary);
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.75rem 0;
  border: 1px solid var(--border-color);
}

.markdown-body :deep(pre code) {
  background-color: transparent;
  padding: 0;
  display: block;
}

.markdown-body :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5rem;
  margin-bottom: 0.625rem;
}

.markdown-body :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin-bottom: 0.625rem;
}

.markdown-body :deep(li) {
  margin-bottom: 0.25rem;
}

.markdown-body :deep(strong) {
  font-weight: 600;
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(blockquote) {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  margin: 0.75rem 0;
  background-color: var(--bg-secondary);
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 1.25rem 0;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 0.75rem 0;
  width: 100%;
  font-size: 0.8125rem;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border-color);
  padding: 0.375rem 0.625rem;
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--bg-secondary);
  font-weight: 600;
}

.markdown-body :deep(img) {
  max-width: 100%;
}
</style>
