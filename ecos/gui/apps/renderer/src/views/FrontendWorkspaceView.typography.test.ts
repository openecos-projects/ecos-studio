import { describe, expect, it } from 'vitest'
import frontendWorkspaceViewSource from './FrontendWorkspaceView.vue?raw'

describe('FrontendWorkspaceView summary typography', () => {
  it('uses one typography treatment for every configuration value', () => {
    const configTemplate = frontendWorkspaceViewSource.slice(
      frontendWorkspaceViewSource.indexOf('class="frontend-config-grid"'),
      frontendWorkspaceViewSource.indexOf(
        '</section>',
        frontendWorkspaceViewSource.indexOf('class="frontend-config-grid"'),
      ),
    )
    const configItems = frontendWorkspaceViewSource.slice(
      frontendWorkspaceViewSource.indexOf('const frontendConfigItems'),
      frontendWorkspaceViewSource.indexOf('const workspaceGuideItems'),
    )
    const valueRules = [
      ...frontendWorkspaceViewSource.matchAll(/\.frontend-config-value\s*\{([^}]*)\}/g),
    ].map((match) => match[1])
    const typographyRule = valueRules.find((rule) => rule.includes('font-family'))

    expect(configTemplate).toContain('class="frontend-config-value"')
    expect(configTemplate).toContain(':class="{ highlight: item.highlight }"')
    expect(configTemplate).not.toContain('item.mono')
    expect(configItems).not.toContain('mono: true')
    expect(typographyRule).toContain('font-family: inherit;')
    expect(typographyRule).toContain('font-size: 13px;')
    expect(typographyRule).toContain('font-weight: 600;')
    expect(typographyRule).toContain('letter-spacing: 0;')
    expect(frontendWorkspaceViewSource).not.toContain('.frontend-config-item strong.mono')
  })
})
