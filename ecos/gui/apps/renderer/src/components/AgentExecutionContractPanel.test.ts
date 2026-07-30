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
    expect(source).toContain('class="selectable w-full')
    expect(source.indexOf('</table>')).toBeLessThan(
      source.indexOf('{{ confirmationText }}'),
    )
  })
})
