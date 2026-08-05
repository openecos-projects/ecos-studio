// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectQorScoreChart from './ProjectQorScoreChart.vue'
import type { ProjectQorTrendPoint } from '@/utils/projectQorTrend'

const TREND_POINTS: ProjectQorTrendPoint[] = [
  { workspaceId: 'ws_a', label: 'ws_a', score: 58.4, status: 'Yellow' },
  { workspaceId: 'ws_b', label: 'ws_b', score: 74.2, status: 'Green' },
  { workspaceId: 'ws_c', label: 'ws_c', score: null, status: 'Blocked' },
]

function mountChart(trendPoints = TREND_POINTS) {
  return mount(ProjectQorScoreChart, {
    props: {
      trendPoints,
      baselineWorkspaceId: 'ws_a',
      baselineLabel: 'ws_a',
      selectedWorkspaceId: 'ws_b',
    },
  })
}

/** Enough workspaces that a printed score is wider than the room one workspace owns. */
function crowdedPoints(count: number): ProjectQorTrendPoint[] {
  return Array.from({ length: count }, (_unused, index) => ({
    workspaceId: `ws_${index}`,
    label: `ws_00${index}`,
    score: 50 + (index % 20),
    status: 'Yellow' as const,
  }))
}

/** Plot x of every axis label that survived thinning, left to right. */
function shownAxisLabelPositions(wrapper: ReturnType<typeof mountChart>): number[] {
  return wrapper
    .findAll('.qor-chart-tick')
    .filter((tick) => tick.find('.qor-chart-workspace-label').exists())
    .map((tick) =>
      Number(/translate\(([-\d.]+)/.exec(tick.attributes('transform') ?? '')?.[1]),
    )
}

function mountCrowdedChart(count = 50) {
  const points = crowdedPoints(count)
  return mount(ProjectQorScoreChart, {
    props: {
      trendPoints: points,
      baselineWorkspaceId: 'ws_1',
      baselineLabel: 'ws_001',
      selectedWorkspaceId: 'ws_2',
    },
  })
}

describe('ProjectQorScoreChart', () => {
  it('plots one lollipop per workspace', () => {
    expect(mountChart().findAll('.qor-lollipop')).toHaveLength(3)
  })

  it('labels rated workspaces with their score and unrated ones as NR', () => {
    const wrapper = mountChart()

    expect(
      wrapper.findAll('.qor-chart-value-label').map((label) => label.text()),
    ).toEqual(['58.4', '74.2'])
    expect(wrapper.find('.qor-chart-not-rated').text()).toBe('NR')
  })

  it('flags the highest score as best and reports it in the header', () => {
    const wrapper = mountChart()
    const lollipops = wrapper.findAll('.qor-lollipop')

    expect(lollipops[1].classes()).toContain('best')
    expect(lollipops[0].classes()).not.toContain('best')
    expect(wrapper.find('.qor-best-chip').text()).toContain('74.2')
  })

  it('marks the selected and baseline workspaces separately', () => {
    const lollipops = mountChart().findAll('.qor-lollipop')

    expect(lollipops[0].classes()).toContain('baseline')
    expect(lollipops[1].classes()).toContain('selected')
  })

  it('selects a workspace when its lollipop is clicked', async () => {
    const wrapper = mountChart()

    await wrapper.findAll('.qor-lollipop')[0].trigger('click')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_a']])
  })

  it('selects a workspace from the keyboard', async () => {
    const wrapper = mountChart()

    await wrapper.findAll('.qor-lollipop')[2].trigger('keydown.enter')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_c']])
  })

  it('describes each point for assistive technology', () => {
    const wrapper = mountChart()

    expect(wrapper.findAll('.qor-lollipop')[0].attributes('aria-label')).toBe(
      'ws_a: 58.4 (baseline, below the 60 analysis threshold)',
    )
    expect(wrapper.findAll('.qor-lollipop')[1].attributes('aria-label')).toBe(
      'ws_b: 74.2 (selected, meets the 60 analysis threshold)',
    )
  })

  // Printing fifty scores into the room for six turns the plot into a smear, so the
  // labels give way to the points a reader is actually tracking.
  it('prints only the tracked scores once labels no longer fit their slots', () => {
    const labels = mountCrowdedChart()
      .findAll('.qor-chart-value-label')
      .map((label) => label.text())

    // Selected ws_2 and the two workspaces tied for the best score. Baseline ws_1 sits
    // one slot from the selected point at almost the same score, so it yields its label.
    expect(labels).toEqual(['52.0', '69.0', '69.0'])
  })

  it('keeps both scores when neighbouring points sit at different heights', () => {
    const points = crowdedPoints(50)
    points[1] = { ...points[1], score: 12 }
    const wrapper = mount(ProjectQorScoreChart, {
      props: {
        trendPoints: points,
        baselineWorkspaceId: 'ws_1',
        baselineLabel: 'ws_001',
        selectedWorkspaceId: 'ws_2',
      },
    })

    expect(
      wrapper.findAll('.qor-chart-value-label').map((label) => label.text()),
    ).toContain('12.0')
  })

  it('says where the scores went when it cannot print them', () => {
    expect(mountCrowdedChart().find('.qor-score-header small').text()).toContain(
      'hover a point for its score',
    )
    expect(mountChart().find('.qor-score-header small').text()).not.toContain('hover')
  })

  // The invariant that matters: whatever survives the thinning never overlaps, so the
  // axis cannot smear even where a tracked workspace forces a label into a tight spot.
  // Labels are rotated, so what has to clear is the perpendicular distance between two
  // parallel lines of text, which is the horizontal gap projected through the rotation.
  it('never places two axis labels within one line of each other', () => {
    const positions = shownAxisLabelPositions(mountCrowdedChart())

    expect(positions.length).toBeGreaterThan(4)
    expect(positions.length).toBeLessThan(50)
    const gaps = positions.slice(1).map((x, index) => x - positions[index])
    const perpendicular = Math.min(...gaps) * Math.sin((40 * Math.PI) / 180)
    // Font size 3.1 with the 1.3 line box the placement reserves.
    expect(perpendicular).toBeGreaterThanOrEqual(3.1 * 1.3)
  })

  it('names every workspace on the axis while the rotation leaves room', () => {
    expect(shownAxisLabelPositions(mountCrowdedChart(12))).toHaveLength(12)
  })

  it('names the selected workspace on the axis ahead of its neighbours', () => {
    const labels = mountCrowdedChart()
      .findAll('.qor-chart-workspace-label')
      .map((label) => label.text())

    expect(labels).toContain('ws_002')
  })

  it('keeps every workspace clickable and described even when unlabelled', () => {
    const wrapper = mountCrowdedChart()

    expect(wrapper.findAll('.qor-lollipop')).toHaveLength(50)
    expect(wrapper.findAll('.qor-lollipop')[7].attributes('aria-label')).toBe(
      'ws_007: 57.0 (below the 60 analysis threshold)',
    )
  })

  it('replaces the NR pill with a marker where a pill would overlap its neighbours', () => {
    const crowded = crowdedPoints(50).map((point, index) =>
      index % 2 === 0 ? { ...point, score: null, status: 'Blocked' as const } : point,
    )
    const wrapper = mount(ProjectQorScoreChart, {
      props: {
        trendPoints: crowded,
        baselineWorkspaceId: 'ws_1',
        baselineLabel: 'ws_001',
        selectedWorkspaceId: 'ws_3',
      },
    })

    expect(wrapper.findAll('.qor-chart-nr-dot')).toHaveLength(25)
    expect(wrapper.find('.qor-chart-not-rated').exists()).toBe(false)
  })

  // The first lollipop used to sit on the value axis, which read as part of the axis.
  it('centres each workspace in its own slot rather than on the plot edges', () => {
    const circles = mountCrowdedChart().findAll('.qor-chart-point')
    const first = Number(circles[0].attributes('cx'))
    const last = Number(circles[circles.length - 1].attributes('cx'))

    expect(first).toBeGreaterThan(20)
    expect(last).toBeLessThan(172)
  })

  it('shows an empty state instead of an axis when there is nothing to plot', () => {
    const wrapper = mountChart([])

    expect(wrapper.find('.qor-score-chart').exists()).toBe(false)
    expect(wrapper.find('.qor-score-empty').text()).toContain('No workspace')
    expect(wrapper.find('.qor-best-chip').text()).toBe('NR')
  })
})
