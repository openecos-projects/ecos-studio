import { describe, expect, it } from 'vitest'
import source from './AgentExecutionContractPanel.vue?raw'

describe('AgentExecutionContractPanel', () => {
  it('renders all frozen specification rows in a two-column key-value table', () => {
    expect(source).toContain('<table')
    expect(source).toContain('>Key<')
    expect(source).toContain('>Value<')
    expect(source).toContain('v-for="[key, value] in rows"')
    expect(source).toContain('{{ key }}')
    expect(source).toContain('{{ value }}')
    expect(source).toContain('class="w-full table-fixed')
    expect(source).toContain('class="contract-table-shell selectable"')
    expect(source).toContain('max-height: min(18rem, 42vh)')
    expect(source.indexOf('</table>')).toBeLessThan(
      source.indexOf('{{ confirmationText }}'),
    )
  })

  it('embeds the shared confirm and cancel choice and locks it after submission', () => {
    expect(source).toContain('AgentChoiceCard')
    expect(source).toContain(':answered-option-id="answeredOptionId"')
    expect(source).toContain(':disabled="choiceDisabled"')
    expect(source).toContain('@select="emit(\'select\', $event)"')
  })

  it('keeps compact confirm cards without a key-value table when fields are empty', () => {
    expect(source).toContain('v-if="title"')
    expect(source).toContain('v-if="rows.length"')
  })

  it('collapses to a compact receipt after confirmation without a wide status chip', () => {
    expect(source).toContain("Boolean(props.answeredOptionId)")
    expect(source).toContain('contract-panel--committed')
    expect(source).toContain('contract-panel__summary')
    expect(source).toContain('contract-panel__title-row')
    expect(source).toContain("detailsOpen ? 'Hide details' : 'Details'")
    expect(source).not.toContain('contract-state')
    expect(source).toContain('v-if="confirmationText"')
    expect(source.indexOf('isCommitted')).toBeLessThan(
      source.indexOf('v-if="confirmationText"'),
    )
  })
})
