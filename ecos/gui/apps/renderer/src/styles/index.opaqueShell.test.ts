import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesDir = dirname(fileURLToPath(import.meta.url))
const indexCss = readFileSync(join(stylesDir, 'index.css'), 'utf8')
const homeAgentDrawer = readFileSync(
  join(stylesDir, '../components/HomeAgentDrawer.vue'),
  'utf8',
)

describe('opaque desktop shell chrome', () => {
  it('keeps html/body/#app on a solid theme background', () => {
    expect(indexCss).toContain('background: var(--bg-primary)')
    expect(indexCss).not.toMatch(/html,\s*body\s*\{[^}]*background:\s*transparent/s)
    expect(indexCss).not.toMatch(/#app\s*\{[^}]*background:\s*transparent/s)
  })

  it('uses higher-contrast border tokens for remote compositors', () => {
    expect(indexCss).toContain('--border-color: #d9e0e0')
    expect(indexCss).toContain('--border-color: #52525b')
  })

  it('separates the home agent drawer with a solid border on the primary surface', () => {
    expect(homeAgentDrawer).toContain('border-left: 1px solid var(--border-color)')
    expect(homeAgentDrawer).toContain('background: var(--bg-primary)')
    expect(homeAgentDrawer).not.toContain(
      'border-left: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent)',
    )
  })
})
