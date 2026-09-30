// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAgentActivity } from '@ecos-studio/shared'
import AgentActivityStream from './AgentActivityStream.vue'

const base = {
  itemId: 'reasoning-1',
  schema_version: 'flow-agent.activity.v1' as const,
  startedAt: 1000,
  status: 'running' as const,
  turnId: 'turn-1',
  turnStartedAt: 900,
}

describe('AgentActivityStream', () => {
  afterEach(() => vi.useRealTimers())

  it('shows and updates elapsed time before the first activity item arrives', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5900)
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: { items: [], startedAt: 900, turnId: 'turn-1' },
        status: 'loading',
      },
    })

    expect(wrapper.text()).toContain('Working for 5s')
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.text()).toContain('Working for 7s')
  })

  it('shows ordered reasoning and observable actions without generic Thinking copy', () => {
    const items: DesktopAgentActivity[] = [
      {
        ...base,
        kind: 'reasoning_summary',
        summary: ['Locating the CTS definition.'],
      },
      {
        ...base,
        command: 'rg CTS',
        itemId: 'command-1',
        kind: 'command_execution',
        label: 'Searched workspace',
      },
    ]
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: { items, startedAt: 900, turnId: 'turn-1' },
        status: 'loading',
      },
    })

    expect(wrapper.text()).toContain('Locating the CTS definition.')
    expect(wrapper.text()).toContain('Searched workspace')
    expect(wrapper.text()).not.toContain('Thinking')
    expect(wrapper.get('.activity-stream__toggle').attributes('aria-expanded')).toBe(
      'true',
    )
  })

  it('renders reasoning formatting and exposes live command output progressively', () => {
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: {
          items: [
            {
              ...base,
              kind: 'reasoning_summary',
              summary: ['**Planning evidence retrieval**'],
            },
            {
              ...base,
              command: 'rg CTS',
              itemId: 'command-1',
              kind: 'command_execution',
              label: 'Search workspace',
              output: 'Found CTS metadata',
            },
          ],
          startedAt: 900,
          turnId: 'turn-1',
        },
        status: 'loading',
      },
    })

    expect(wrapper.get('.activity-item__reasoning strong').text()).toBe(
      'Planning evidence retrieval',
    )
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    expect(wrapper.get('.activity-code--output').text()).toContain('Found CTS metadata')
    expect(wrapper.get('details .ri-terminal-box-line').classes()).toContain(
      'activity-item__icon',
    )
  })

  it('uses semantic icons for ECOS local activities', () => {
    const tools = [
      ['local-stage-identification', 'Identified cts stage'],
      ['local-knowledge-search', 'Searched ECOS knowledge'],
      ['local-source-search', 'Searched workspace sources'],
      ['local-answer-validation', 'Validated answer evidence'],
    ] as const
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: {
          items: tools.map(([itemId, tool]) => ({
            ...base,
            itemId,
            kind: 'tool_call' as const,
            status: 'completed' as const,
            tool,
          })),
          startedAt: 900,
          turnId: 'turn-1',
        },
        status: 'loading',
      },
    })

    const iconClasses = wrapper
      .findAll('.activity-item__summary > .activity-item__icon')
      .map((icon) => icon.classes())
    expect(iconClasses).toEqual([
      expect.arrayContaining(['ri-route-line']),
      expect.arrayContaining(['ri-book-open-line']),
      expect.arrayContaining(['ri-file-search-line']),
      expect.arrayContaining(['ri-shield-check-line']),
    ])
  })

  it('collapses completed activity into a duration and keeps details available', async () => {
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: {
          completedAt: 8900,
          items: [
            {
              ...base,
              kind: 'reasoning_summary',
              status: 'completed',
              summary: ['Checked the placement stages.'],
            },
          ],
          startedAt: 900,
          turnId: 'turn-1',
        },
        status: 'done',
      },
    })

    expect(wrapper.text()).toContain('Worked for 8s')
    expect(wrapper.get('.activity-stream__toggle').attributes('aria-expanded')).toBe(
      'false',
    )
    await wrapper.get('.activity-stream__toggle').trigger('click')
    expect(wrapper.get('.activity-stream__toggle').attributes('aria-expanded')).toBe(
      'true',
    )
    expect(wrapper.text()).toContain('Checked the placement stages.')
  })

  it('shows turn duration in seconds even when it completes under one second', () => {
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: {
          completedAt: 1200,
          items: [
            {
              ...base,
              durationMs: 300,
              kind: 'reasoning_summary',
              status: 'completed',
              summary: ['Checked CTS.'],
            },
          ],
          startedAt: 900,
          turnId: 'turn-1',
        },
        status: 'done',
      },
    })

    expect(wrapper.get('.activity-stream__toggle').text()).toContain('Worked for 1s')
    expect(wrapper.get('.activity-stream__toggle').text()).not.toContain('ms')
  })

  it('expands a failed command with bounded-output context', () => {
    const wrapper = mount(AgentActivityStream, {
      props: {
        activity: {
          items: [
            {
              ...base,
              command: 'rg CTS',
              cwd: '/workspace',
              itemId: 'command-1',
              kind: 'command_execution',
              label: 'Searched workspace',
              output: 'permission denied',
              status: 'failed',
              truncated: true,
            },
          ],
          notice: 'Some activity details are unavailable.',
          startedAt: 900,
          turnId: 'turn-1',
        },
        status: 'error',
      },
    })

    expect(wrapper.text()).toContain('Activity failed')
    expect(wrapper.text()).toContain('permission denied')
    expect(wrapper.text()).toContain('Output truncated')
    expect(wrapper.text()).toContain('Some activity details are unavailable.')
    expect(wrapper.get('.activity-stream__toggle').attributes('aria-expanded')).toBe(
      'true',
    )
  })
})
