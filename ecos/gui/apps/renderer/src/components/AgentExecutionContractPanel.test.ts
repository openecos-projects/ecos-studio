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
})
