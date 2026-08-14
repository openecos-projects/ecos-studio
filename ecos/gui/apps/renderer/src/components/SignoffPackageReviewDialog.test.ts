import { describe, expect, it } from 'vitest'
import source from './SignoffPackageReviewDialog.vue?raw'

describe('SignoffPackageReviewDialog', () => {
  it('renders resource and risk summaries with a blocked export guard', () => {
    expect(source).toContain('header="Signoff Package Review"')
    expect(source).toContain('Resource Summary')
    expect(source).toContain('Risk Details')
    expect(source).toContain('v-for="group in result.groups"')
    expect(source).toContain('v-for="risk in result.risks"')
    expect(source).toContain("result.status === 'blocked'")
  })

  it('renders each structured risk detail in the operational risk panel', () => {
    expect(source).toContain('v-for="detail in risk.details"')
    expect(source).toContain('{{ detail.label }}')
    expect(source).toContain('{{ detail.location }}')
    expect(source).toContain('{{ detail.reason }}')
    expect(source).toContain(':data-kind="detail.kind"')
    expect(source).toContain("if (kind === 'quality_gate') return 'QoR Gate'")
    expect(source).toContain("detail.owner === 'qor' ? 'QoR' : 'Checklist'")
    expect(source).toContain("if (kind === 'freshness') return 'Analysis Refresh'")
  })

  it('uses shared semantic tokens and a responsive two-column layout', () => {
    expect(source).toContain('var(--success-color)')
    expect(source).toContain('var(--warn-color)')
    expect(source).toContain('var(--danger-color)')
    expect(source).toContain(
      'grid-template-columns: minmax(210px, 0.72fr) minmax(0, 1.28fr)',
    )
    expect(source).toContain('@media (max-width: 760px)')
  })

  it('exposes accessible refresh, close, and export controls', () => {
    expect(source).toContain('aria-label="Recheck current outputs"')
    expect(source).toContain('@click="emit(\'refresh\')"')
    expect(source).toContain('@click="emit(\'close\')"')
    expect(source).toContain('v-model="outputPath"')
    expect(source).toContain('@click="emit(\'export\', outputPath.trim())"')
    expect(source).toContain('Export Package')
  })
})
