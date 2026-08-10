import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styleSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'index.css'),
  'utf8',
)
const revealSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'scrollbarReveal.ts'),
  'utf8',
)
const mainSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../main.ts'),
  'utf8',
)

describe('global scrollbar styles', () => {
  it('defines shared scrollbar tokens and WebKit-only app-wide styling', () => {
    expect(styleSource).toContain('--scrollbar-size: 8px')
    expect(styleSource).toContain('--scrollbar-thumb-inset: 2px')
    expect(styleSource).toContain('--scrollbar-thumb:')
    expect(styleSource).toContain('--scrollbar-thumb-hover:')
    expect(styleSource).toContain('--scrollbar-track:')
    expect(styleSource).toContain('::-webkit-scrollbar {')
    expect(styleSource).toContain('width: var(--scrollbar-size)')
    expect(styleSource).toContain(
      'border: var(--scrollbar-thumb-inset) solid transparent',
    )
    expect(styleSource).toContain('background-color: transparent')
    expect(styleSource).toContain('*:hover::-webkit-scrollbar-thumb')
    expect(styleSource).toContain('*.is-scrolling::-webkit-scrollbar-thumb')
    expect(styleSource).toContain('background-color: var(--scrollbar-thumb)')
    expect(styleSource).toContain('background-color: var(--scrollbar-thumb-hover)')
    expect(styleSource).not.toContain('scrollbar-width:')
    expect(styleSource).not.toContain('scrollbar-color:')
  })

  it('reveals scrollbars while scrolling via a document-level listener', () => {
    expect(revealSource).toContain("const SCROLLING_CLASS = 'is-scrolling'")
    expect(revealSource).toContain('classList.add(SCROLLING_CLASS)')
    expect(revealSource).toContain("'scroll'")
    expect(revealSource).toContain("'wheel'")
    expect(mainSource).toContain('installScrollbarReveal()')
  })
})
